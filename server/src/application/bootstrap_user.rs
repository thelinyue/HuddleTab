use std::fmt;

use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use crate::{
    application::ports::{Clock, PasswordHasher, PasswordHashingError},
    domain::identity::{IdentityError, Password, Username},
};

const BOOTSTRAP_ADVISORY_LOCK: i64 = 0x4855_4444_4C45_5442;

#[derive(Clone, Eq, PartialEq)]
pub struct BootstrapUserInput {
    pub username: String,
    pub password: String,
    pub display_name: String,
}

/// 首位用户输入允许记录调用上下文，但绝不能把网页提交的明文密码写进日志。
impl fmt::Debug for BootstrapUserInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BootstrapUserInput")
            .field("username", &self.username)
            .field("display_name", &self.display_name)
            .field("password", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BootstrappedUser {
    pub id: Uuid,
    pub username: String,
}

#[derive(Debug, Error)]
pub enum BootstrapUserError {
    #[error(transparent)]
    InvalidIdentity(#[from] IdentityError),
    #[error("管理员昵称长度必须为 1 到 80 个字符")]
    InvalidDisplayName,
    #[error(transparent)]
    PasswordHashing(#[from] PasswordHashingError),
    #[error("系统已经存在用户，不能再次创建首位用户")]
    AlreadyBootstrapped,
    #[error("创建首位用户时数据库事务失败")]
    Database(#[from] sqlx::Error),
}

/// 在数据库级互斥锁内检查 `users=0` 并创建首位用户。
///
/// 密码散列在开启事务前完成，避免 Argon2 的计算时间长期占用数据库连接和事务锁。
/// `PostgreSQL` advisory transaction lock 让不同请求中的并发初始化也只能有一个成功。
///
/// # Errors
///
/// 身份输入无效、密码散列失败、系统已有用户或数据库事务失败时返回稳定错误。
pub async fn bootstrap_first_user(
    pool: &PgPool,
    password_hasher: &dyn PasswordHasher,
    clock: &dyn Clock,
    input: BootstrapUserInput,
) -> Result<BootstrappedUser, BootstrapUserError> {
    let username = Username::parse(&input.username)?;
    let password = Password::parse(&input.password)?;
    let display_name = input.display_name.trim();
    if !(1..=80).contains(&display_name.chars().count()) {
        return Err(BootstrapUserError::InvalidDisplayName);
    }
    let password_hash = password_hasher.hash(&password)?;
    let now = clock.now();
    let user_id = Uuid::new_v4();

    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(BOOTSTRAP_ADVISORY_LOCK)
        .execute(&mut *transaction)
        .await?;
    let has_users = sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM users)")
        .fetch_one(&mut *transaction)
        .await?;
    if has_users {
        return Err(BootstrapUserError::AlreadyBootstrapped);
    }

    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $5)",
    )
    .bind(user_id)
    .bind(username.as_str())
    .bind(password_hash)
    .bind(display_name)
    .bind(now)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "INSERT INTO system_roles (user_id, role, granted_at) VALUES ($1, 'SYSTEM_ADMIN', $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok(BootstrappedUser {
        id: user_id,
        username: username.as_str().to_owned(),
    })
}

/// 页面初始化守卫只需要知道数据库是否仍为空；不暴露用户数量或任何账号资料。
///
/// # Errors
///
/// 数据库查询失败时返回原始 `SQLx` 错误，由 HTTP 层转换为统一中文错误。
pub async fn setup_required(pool: &PgPool) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar::<_, bool>("SELECT NOT EXISTS (SELECT 1 FROM users)")
        .fetch_one(pool)
        .await
}
