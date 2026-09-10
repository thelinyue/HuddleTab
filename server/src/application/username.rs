use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

use crate::{
    application::ports::PasswordHasher,
    domain::identity::{Password, Username},
};

#[derive(Debug, Error)]
pub enum ChangeUsernameError {
    #[error("用户名须为 3–32 位小写字母、数字、点、下划线或连字符")]
    InvalidUsername,
    #[error("当前密码错误，请重新输入")]
    InvalidPassword,
    #[error("用户名已被使用，请换一个")]
    Taken,
    #[error("账号状态已变化，请重新登录后再试")]
    Unauthenticated,
    #[error("修改用户名失败，请稍后重试")]
    Unavailable,
}

/// 按稳定用户 ID 改名；密码验证后在事务内重新检查凭据，防止并发改密绕过验证。
/// 用户名与旧定向邀请撤销一起提交，不改变成员身份或有效 Session。
///
/// # Errors
/// 无效输入、密码错误、账号失效、用户名占用或存储失败时返回对应业务错误。
pub async fn change_username(
    pool: &PgPool,
    hasher: &dyn PasswordHasher,
    user_id: Uuid,
    token_hash: &[u8; 32],
    new_username: &str,
    current_password: &str,
) -> Result<String, ChangeUsernameError> {
    let username =
        Username::parse(new_username).map_err(|_| ChangeUsernameError::InvalidUsername)?;
    let password =
        Password::parse(current_password).map_err(|_| ChangeUsernameError::InvalidPassword)?;
    let hash = sqlx::query_scalar::<_, String>(
        "SELECT password_hash FROM users WHERE id = $1 AND disabled_at IS NULL",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(database_error)?
    .ok_or(ChangeUsernameError::Unauthenticated)?;
    if !hasher
        .verify(&password, &hash)
        .map_err(|_| ChangeUsernameError::Unavailable)?
        .valid
    {
        return Err(ChangeUsernameError::InvalidPassword);
    }
    let mut tx = pool.begin().await.map_err(database_error)?;
    let current = sqlx::query_as::<_, (String, String)>(
        "SELECT username, password_hash FROM users WHERE id = $1 AND disabled_at IS NULL FOR UPDATE")
        .bind(user_id).fetch_optional(&mut *tx).await.map_err(database_error)?
        .ok_or(ChangeUsernameError::Unauthenticated)?;
    let active = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM sessions WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL AND idle_expires_at > NOW() AND absolute_expires_at > NOW())")
        .bind(user_id).bind(token_hash.as_slice()).fetch_one(&mut *tx).await.map_err(database_error)?;
    if current.1 != hash || !active {
        return Err(ChangeUsernameError::Unauthenticated);
    }
    if current.0 != username.as_str() {
        sqlx::query("UPDATE users SET username = $2, version = version + 1, updated_at = NOW() WHERE id = $1")
            .bind(user_id).bind(username.as_str()).execute(&mut *tx).await.map_err(|error| {
                if error.as_database_error().is_some_and(sqlx::error::DatabaseError::is_unique_violation) {
                    ChangeUsernameError::Taken
                } else { database_error(error) }
            })?;
        sqlx::query("UPDATE activity_invites SET revoked_at = NOW(), version = version + 1 WHERE kind = 'DIRECT' AND target_display_name = $1 AND revoked_at IS NULL AND use_count = 0")
            .bind(&current.0).execute(&mut *tx).await.map_err(database_error)?;
    }
    tx.commit().await.map_err(database_error)?;
    Ok(username.as_str().to_owned())
}

fn database_error(error: sqlx::Error) -> ChangeUsernameError {
    tracing::error!(%error, "修改用户名数据库操作失败");
    drop(error);
    ChangeUsernameError::Unavailable
}

