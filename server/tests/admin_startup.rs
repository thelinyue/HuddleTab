use huddletab_server::{
    application::ports::PasswordHasher,
    domain::identity::Password,
    infrastructure::{database::connect_and_migrate, password::Argon2PasswordHasher},
};
use std::{
    fs::File,
    process::{Child, Command, Stdio},
    time::Duration,
};

/// 子进程持有独立环境和日志文件，测试失败也会关闭服务，不修改测试进程的环境变量。
struct Server {
    child: Child,
    directory: tempfile::TempDir,
    address: String,
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
impl Server {
    fn start(database: &str, username: Option<&str>, password: Option<&str>) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap().to_string();
        drop(listener);
        let log = File::create(directory.path().join("server.log")).unwrap();
        let mut command = Command::new(env!("CARGO_BIN_EXE_huddletab"));
        command
            .args(["serve", "--bind", &address])
            .env("DATABASE_URL", database)
            .env("DATA_DIR", directory.path())
            .env("APP_BASE_URL", format!("http://{address}"))
            .env("RUST_LOG", "huddletab_server=info")
            .env_remove("ADMIN_USERNAME")
            .env_remove("ADMIN_PASSWORD")
            .stdout(Stdio::from(log.try_clone().unwrap()))
            .stderr(Stdio::from(log));
        if let Some(value) = username {
            command.env("ADMIN_USERNAME", value);
        }
        if let Some(value) = password {
            command.env("ADMIN_PASSWORD", value);
        }
        Self {
            child: command.spawn().unwrap(),
            directory,
            address,
        }
    }
    async fn ready(&mut self, expected: bool) {
        let client = reqwest::Client::new();
        for _ in 0..200 {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(!expected && !status.success(), "服务启动结果不符合预期");
                return;
            }
            if client
                .get(format!("http://{}/api/health", self.address))
                .send()
                .await
                .is_ok()
            {
                assert!(expected, "无效配置不应开放 HTTP");
                return;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("服务未在限定时间完成启动");
    }
    fn logs(&self) -> String {
        std::fs::read_to_string(self.directory.path().join("server.log")).unwrap()
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn startup_credentials_defaults_failures_concurrency_and_restart() {
    let database = std::env::var("TEST_DATABASE_URL").unwrap();
    let pool = connect_and_migrate(&database).await.unwrap();
    for (username, password, expected_username) in [
        (
            Some(" ADMINISTRATOR "),
            Some("explicit-password"),
            "administrator",
        ),
        (None, None, "admin"),
        (Some("custom"), None, "custom"),
        (None, Some("explicit-password"), "admin"),
        (Some(""), Some(""), "admin"),
    ] {
        sqlx::query("TRUNCATE users CASCADE")
            .execute(&pool)
            .await
            .unwrap();
        let mut server = Server::start(&database, username, password);
        server.ready(true).await;
        let logs = server.logs();
        let stored: (String,String,bool) = sqlx::query_as("SELECT username,password_hash,EXISTS(SELECT 1 FROM system_roles WHERE user_id=users.id AND role='SYSTEM_ADMIN') FROM users").fetch_one(&pool).await.unwrap();
        assert_eq!(stored.0, expected_username);
        assert!(stored.2);
        let generated = password.is_none_or(str::is_empty);
        let actual = if generated {
            let value = logs
                .split("管理员初始随机密码：")
                .nth(1)
                .expect("应输出生成的密码")
                .split('；')
                .next()
                .unwrap();
            assert_eq!(value.len(), 32);
            value
        } else {
            assert!(!logs.contains("explicit-password"));
            password.unwrap()
        };
        assert!(
            Argon2PasswordHasher
                .verify(&Password::parse(actual).unwrap(), &stored.1)
                .unwrap()
                .valid
        );
        drop(server);
        // 模拟网页修改的持久化结果，新的环境变量即使非法也不能覆盖已有用户。
        let changed_hash = Argon2PasswordHasher
            .hash(&Password::parse("changed-password").unwrap())
            .unwrap();
        sqlx::query("UPDATE users SET username='renamed',display_name='新昵称',password_hash=$1")
            .bind(&changed_hash)
            .execute(&pool)
            .await
            .unwrap();
        let mut restart = Server::start(&database, Some("!"), Some("short"));
        restart.ready(true).await;
        assert!(!restart.logs().contains("管理员初始随机密码"));
        let after: (String, String, String) =
            sqlx::query_as("SELECT username,display_name,password_hash FROM users")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            after,
            ("renamed".to_owned(), "新昵称".to_owned(), changed_hash)
        );
    }
    assert_invalid_configuration(&pool, &database).await;
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .unwrap();
    let mut first = Server::start(&database, None, None);
    let mut second = Server::start(&database, None, None);
    tokio::join!(first.ready(true), second.ready(true));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    assert_eq!(
        first.logs().matches("管理员初始随机密码").count()
            + second.logs().matches("管理员初始随机密码").count(),
        1
    );
    drop(first);
    drop(second);
    assert_role_failure_rolls_back(&pool, &database).await;
}

async fn assert_role_failure_rolls_back(pool: &sqlx::PgPool, database: &str) {
    // 角色写入失败必须回滚用户，且不能输出尚未创建成功的密码。
    sqlx::query("TRUNCATE users CASCADE")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("CREATE FUNCTION fail_admin_role() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test role failure'; END $$").execute(pool).await.unwrap();
    sqlx::query("CREATE TRIGGER fail_admin_role BEFORE INSERT ON system_roles FOR EACH ROW EXECUTE FUNCTION fail_admin_role()").execute(pool).await.unwrap();
    let mut failed = Server::start(database, None, None);
    failed.ready(false).await;
    assert!(!failed.logs().contains("管理员初始随机密码"));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    sqlx::query("DROP TRIGGER fail_admin_role ON system_roles")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION fail_admin_role()")
        .execute(pool)
        .await
        .unwrap();
}

async fn assert_invalid_configuration(pool: &sqlx::PgPool, database: &str) {
    for (username, password) in [("!", "valid-password"), ("admin", "short")] {
        sqlx::query("TRUNCATE users CASCADE")
            .execute(pool)
            .await
            .unwrap();
        let mut server = Server::start(database, Some(username), Some(password));
        server.ready(false).await;
        assert!(server.logs().contains("管理员初始化失败"));
        assert!(!server.logs().contains(password));
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
            .fetch_one(pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    }
}
