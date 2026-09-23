use huddletab_server::infrastructure::database::connect_and_migrate;
use sqlx::PgPool;
use uuid::Uuid;

const V030_MIGRATIONS: [i64; 8] = [
    202_609_090_001,
    202_609_190_001,
    202_609_190_002,
    202_609_190_003,
    202_609_200_001,
    202_609_210_001,
    202_609_210_002,
    202_609_210_003,
];

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

// 只替换 SQLx 历史以测试启动路径；真正的 v0.0.30 建库需在发布验收中用旧镜像验证。
async fn install_v030_history(pool: &PgPool) {
    sqlx::query("DELETE FROM _sqlx_migrations")
        .execute(pool)
        .await
        .expect("应删除新安装迁移记录");
    for version in V030_MIGRATIONS {
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
             VALUES ($1, 'v0.0.30 test history', TRUE, decode('00', 'hex'), 0)",
        )
        .bind(version)
        .execute(pool)
        .await
        .expect("应写入 v0.0.30 迁移记录");
    }
}

async fn database_snapshot(pool: &PgPool) -> String {
    sqlx::query_scalar(
        "SELECT json_build_object(\
         'migrations', (SELECT json_agg(m ORDER BY version) FROM _sqlx_migrations m), \
         'settings', (SELECT json_agg(s) FROM system_settings s), \
         'users', (SELECT json_agg(u) FROM users u))::text",
    )
    .fetch_one(pool)
    .await
    .expect("应读取数据库快照")
}

