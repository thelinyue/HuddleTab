use huddletab_server::{
    application::{
        bootstrap_user::{BootstrapUserInput, bootstrap_first_user},
        ports::{Clock, PasswordHasher, PasswordHashingError, PasswordVerification},
        system_admin::{
            RegistrationPolicy, SystemAdminError, SystemAdminRepository, get_registration_policy,
            reset_password, set_registration_policy, set_system_admin, set_user_disabled,
        },
    },
    domain::identity::Password,
    infrastructure::{
        database::connect_and_migrate, system_admin_repository::PostgresSystemAdminRepository,
    },
};
use sqlx::PgPool;
use std::sync::OnceLock;
use time::OffsetDateTime;
use tokio::sync::Mutex;
use uuid::Uuid;

static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug)]
struct TestHasher;

impl PasswordHasher for TestHasher {
    fn hash(&self, _: &Password) -> Result<String, PasswordHashingError> {
        Ok("test-password-hash".to_owned())
    }

    fn verify(&self, _: &Password, _: &str) -> Result<PasswordVerification, PasswordHashingError> {
        Ok(PasswordVerification {
            valid: true,
            needs_rehash: false,
        })
    }
}

struct TestClock;

impl Clock for TestClock {
    fn now(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}

async fn pool() -> PgPool {
    let url = std::env::var("TEST_DATABASE_URL").expect("需要 TEST_DATABASE_URL");
    connect_and_migrate(&url).await.expect("测试数据库应可迁移")
}

async fn seed_user(pool: &PgPool, id: Uuid, username: &str) {
    let now = OffsetDateTime::now_utc();
    sqlx::query("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ($1, $2, 'test-password-hash', $2, $3, $3)")
        .bind(id).bind(username).bind(now).execute(pool).await.expect("应插入用户");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn bootstrap_creates_the_first_system_admin_and_admin_invariants_hold() {
    let guard = TEST_LOCK.get_or_init(|| Mutex::new(())).lock().await;
    let pool = pool().await;
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空用户");
    let first = bootstrap_first_user(
        &pool,
        &TestHasher,
        &TestClock,
        BootstrapUserInput {
            username: "admin-one".to_owned(),
            password: "correct horse battery staple".to_owned(),
        },
    )
    .await
    .expect("应创建首位管理员");
    let repository = PostgresSystemAdminRepository::new(pool.clone());
    let users = repository.list_users().await.expect("应读取用户");
    assert_eq!(users[0].id, first.id);
    assert!(users[0].is_system_admin);
    assert_eq!(
        repository
            .get_registration_policy()
            .await
            .expect("应读取策略")
            .policy,
        RegistrationPolicy::InviteOnly
    );
    let now = OffsetDateTime::now_utc();
    assert!(matches!(
        set_user_disabled(&repository, first.id, true, now).await,
        Err(SystemAdminError::LastActiveAdmin)
    ));
    drop(guard);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn password_reset_revokes_sessions_and_policy_uses_optimistic_version() {
    let guard = TEST_LOCK.get_or_init(|| Mutex::new(())).lock().await;
    let pool = pool().await;
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空用户");
    let admin = Uuid::new_v4();
    let target = Uuid::new_v4();
    seed_user(&pool, admin, "admin-one").await;
    seed_user(&pool, target, "target-user").await;
    sqlx::query(
        "INSERT INTO system_roles (user_id, role, granted_at) VALUES ($1, 'SYSTEM_ADMIN', now())",
    )
    .bind(admin)
    .execute(&pool)
    .await
    .expect("应授予管理员");
    let now = OffsetDateTime::now_utc();
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)")
        .bind(Uuid::new_v4()).bind(target).bind([1_u8; 32].as_slice()).bind(now).bind(now + time::Duration::days(1)).bind(now + time::Duration::days(2)).execute(&pool).await.expect("应插入 Session");
    let repository = PostgresSystemAdminRepository::new(pool.clone());
    reset_password(&repository, &TestHasher, target, "new password value", now)
        .await
        .expect("应重置密码");
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sessions WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(target)
    .fetch_one(&pool)
    .await
    .expect("应统计 Session");
    assert_eq!(count, 0);
    let policy = get_registration_policy(&repository)
        .await
        .expect("应读取策略");
    let updated = set_registration_policy(
        &repository,
        RegistrationPolicy::Open,
        policy.version,
        admin,
        now,
    )
    .await
    .expect("应更新策略");
    assert_eq!(updated.policy, RegistrationPolicy::Open);
    assert!(matches!(
        set_registration_policy(
            &repository,
            RegistrationPolicy::InviteOnly,
            policy.version,
            admin,
            now
        )
        .await,
        Err(SystemAdminError::VersionConflict)
    ));
    drop(guard);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn concurrent_admin_revocation_keeps_one_login_capable_admin() {
    let guard = TEST_LOCK.get_or_init(|| Mutex::new(())).lock().await;
    let pool = pool().await;
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空用户");
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let actor = Uuid::new_v4();
    seed_user(&pool, first, "admin-first").await;
    seed_user(&pool, second, "admin-second").await;
    for id in [first, second] {
        sqlx::query("INSERT INTO system_roles (user_id, role, granted_at) VALUES ($1, 'SYSTEM_ADMIN', now())").bind(id).execute(&pool).await.expect("应授予管理员");
    }
    let repository = PostgresSystemAdminRepository::new(pool);
    let results = tokio::join!(
        set_system_admin(&repository, first, false, actor, OffsetDateTime::now_utc()),
        set_system_admin(&repository, second, false, actor, OffsetDateTime::now_utc())
    );
    assert_eq!(
        [results.0.is_ok(), results.1.is_ok()]
            .into_iter()
            .filter(|success| *success)
            .count(),
        1,
        "并发撤权只能有一个成功"
    );
    assert_eq!(
        [results.0, results.1]
            .into_iter()
            .filter(|result| matches!(result, Err(SystemAdminError::LastActiveAdmin)))
            .count(),
        1
    );
    drop(guard);
}
