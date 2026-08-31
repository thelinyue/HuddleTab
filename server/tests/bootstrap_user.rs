use huddletab_server::{
    application::{
        bootstrap_user::{BootstrapUserInput, bootstrap_first_user},
        ports::{Clock, PasswordHasher, PasswordHashingError, PasswordVerification},
    },
    domain::identity::Password,
    infrastructure::database::connect_and_migrate,
};
use std::{
    io::Write,
    process::{Command, Stdio},
};
use time::{OffsetDateTime, macros::datetime};
use tokio::sync::Mutex;

static DATABASE_TEST_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Debug)]
struct TestPasswordHasher;

#[derive(Debug)]
struct TestClock;

impl Clock for TestClock {
    fn now(&self) -> OffsetDateTime {
        datetime!(2026-08-31 12:00 UTC)
    }
}

impl PasswordHasher for TestPasswordHasher {
    fn hash(&self, _password: &Password) -> Result<String, PasswordHashingError> {
        Ok("test-password-hash".to_owned())
    }

    fn verify(
        &self,
        _password: &Password,
        _encoded_hash: &str,
    ) -> Result<PasswordVerification, PasswordHashingError> {
        unreachable!("bootstrap 用例不会验证密码")
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn bootstrap_persists_one_normalized_user() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");

    let created = bootstrap_first_user(
        &pool,
        &TestPasswordHasher,
        &TestClock,
        BootstrapUserInput {
            username: "  Alice  ".to_owned(),
            password: "correct horse battery staple".to_owned(),
        },
    )
    .await
    .expect("空数据库应允许创建首位用户");

    let stored = sqlx::query_as::<_, (String, String, String)>(
        "SELECT username, display_name, password_hash FROM users WHERE id = $1",
    )
    .bind(created.id)
    .fetch_one(&pool)
    .await
    .expect("用户应持久化");

    assert_eq!(created.username, "alice");
    assert_eq!(
        stored,
        ("alice".into(), "alice".into(), "test-password-hash".into())
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn concurrent_bootstrap_allows_exactly_one_success() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");

    // 测试触发器扩大两个事务都完成空库检查的时间窗，使缺少数据库互斥锁时稳定失败。
    sqlx::query(
        "CREATE OR REPLACE FUNCTION bootstrap_test_delay() RETURNS trigger AS $$ \
         BEGIN PERFORM pg_sleep(0.2); RETURN NEW; END; $$ LANGUAGE plpgsql",
    )
    .execute(&pool)
    .await
    .expect("应创建测试延迟函数");
    sqlx::query("DROP TRIGGER IF EXISTS bootstrap_test_delay_trigger ON users")
        .execute(&pool)
        .await
        .expect("应清理残留测试触发器");
    sqlx::query(
        "CREATE TRIGGER bootstrap_test_delay_trigger BEFORE INSERT ON users \
         FOR EACH ROW EXECUTE FUNCTION bootstrap_test_delay()",
    )
    .execute(&pool)
    .await
    .expect("应创建测试延迟触发器");

    let first = bootstrap_first_user(
        &pool,
        &TestPasswordHasher,
        &TestClock,
        BootstrapUserInput {
            username: "alice".to_owned(),
            password: "correct horse battery staple".to_owned(),
        },
    );
    let second = bootstrap_first_user(
        &pool,
        &TestPasswordHasher,
        &TestClock,
        BootstrapUserInput {
            username: "bob".to_owned(),
            password: "correct horse battery staple".to_owned(),
        },
    );
    let (first, second) = tokio::join!(first, second);

    let results = [first, second];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(error) if error.to_string() == "系统已经存在用户，不能再次创建首位用户"))
            .count(),
        1,
        "失败方必须得到稳定的 AlreadyBootstrapped 业务错误，而不是唯一约束异常",
    );

    sqlx::query("DROP TRIGGER bootstrap_test_delay_trigger ON users")
        .execute(&pool)
        .await
        .expect("应删除测试触发器");
    sqlx::query("DROP FUNCTION bootstrap_test_delay()")
        .execute(&pool)
        .await
        .expect("应删除测试延迟函数");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn cli_reads_password_from_stdin_without_echoing_it() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");

    let password = "correct horse battery staple";
    let mut child = Command::new(env!("CARGO_BIN_EXE_huddletab"))
        .args([
            "bootstrap-user",
            "--username",
            "cli-user",
            "--password-stdin",
        ])
        .env("DATABASE_URL", &database_url)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("应能启动 bootstrap-user CLI");
    writeln!(child.stdin.take().expect("应打开 stdin"), "{password}").expect("应写入测试密码");
    let output = child.wait_with_output().expect("CLI 应正常退出");

    assert!(
        output.status.success(),
        "CLI 失败：{}",
        String::from_utf8_lossy(&output.stderr),
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains(password));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(password));

    let username = sqlx::query_scalar::<_, String>("SELECT username FROM users")
        .fetch_one(&pool)
        .await
        .expect("CLI 应创建用户");
    assert_eq!(username, "cli-user");
}
