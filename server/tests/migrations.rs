#[path = "support/permanent_activity.rs"]
mod permanent_activity;

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

// 使用保留的旧结构建库，确保升级实际执行字段移除，而非仅在新结构伪造历史。
async fn old_schema(url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPool::connect(url).await?;
    sqlx::raw_sql(include_str!(
        "../migrations/202609230001_initial_schema.sql"
    ))
    .execute(&pool)
    .await?;
    sqlx::raw_sql("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMPTZ NOT NULL DEFAULT now(), success BOOLEAN NOT NULL, checksum BYTEA NOT NULL, execution_time BIGINT NOT NULL)").execute(&pool).await?;
    Ok(pool)
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
    assert_eq!(
        versions,
        [
            202_609_230_001,
            202_609_230_002,
            202_609_230_003,
            202_609_250_001,
            202_609_250_002,
            202_609_250_003,
            202_609_250_004
        ]
    );
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
async fn date_scope_upgrade_preserves_cash_and_explicit_allocations_but_unconfirms_pure_offsets() {
    let (admin, schema, url) = isolated_schema().await;
    let pool = PgPool::connect(&url).await.unwrap();
    let all = sqlx::migrate!("./migrations");
    let before_scope = sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(
            all.iter()
                .filter(|m| m.version < 202_609_250_003)
                .cloned()
                .collect(),
        ),
        ..sqlx::migrate::Migrator::DEFAULT
    };
    before_scope.run(&pool).await.unwrap();
    let user = Uuid::new_v4();
    let activity = Uuid::new_v4();
    let owner = Uuid::new_v4();
    let members = [owner, Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4()];
    let bills = [
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4(),
    ];
    let payment = Uuid::new_v4();
    let explicit_payment = Uuid::new_v4();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO users(id, username, password_hash, display_name, created_at, updated_at) VALUES ($1,'upgrade-cash','test','迁移用户',now(),now())").bind(user).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO activities(id,name,base_currency,start_date,owner_member_id,created_by_user_id,created_at,updated_at,revision) VALUES ($1,'日期迁移','CNY',CURRENT_DATE,$2,$3,now(),now(),10)").bind(activity).bind(owner).bind(user).execute(&mut *tx).await.unwrap();
    for (index, member) in members.iter().enumerate() {
        sqlx::query("INSERT INTO activity_members(id,activity_id,user_id,display_name,role,joined_at) VALUES ($1,$2,$3,'成员',$4,now())").bind(member).bind(activity).bind((index == 0).then_some(user)).bind(if index == 0 {"OWNER"} else {"MEMBER"}).execute(&mut *tx).await.unwrap();
    }
    // A/B 的 100 与 40 由真实 60 元转账支持；C/D 的互欠 70 没有现金支持。
    for (index, (debtor, creditor, amount)) in [(0, 1, 100_i64), (1, 0, 40), (2, 3, 70), (3, 2, 70)]
        .iter()
        .enumerate()
    {
        let bill = bills[index];
        sqlx::query("INSERT INTO expenses(id,activity_id,created_by_user_id,client_mutation_id,title,category,occurred_at,original_currency,original_amount_minor,base_currency,base_amount_minor,exchange_rate_kind,exchange_rate,split_mode,created_at,updated_at) VALUES ($1,$2,$3,$4,'历史账单','OTHER',now() - interval '1 day','CNY',$5,'CNY',$5,'IDENTITY',1,'EXACT',now() - interval '1 day',now())").bind(bill).bind(activity).bind(user).bind(Uuid::new_v4()).bind(amount).execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO expense_payments(id,activity_id,expense_id,payer_member_id,original_currency,original_amount_minor,base_currency,base_amount_minor) VALUES ($1,$2,$3,$4,'CNY',$5,'CNY',$5)").bind(Uuid::new_v4()).bind(activity).bind(bill).bind(members[*creditor]).bind(amount).execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO expense_shares(id,activity_id,expense_id,member_id,original_currency,original_amount_minor,base_currency,base_amount_minor) VALUES ($1,$2,$3,$4,'CNY',$5,'CNY',$5)").bind(Uuid::new_v4()).bind(activity).bind(bill).bind(members[*debtor]).bind(amount).execute(&mut *tx).await.unwrap();
    }
    for (id, amount, ago) in [
        (explicit_payment, 20_i64, "2 hours"),
        (payment, 40, "1 hour"),
    ] {
        sqlx::query("INSERT INTO settlements(id,activity_id,created_by_user_id,client_mutation_id,payer_member_id,receiver_member_id,currency,amount_minor,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'CNY',$7,now() - $8::interval,now())").bind(id).bind(activity).bind(user).bind(Uuid::new_v4()).bind(owner).bind(members[1]).bind(amount).bind(ago).execute(&mut *tx).await.unwrap();
    }
    sqlx::query("INSERT INTO settlement_allocations(activity_id,settlement_id,expense_id,amount_minor,created_at) VALUES ($1,$2,$3,20,now())").bind(activity).bind(explicit_payment).bind(bills[0]).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO bill_clearing_entries(id,activity_id,expense_id,member_id,offset_expense_id,kind,amount_minor,origin,created_at) VALUES ($1,$2,$3,$4,$5,'OFFSET',70,'AUTO',now())").bind(Uuid::new_v4()).bind(activity).bind(bills[2]).bind(members[2]).bind(bills[3]).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    let facts_sql = "SELECT json_build_object('payments',(SELECT json_agg(s ORDER BY id) FROM (SELECT id,payer_member_id,receiver_member_id,amount_minor FROM settlements) s),'allocations',(SELECT json_agg(a ORDER BY settlement_id) FROM settlement_allocations a))::text";
    let before: String = sqlx::query_scalar(facts_sql)
        .fetch_one(&pool)
        .await
        .unwrap();
    pool.close().await;
    let upgraded = connect_and_migrate(&url).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>(facts_sql)
            .fetch_one(&upgraded)
            .await
            .unwrap(),
        before
    );
    let mut connection = upgraded.acquire().await.unwrap();
    let state = huddletab_server::infrastructure::bill_clearing::load_state(
        &mut connection,
        activity,
        None,
    )
    .await
    .unwrap();
    assert!(state.balances(&bills).unwrap().values().all(|n| *n == 0));
    assert_eq!(state.remaining[&(bills[0], owner)], 0);
    assert_eq!(state.remaining[&(bills[2], members[2])], -70);
    assert!(
        state
            .display_entries()
            .iter()
            .any(|entry| entry.origin == "HISTORICAL_EXPLICIT")
    );
    assert!(
        state
            .display_entries()
            .iter()
            .all(|entry| entry.expense_id != bills[2] && entry.expense_id != bills[3])
    );
    drop(connection);
    upgraded.close().await;
    let replay = connect_and_migrate(&url).await.unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>(facts_sql)
            .fetch_one(&replay)
            .await
            .unwrap(),
        before
    );
    replay.close().await;
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
    let pool = old_schema(&database_url)
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
    assert_eq!(versions.last(), Some(&202_609_250_004));
    upgraded.close().await;
    drop_schema(admin, &schema).await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn v030_upgrade_invalidates_legacy_direct_and_link_invites_but_preserves_binding_invites() {
    let (admin, schema, database_url) = isolated_schema().await;
    let pool = old_schema(&database_url)
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
    assert!(invites.contains(&(direct_id, true, 2)));
    assert!(invites.contains(&(binding_id, false, 1)));
    assert!(invites.contains(&(link_id, true, 2)));
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
    let audit: (i64, i64, i64) = sqlx::query_as("SELECT revision, (SELECT count(*) FROM activity_audit_logs WHERE activity_id = $1 AND action = 'LEGACY_DIRECT_INVITATIONS_INVALIDATED'), (SELECT count(*) FROM activity_audit_logs WHERE activity_id = $1 AND action = 'LEGACY_LINK_INVITATIONS_INVALIDATED') FROM activities WHERE id = $1")
        .bind(activity_id).fetch_one(&upgraded).await.expect("应读取迁移审计");
    assert_eq!(audit, (3, 1, 1));
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

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn upgrade_purges_deleted_activities_and_preserves_live_ones() {
    let (admin, schema, url) = isolated_schema().await;
    let pool = old_schema(&url).await.unwrap();
    let user = Uuid::new_v4();
    let deleted = Uuid::new_v4();
    let owner = Uuid::new_v4();
    let kept = Uuid::new_v4();
    let kept_owner = Uuid::new_v4();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ($1, 'migration-owner', 'test', '迁移用户', NOW(), NOW())").bind(user).execute(&mut *tx).await.unwrap();
    for (activity, member) in [(deleted, owner), (kept, kept_owner)] {
        sqlx::query("INSERT INTO activities (id, name, base_currency, start_date, owner_member_id, created_by_user_id, created_at, updated_at) VALUES ($1, '迁移活动', 'JPY', CURRENT_DATE, $2, $3, NOW(), NOW())").bind(activity).bind(member).bind(user).execute(&mut *tx).await.unwrap();
        sqlx::query("INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) VALUES ($1, $2, $3, '所有者', 'OWNER', NOW())").bind(member).bind(activity).bind(user).execute(&mut *tx).await.unwrap();
    }
    tx.commit().await.unwrap();
    permanent_activity::seed_related(&pool, deleted, user, owner).await;
    sqlx::query("UPDATE activities SET deleted_at = NOW(), purge_after = NOW() + interval '30 days' WHERE id = $1").bind(deleted).execute(&pool).await.unwrap();
    install_v030_history(&pool).await;
    pool.close().await;
    let upgraded = connect_and_migrate(&url).await.unwrap();
    let activities: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM activities")
        .fetch_all(&upgraded)
        .await
        .unwrap();
    assert_eq!(activities, vec![kept]);
    let columns: i64 = sqlx::query_scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'activities' AND column_name IN ('deleted_at', 'purge_after')").fetch_one(&upgraded).await.unwrap();
    assert_eq!(columns, 0);
    for table in [
        "expenses",
        "settlements",
        "activity_invites",
        "notifications",
        "expense_attachments",
        "notification_push_deliveries",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
            .fetch_one(&upgraded)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table} 不得残留");
    }
    upgraded.close().await;
    connect_and_migrate(&url).await.unwrap().close().await;
    drop_schema(admin, &schema).await;
}
