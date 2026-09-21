use huddletab_server::infrastructure::database::connect_and_migrate;
use sqlx::PgPool;
use std::borrow::Cow;
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

    assert_eq!(applied_count, 8);
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
async fn phase2_schema_upgrades_to_ai_image_migration() {
    let (admin, schema, database_url) = isolated_schema().await;
    let phase2_pool = PgPool::connect(&database_url)
        .await
        .expect("应连接阶段二测试 schema");
    let all_migrations = sqlx::migrate!("./migrations");
    let phase2_migrator = sqlx::migrate::Migrator {
        migrations: Cow::Owned(all_migrations.iter().take(3).cloned().collect()),
        ..all_migrations
    };
    phase2_migrator
        .run(&phase2_pool)
        .await
        .expect("阶段二结构应可初始化");
    let phase2_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&phase2_pool)
        .await
        .expect("应读取阶段二 migration 记录");
    assert_eq!(phase2_count, 3);
    phase2_pool.close().await;

    let upgraded = connect_and_migrate(&database_url)
        .await
        .expect("阶段二结构应升级到图片 AI migration");
    let settings: (bool, i32, String, Option<String>, i32) = sqlx::query_as(
        "SELECT ai_image_enabled, ai_provider_max_image_bytes, ai_provider_models::text, \
         ai_provider_default_model, ai_provider_timeout_seconds \
         FROM system_settings WHERE id = 'singleton'",
    )
    .fetch_one(&upgraded)
    .await
    .expect("升级后应读取图片设置");
    assert_eq!(
        settings,
        (false, 10 * 1024 * 1024, "[]".to_owned(), None, 30)
    );
    let migration_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(&upgraded)
        .await
        .expect("应读取升级后的 migration 记录");
    assert_eq!(migration_count, 8);
    upgraded.close().await;
    drop_schema(admin, &schema).await;
}

#[test]
fn ai_migration_declares_encrypted_settings_and_secret_free_audit_shape() {
    let migration = include_str!("../migrations/202609190002_ai_expense_draft.sql");
    for fragment in [
        "ai_expense_draft_enabled",
        "ai_provider_base_url",
        "ai_provider_models JSONB",
        "ai_provider_default_model",
        "ai_provider_json_mode BOOLEAN NOT NULL DEFAULT TRUE",
        "ai_provider_timeout_seconds",
        "ai_provider_api_key_envelope BYTEA",
        "CREATE TABLE system_admin_audit_logs",
        "changed_fields TEXT[]",
        "secret_action",
    ] {
        assert!(migration.contains(fragment), "AI migration 缺少 {fragment}");
    }
    for forbidden in ["api_key TEXT", "nonce", "prompt", "response_body"] {
        assert!(
            !migration.contains(forbidden),
            "AI migration 不得存储 {forbidden}"
        );
    }
}

#[test]
fn ai_image_migration_declares_safe_defaults_and_limit() {
    let migration = include_str!("../migrations/202609190003_ai_expense_image.sql");
    for fragment in [
        "ai_image_enabled BOOLEAN NOT NULL DEFAULT FALSE",
        "ai_provider_max_image_bytes INTEGER NOT NULL DEFAULT 10485760",
    ] {
        assert!(
            migration.contains(fragment),
            "图片 AI migration 缺少 {fragment}"
        );
    }
}

#[test]
fn ai_timeout_migration_aligns_database_with_application_range() {
    let migration = include_str!("../migrations/202609200001_ai_timeout_minimum.sql");
    assert!(
        migration.contains("DROP CONSTRAINT system_settings_ai_provider_timeout_seconds_check")
    );
    assert!(migration.contains("BETWEEN 1 AND 120"));
}

#[test]
fn push_migration_declares_durable_queue_and_safe_device_defaults() {
    let migration = include_str!("../migrations/202609210001_pwa_push.sql");
    for fragment in [
        "ADD COLUMN push_enqueued_at TIMESTAMPTZ",
        "CREATE TABLE notification_push_preferences",
        "CREATE TABLE push_subscriptions",
        "CREATE TABLE notification_push_deliveries",
        "UNIQUE (notification_id, subscription_id)",
        "status IN ('PENDING', 'RETRY', 'DELIVERED', 'FAILED', 'CANCELLED')",
    ] {
        assert!(
            migration.contains(fragment),
            "推送 migration 缺少 {fragment}"
        );
    }
    assert!(migration.contains("SET push_enqueued_at = created_at"));
}

#[test]
fn mcp_migration_declares_hashed_scoped_tokens() {
    let migration = include_str!("../migrations/202609210002_mcp_access_tokens.sql");
    for fragment in [
        "CREATE TABLE mcp_access_tokens",
        "token_hash BYTEA NOT NULL UNIQUE",
        "scope IN ('READ', 'EXPENSES_CREATE')",
        "revoked_at TIMESTAMPTZ",
        "mcp_access_tokens_active_hash_idx",
    ] {
        assert!(
            migration.contains(fragment),
            "MCP migration 缺少 {fragment}"
        );
    }
    assert!(
        !migration.contains("token TEXT"),
        "MCP migration 不得存储令牌原文"
    );
}

#[test]
fn activity_profile_image_migration_declares_preset_ranges_and_private_metadata() {
    let migration = include_str!("../migrations/202609210003_activity_profile_images.sql");
    for fragment in [
        "cover_preset SMALLINT",
        "BETWEEN 1 AND 12",
        "ALTER COLUMN cover_preset SET DEFAULT 12",
        "CHECK (avatar_preset BETWEEN 1 AND 11)",
        "CREATE TABLE activity_cover_images",
        "CREATE TABLE user_avatar_images",
        "storage_key TEXT NOT NULL UNIQUE",
        "width INTEGER NOT NULL CHECK (width = 1200)",
        "width INTEGER NOT NULL CHECK (width = 512)",
    ] {
        assert!(
            migration.contains(fragment),
            "图片 migration 缺少 {fragment}"
        );
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn retired_migration_is_rejected_without_changing_data_or_records() {
    let (admin, schema, database_url) = isolated_schema().await;
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("应初始化隔离测试结构");
    // 只模拟已退役的迁移记录，不在当前测试中重新维护整套旧版本建库 SQL。
    sqlx::query(
        "DELETE FROM _sqlx_migrations WHERE version <> (SELECT MIN(version) FROM _sqlx_migrations)",
    )
    .execute(&pool)
    .await
    .expect("应保留一条迁移记录用于模拟旧版本");
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
