use huddletab_server::infrastructure::database::connect_and_migrate;
use sqlx::PgPool;
use uuid::Uuid;

// 独立 schema 确保真正从空结构开始，不复用其他集成测试已初始化的 public。
async fn isolated_schema() -> (PgPool, String, String) {
    let database_url = std::env::var("TEST_DATABASE_URL")
        .expect("运行 migration 集成测试前必须设置 TEST_DATABASE_URL");
    let admin = PgPool::connect(&database_url).await.expect("应连接测试库");
    let schema = format!("migration_test_{}", Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE SCHEMA {schema}"))
        .execute(&admin)
        .await
        .expect("应创建隔离 schema");
    let separator = if database_url.contains('?') { '&' } else { '?' };
    let url = format!("{database_url}{separator}options[search_path]={schema}");
    (admin, schema, url)
}

async fn drop_schema(admin: PgPool, schema: &str) {
    sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
        .execute(&admin)
        .await
        .expect("应清理本测试创建的 schema");
    admin.close().await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn fresh_database_migrates_and_replay_is_idempotent() {
    let (admin, schema, database_url) = isolated_schema().await;

    let pool = connect_and_migrate(&database_url)
        .await
        .expect("空数据库应可执行 migration");
    let settings: (String, i64) = sqlx::query_as(
        "SELECT registration_policy, version FROM system_settings WHERE id = 'singleton'",
    )
    .fetch_one(&pool)
    .await
    .expect("应创建系统设置初始记录");
    assert_eq!(settings, ("INVITE_ONLY".into(), 1));
    sqlx::query("UPDATE system_settings SET registration_policy = 'OPEN', version = 2")
        .execute(&pool)
        .await
        .expect("应可修改持久化设置");
    pool.close().await;

    let replayed_pool = connect_and_migrate(&database_url)
        .await
        .expect("重复启动不应重复执行已记录 migration");
    let applied_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&replayed_pool)
        .await
        .expect("应可读取 SQLx migration 记录");

    assert_eq!(applied_count, 1);
    let settings: (String, i64) = sqlx::query_as(
        "SELECT registration_policy, version FROM system_settings WHERE id = 'singleton'",
    )
    .fetch_one(&replayed_pool)
    .await
    .expect("重复启动后设置仍存在");
    assert_eq!(settings, ("OPEN".into(), 2));
    replayed_pool.close().await;
    drop_schema(admin, &schema).await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn retired_migration_is_rejected_without_changing_data_or_records() {
    let (admin, schema, database_url) = isolated_schema().await;
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("应初始化隔离测试结构");
    // 只模拟已退役的迁移记录，不在当前测试中重新维护整套旧版本建库 SQL。
    sqlx::query("UPDATE _sqlx_migrations SET version = 202608310001")
        .execute(&pool)
        .await
        .expect("应写入已退役迁移版本");
    let before: String = sqlx::query_scalar(
        "SELECT json_build_object('migrations', (SELECT json_agg(m) FROM _sqlx_migrations m), \
         'settings', (SELECT json_agg(s) FROM system_settings s))::text",
    )
    .fetch_one(&pool)
    .await
    .expect("应记录拒绝前的数据");

    let error = connect_and_migrate(&database_url)
        .await
        .expect_err("已退役迁移不可继续初始化");
    assert!(error.to_string().contains("本版本需要全新安装"));
    assert!(matches!(
        error.downcast_ref::<sqlx::migrate::MigrateError>(),
        Some(sqlx::migrate::MigrateError::VersionMissing(202_608_310_001))
    ));
    let after: String = sqlx::query_scalar(
        "SELECT json_build_object('migrations', (SELECT json_agg(m) FROM _sqlx_migrations m), \
         'settings', (SELECT json_agg(s) FROM system_settings s))::text",
    )
    .fetch_one(&pool)
    .await
    .expect("拒绝启动后仍应能读取原数据");
    assert_eq!(after, before);
    pool.close().await;
    drop_schema(admin, &schema).await;
}