async fn business_snapshot(pool: &PgPool) -> String {
    sqlx::query_scalar(
        "SELECT json_build_object(\
         'settings', (SELECT json_agg(s) FROM system_settings s), \
         'users', (SELECT json_agg(u) FROM users u))::text",
    )
    .fetch_one(pool)
    .await
    .expect("应读取业务数据快照")
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn fresh_database_migrates_and_replay_is_idempotent() {
    let (admin, schema, database_url) = isolated_schema().await;
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("空数据库应可执行新安装迁移");
    let settings: (String, i64, i32, i32) = sqlx::query_as(
        "SELECT registration_policy, version, ai_provider_timeout_seconds, \
         ai_provider_max_image_bytes FROM system_settings WHERE id = 'singleton'",
    )
    .fetch_one(&pool)
    .await
    .expect("应创建当前系统设置");
    assert_eq!(settings, ("INVITE_ONLY".into(), 1, 30, 10 * 1024 * 1024));
    sqlx::query("UPDATE system_settings SET registration_policy = 'OPEN', version = 2")
        .execute(&pool)
        .await
        .expect("应可修改持久化设置");
    pool.close().await;

    let replayed_pool = connect_and_migrate(&database_url)
        .await
        .expect("重复启动不应重复执行建库迁移");
    let versions: Vec<i64> = sqlx::query_scalar("SELECT version FROM _sqlx_migrations")
        .fetch_all(&replayed_pool)
        .await
        .expect("应可读取 SQLx 迁移记录");
    assert_eq!(versions, [202_609_230_001, 202_609_230_002]);
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
async fn missing_baseline_record_is_rejected_without_changes() {
    let (admin, schema, database_url) = isolated_schema().await;
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("应初始化隔离测试结构");
    sqlx::query("DELETE FROM _sqlx_migrations")
        .execute(&pool)
        .await
        .expect("应删除新安装迁移记录");
    let before = database_snapshot(&pool).await;

    let error = connect_and_migrate(&database_url)
        .await
        .expect_err("缺少新安装迁移记录时不可继续启动");
    assert!(error.to_string().contains("数据库结构与迁移记录不匹配"));
    assert_eq!(database_snapshot(&pool).await, before);
    pool.close().await;
    drop_schema(admin, &schema).await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn v030_history_preserves_business_data_without_applying_baseline() {
    let (admin, schema, database_url) = isolated_schema().await;
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("应初始化隔离测试结构");
    let user_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'upgrade-user', 'test-hash', '升级用户', NOW(), NOW())",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("应插入业务数据");
    install_v030_history(&pool).await;
    let before = business_snapshot(&pool).await;
    pool.close().await;

    let upgraded = connect_and_migrate(&database_url)
        .await
        .expect("完整 v0.0.30 迁移记录应可继续启动");
    assert_eq!(business_snapshot(&upgraded).await, before);
    let versions: Vec<i64> =
        sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&upgraded)
            .await
            .expect("应读取升级记录");
    assert_eq!(versions.last(), Some(&202_609_230_002));
    upgraded.close().await;
    drop_schema(admin, &schema).await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn v030_upgrade_invalidates_only_ordinary_direct_invites_and_pending_requests() {
    let (admin, schema, database_url) = isolated_schema().await;
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("应初始化隔离测试结构");
    let owner_id = Uuid::new_v4();
    let applicant_id = Uuid::new_v4();
    let activity_id = Uuid::new_v4();
    let owner_member_id = Uuid::new_v4();
    let guest_member_id = Uuid::new_v4();
    let direct_id = Uuid::new_v4();
    let binding_id = Uuid::new_v4();
    let link_id = Uuid::new_v4();
    let request_id = Uuid::new_v4();
    let owner_notice_id = Uuid::new_v4();
    let mut tx = pool.begin().await.expect("应开启旧数据事务");
    sqlx::query("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ($1, 'owner', 'test', '所有者', NOW(), NOW()), ($2, 'applicant', 'test', '申请人', NOW(), NOW())")
        .bind(owner_id).bind(applicant_id).execute(&mut *tx).await.expect("应插入用户");
    sqlx::query("INSERT INTO activities (id, name, base_currency, start_date, owner_member_id, created_by_user_id, created_at, updated_at, invite_mode) VALUES ($1, '旧活动', 'CNY', CURRENT_DATE, $2, $3, NOW(), NOW(), 'REQUIRE_APPROVAL')")
        .bind(activity_id).bind(owner_member_id).bind(owner_id).execute(&mut *tx).await.expect("应插入活动");
    sqlx::query("INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) VALUES ($1, $2, $3, '所有者', 'OWNER', NOW()), ($4, $2, NULL, '临时成员', 'MEMBER', NOW())")
        .bind(owner_member_id).bind(activity_id).bind(owner_id).bind(guest_member_id)
        .execute(&mut *tx).await.expect("应插入成员");
    sqlx::query("INSERT INTO activity_invites (id, activity_id, created_by_member_id, token_hash, kind, target_display_name, expires_at, max_uses, created_at, guest_member_id) VALUES
        ($1, $4, $5, decode(repeat('11', 32), 'hex'), 'DIRECT', 'applicant', NOW() + interval '1 day', 1, NOW(), NULL),
        ($2, $4, $5, decode(repeat('22', 32), 'hex'), 'DIRECT', 'applicant', NOW() + interval '1 day', 1, NOW(), $6),
        ($3, $4, $5, decode(repeat('33', 32), 'hex'), 'LINK', NULL, NOW() + interval '1 day', NULL, NOW(), NULL)")
        .bind(direct_id).bind(binding_id).bind(link_id).bind(activity_id).bind(owner_member_id).bind(guest_member_id)
        .execute(&mut *tx).await.expect("应插入三类旧邀请");
    sqlx::query("INSERT INTO activity_join_requests (id, activity_id, invitation_id, applicant_user_id, created_at) VALUES ($1, $2, $3, $4, NOW())")
        .bind(request_id).bind(activity_id).bind(direct_id).bind(applicant_id)
        .execute(&mut *tx).await.expect("应插入待审批申请");
    sqlx::query("INSERT INTO notifications (id, recipient_user_id, type, target_type, target_id, activity_id, payload, created_at) VALUES ($1, $2, 'JOIN_APPROVAL_REQUESTED', 'ACTIVITY', $3, $3, jsonb_build_object('requestId', $4::text), NOW())")
        .bind(owner_notice_id).bind(owner_id).bind(activity_id).bind(request_id)
        .execute(&mut *tx).await.expect("应插入所有者待审批通知");
    tx.commit().await.expect("应提交旧数据");
    install_v030_history(&pool).await;
    pool.close().await;

    let upgraded = connect_and_migrate(&database_url)
        .await
        .expect("应升级 v0.0.30 旧邀请");
    let invites: Vec<(Uuid, bool, i64)> = sqlx::query_as(
        "SELECT id, revoked_at IS NOT NULL, version FROM activity_invites ORDER BY id",
    )
    .fetch_all(&upgraded)
    .await
    .expect("应读取邀请状态");
    assert_eq!(invites.len(), 3);
    assert!(invites.iter().any(|row| *row == (direct_id, true, 2)));
    assert!(invites.iter().any(|row| *row == (binding_id, false, 1)));
    assert!(invites.iter().any(|row| *row == (link_id, false, 1)));
    let request: (String, bool, bool) = sqlx::query_as("SELECT status, decided_at IS NOT NULL, decided_by_member_id IS NULL FROM activity_join_requests WHERE id = $1")
        .bind(request_id).fetch_one(&upgraded).await.expect("应读取申请状态");
    assert_eq!(request, ("INVALIDATED".to_owned(), true, true));
    let owner_notice: (bool, String) = sqlx::query_as(
        "SELECT read_at IS NOT NULL, payload->>'status' FROM notifications WHERE id = $1",
    )
    .bind(owner_notice_id)
    .fetch_one(&upgraded)
    .await
    .expect("应读取所有者通知");
    assert_eq!(owner_notice, (true, "INVALIDATED".to_owned()));
    let applicant_notice_count: i64 = sqlx::query_scalar("SELECT count(*) FROM notifications WHERE recipient_user_id = $1 AND type = 'JOIN_APPROVAL_RESOLVED' AND payload->>'status' = 'INVALIDATED'")
        .bind(applicant_id).fetch_one(&upgraded).await.expect("应读取申请人通知");
    assert_eq!(applicant_notice_count, 1);
    let audit: (i64, i64) = sqlx::query_as("SELECT revision, (SELECT count(*) FROM activity_audit_logs WHERE activity_id = $1 AND action = 'LEGACY_DIRECT_INVITATIONS_INVALIDATED') FROM activities WHERE id = $1")
        .bind(activity_id).fetch_one(&upgraded).await.expect("应读取迁移审计");
    assert_eq!(audit, (2, 1));
    upgraded.close().await;
    drop_schema(admin, &schema).await;
}

#[tokio::test]
#[ignore = "需要 TEST_V030_DATABASE_URL 指向用 v0.0.30 原始迁移建立的可丢弃数据库"]
async fn real_v030_database_upgrades_without_rewriting_data() {
    let database_url = std::env::var("TEST_V030_DATABASE_URL")
        .expect("运行真实 v0.0.30 升级测试前必须设置 TEST_V030_DATABASE_URL");
    let pool = PgPool::connect(&database_url)
        .await
        .expect("应连接 v0.0.30 测试库");
    let before = business_snapshot(&pool).await;
    pool.close().await;

    let upgraded = connect_and_migrate(&database_url)
        .await
        .expect("v0.0.30 原始结构应可原地升级");
    assert_eq!(business_snapshot(&upgraded).await, before);
    let applied: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM _sqlx_migrations WHERE version = 202609230002)",
    )
    .fetch_one(&upgraded)
    .await
    .expect("应读取升级记录");
    assert!(applied);
    upgraded.close().await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn incomplete_or_unknown_history_is_rejected_without_changes() {
    for unknown_version in [None, Some(202_609_220_001_i64)] {
        let (admin, schema, database_url) = isolated_schema().await;
        let pool = connect_and_migrate(&database_url)
            .await
            .expect("应初始化隔离测试结构");
        install_v030_history(&pool).await;
        if let Some(version) = unknown_version {
            sqlx::query("UPDATE _sqlx_migrations SET version = $1 WHERE version = $2")
                .bind(version)
                .bind(V030_MIGRATIONS[0])
                .execute(&pool)
                .await
                .expect("应替换为未知迁移记录");
        } else {
            sqlx::query("DELETE FROM _sqlx_migrations WHERE version = $1")
                .bind(V030_MIGRATIONS[7])
                .execute(&pool)
                .await
                .expect("应删除一条历史记录");
        }
        let before = database_snapshot(&pool).await;
        let error = connect_and_migrate(&database_url)
            .await
            .expect_err("不完整或未知历史不可继续初始化");
        assert!(
            error
                .to_string()
                .contains("不属于受支持的 v0.0.30 升级起点")
        );
        assert_eq!(database_snapshot(&pool).await, before);
        pool.close().await;
        drop_schema(admin, &schema).await;
    }
}
