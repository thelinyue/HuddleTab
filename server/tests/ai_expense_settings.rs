use huddletab_server::{
    application::ai_expense::{
        AiExpenseRepository, AiModelConfig, AiSettingsError, AiSettingsUpdate, AiSettingsWrite,
        prepare_settings_update,
    },
    infrastructure::{
        ai_expense_repository::PostgresAiExpenseRepository, app_secret::AppSecret,
        database::connect_and_migrate,
    },
};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

async fn pool() -> PgPool {
    let url = std::env::var("TEST_DATABASE_URL").expect("需要 TEST_DATABASE_URL");
    connect_and_migrate(&url).await.expect("测试数据库应可迁移")
}

async fn seed_admin(pool: &PgPool, id: Uuid) {
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'ai-admin', 'test-password-hash', 'AI Admin', $2, $2)",
    )
    .bind(id)
    .bind(now)
    .execute(pool)
    .await
    .expect("应插入测试管理员");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
#[allow(clippy::too_many_lines)]
async fn ai_settings_cover_defaults_version_key_lifecycle_and_atomic_audit() {
    let pool = pool().await;
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清理测试用户");
    let admin = Uuid::new_v4();
    seed_admin(&pool, admin).await;
    sqlx::query(
        "UPDATE system_settings SET ai_expense_draft_enabled = FALSE, ai_provider_base_url = NULL, \
         ai_provider_models = '[]'::jsonb, ai_provider_default_model = NULL, ai_provider_json_mode = TRUE, ai_provider_timeout_seconds = 30, \
         ai_image_enabled = FALSE, ai_provider_max_image_bytes = 10485760, \
         ai_provider_api_key_envelope = NULL, version = 1, updated_at = now(), updated_by_user_id = NULL",
    )
    .execute(&pool)
    .await
    .expect("应重置 AI 设置");
    sqlx::query("DELETE FROM system_admin_audit_logs")
        .execute(&pool)
        .await
        .expect("应清理 AI 系统审计");
    let repository = PostgresAiExpenseRepository::new(pool.clone());
    let secret = AppSecret::from_bytes([7; 32]);
    let current = repository.get_settings().await.expect("应读取默认设置");
    assert!(!current.enabled);
    assert!(current.json_mode);
    assert_eq!(current.timeout_seconds, 30);
    assert!(!current.image_enabled);
    assert_eq!(current.max_image_bytes, 10 * 1024 * 1024);
    assert!(current.models.is_empty());
    assert!(current.default_model.is_none());
    assert_eq!(current.version, 1);
    assert!(current.api_key_envelope.is_none());
    for invalid_limit in [0, 10 * 1024 * 1024 + 1] {
        let error = sqlx::query("UPDATE system_settings SET ai_provider_max_image_bytes = $1")
            .bind(invalid_limit)
            .execute(&pool)
            .await
            .expect_err("图片大小上限必须落在 1..=10 MiB");
        assert!(error.to_string().contains("ai_provider_max_image_bytes"));
    }

    let now = OffsetDateTime::now_utc();
    let first_write = prepare_settings_update(
        &current,
        AiSettingsUpdate {
            enabled: true,
            base_url: Some("https://api.deepseek.com/v1/".to_owned()),
            models: vec![
                AiModelConfig {
                    name: "deepseek-chat".to_owned(),
                    supports_image: true,
                },
                AiModelConfig {
                    name: "deepseek-vision".to_owned(),
                    supports_image: true,
                },
            ],
            default_model: Some("deepseek-vision".to_owned()),
            json_mode: true,
            timeout_seconds: 30,
            image_enabled: true,
            max_image_bytes: 5 * 1024 * 1024,
            api_key: Some("test-key-value".to_owned()),
            clear_api_key: false,
            expected_version: 1,
        },
        &secret,
    )
    .expect("首次配置应成功");
    assert_eq!(first_write.secret_action.as_deref(), Some("SET"));
    let configured = repository
        .update_settings(admin, 1, first_write, now)
        .await
        .expect("首次配置应提交");
    assert_eq!(configured.version, 2);
    assert_eq!(
        configured.base_url.as_deref(),
        Some("https://api.deepseek.com/v1")
    );
    assert!(configured.image_enabled);
    assert_eq!(configured.max_image_bytes, 5 * 1024 * 1024);
    assert_eq!(configured.default_model.as_deref(), Some("deepseek-vision"));
    assert_eq!(configured.models.len(), 2);
    assert!(configured.api_key_envelope.is_some());

    let audit: (Vec<String>, Option<String>) = sqlx::query_as(
        "SELECT changed_fields, secret_action FROM system_admin_audit_logs \
         WHERE actor_user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(admin)
    .fetch_one(&pool)
    .await
    .expect("应写系统管理员审计");
    assert!(audit.0.iter().any(|field| field == "baseUrl"));
    assert_eq!(audit.1.as_deref(), Some("SET"));

    assert!(matches!(
        repository
            .update_settings(
                admin,
                1,
                AiSettingsWrite {
                    enabled: false,
                    base_url: None,
                    models: Vec::new(),
                    default_model: None,
                    json_mode: true,
                    timeout_seconds: 30,
                    image_enabled: false,
                    max_image_bytes: 10 * 1024 * 1024,
                    api_key_envelope: None,
                    changed_fields: vec!["enabled".to_owned()],
                    secret_action: None,
                },
                now,
            )
            .await,
        Err(huddletab_server::application::ai_expense::AiRepositoryError::VersionConflict)
    ));

    let preserved = prepare_settings_update(
        &configured,
        AiSettingsUpdate {
            enabled: true,
            base_url: configured.base_url.clone(),
            models: configured.models.clone(),
            default_model: configured.default_model.clone(),
            json_mode: false,
            timeout_seconds: 45,
            image_enabled: configured.image_enabled,
            max_image_bytes: configured.max_image_bytes,
            api_key: None,
            clear_api_key: false,
            expected_version: configured.version,
        },
        &secret,
    )
    .expect("关闭 JSON Mode 应成功");
    assert!(preserved.secret_action.is_none());
    let preserved = repository
        .update_settings(admin, configured.version, preserved, now)
        .await
        .expect("保留密钥的更新应成功");
    assert!(!preserved.json_mode);
    assert_eq!(preserved.api_key_envelope, configured.api_key_envelope);
    let json_mode_audits: Vec<(Vec<String>, Option<String>)> = sqlx::query_as(
        "SELECT changed_fields, secret_action FROM system_admin_audit_logs \
         WHERE actor_user_id = $1",
    )
    .bind(admin)
    .fetch_all(&pool)
    .await
    .expect("应记录 JSON Mode 设置变更");
    assert!(json_mode_audits.iter().any(|(fields, action)| {
        fields.iter().any(|field| field == "jsonMode") && action.is_none()
    }));

    let replacement = prepare_settings_update(
        &preserved,
        AiSettingsUpdate {
            enabled: true,
            base_url: preserved.base_url.clone(),
            models: preserved.models.clone(),
            default_model: preserved.default_model.clone(),
            json_mode: false,
            timeout_seconds: 45,
            image_enabled: preserved.image_enabled,
            max_image_bytes: preserved.max_image_bytes,
            api_key: Some("replacement-key".to_owned()),
            clear_api_key: false,
            expected_version: preserved.version,
        },
        &secret,
    )
    .expect("替换密钥应成功");
    assert_eq!(replacement.secret_action.as_deref(), Some("REPLACED"));
    let replaced = repository
        .update_settings(admin, preserved.version, replacement, now)
        .await
        .expect("替换密钥应提交");
    assert_ne!(replaced.api_key_envelope, preserved.api_key_envelope);

    let corrupted: Vec<u8> = vec![1, 2, 3, 4];
    sqlx::query("UPDATE system_settings SET ai_provider_api_key_envelope = $1::bytea")
        .bind(corrupted.as_slice())
        .execute(&pool)
        .await
        .expect("应写入损坏测试密文");
    let corrupted_settings = repository.get_settings().await.expect("应读取损坏设置");
    assert!(matches!(
        prepare_settings_update(
            &corrupted_settings,
            AiSettingsUpdate {
                enabled: true,
                base_url: corrupted_settings.base_url.clone(),
                models: corrupted_settings.models.clone(),
                default_model: corrupted_settings.default_model.clone(),
                json_mode: false,
                timeout_seconds: 45,
                image_enabled: corrupted_settings.image_enabled,
                max_image_bytes: corrupted_settings.max_image_bytes,
                api_key: None,
                clear_api_key: false,
                expected_version: corrupted_settings.version,
            },
            &secret,
        ),
        Err(AiSettingsError::ReconfigurationRequired)
    ));

    let reconfigured = prepare_settings_update(
        &corrupted_settings,
        AiSettingsUpdate {
            enabled: true,
            base_url: corrupted_settings.base_url.clone(),
            models: corrupted_settings.models.clone(),
            default_model: corrupted_settings.default_model.clone(),
            json_mode: false,
            timeout_seconds: 45,
            image_enabled: corrupted_settings.image_enabled,
            max_image_bytes: corrupted_settings.max_image_bytes,
            api_key: Some("reconfigured-key".to_owned()),
            clear_api_key: false,
            expected_version: corrupted_settings.version,
        },
        &secret,
    )
    .expect("损坏密文应允许管理员重新配置");
    assert_eq!(reconfigured.secret_action.as_deref(), Some("REPLACED"));
    let reconfigured = repository
        .update_settings(admin, corrupted_settings.version, reconfigured, now)
        .await
        .expect("重新配置密钥应提交");

    let clearing = prepare_settings_update(
        &reconfigured,
        AiSettingsUpdate {
            enabled: false,
            base_url: reconfigured.base_url.clone(),
            models: reconfigured.models.clone(),
            default_model: reconfigured.default_model.clone(),
            json_mode: false,
            timeout_seconds: 45,
            image_enabled: false,
            max_image_bytes: reconfigured.max_image_bytes,
            api_key: None,
            clear_api_key: true,
            expected_version: reconfigured.version,
        },
        &secret,
    )
    .expect("清除密钥应成功");
    assert_eq!(clearing.secret_action.as_deref(), Some("CLEARED"));
    let cleared = repository
        .update_settings(admin, reconfigured.version, clearing, now)
        .await
        .expect("清除密钥应提交");
    assert!(cleared.api_key_envelope.is_none());

    let before_atomic = repository.get_settings().await.expect("应读取原设置");
    let failed = repository
        .update_settings(
            admin,
            before_atomic.version,
            AiSettingsWrite {
                enabled: false,
                base_url: before_atomic.base_url.clone(),
                models: before_atomic.models.clone(),
                default_model: before_atomic.default_model.clone(),
                json_mode: before_atomic.json_mode,
                timeout_seconds: before_atomic.timeout_seconds,
                image_enabled: before_atomic.image_enabled,
                max_image_bytes: before_atomic.max_image_bytes,
                api_key_envelope: before_atomic.api_key_envelope.clone(),
                changed_fields: vec!["enabled".to_owned()],
                secret_action: Some("INVALID".to_owned()),
            },
            now,
        )
        .await;
    assert!(failed.is_err());
    let after_atomic = repository
        .get_settings()
        .await
        .expect("事务失败后应可读取设置");
    assert_eq!(after_atomic.version, before_atomic.version);
    assert_eq!(after_atomic.enabled, before_atomic.enabled);

    pool.close().await;
}
