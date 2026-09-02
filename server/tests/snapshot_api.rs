use axum::{
    body::Body,
    http::{
        HeaderMap, Request, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE, COOKIE, ETAG, IF_NONE_MATCH, ORIGIN},
    },
};
use http_body_util::BodyExt as _;
use huddletab_server::{
    http::router::{AppState, router_with_state},
    infrastructure::{
        app_secret::AppSecret,
        csrf::{CsrfContext, CsrfToken},
        database::connect_and_migrate,
        session::SessionToken,
    },
};
use serde_json::Value;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use tokio::sync::Mutex;
use tower::ServiceExt as _;
use uuid::Uuid;

static DATABASE_TEST_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Clone)]
struct SnapshotContext {
    pool: PgPool,
    app: axum::Router,
    activity_id: Uuid,
    owner_user_id: Uuid,
    owner_member_id: Uuid,
    guest_member_id: Uuid,
    owner_session: SessionToken,
    outsider_session: SessionToken,
}

// Snapshot 完整性场景需要在同一事务中明确列出 Activity、成员和全部账务事实。
#[allow(clippy::too_many_lines)]
async fn seed_context() -> SnapshotContext {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");

    let owner_user_id = Uuid::new_v4();
    let outsider_user_id = Uuid::new_v4();
    let activity_id = Uuid::new_v4();
    let owner_member_id = Uuid::new_v4();
    let guest_member_id = Uuid::new_v4();
    let expense_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let mut transaction = pool.begin().await.expect("应开启事务");
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'alice', 'unused', 'Alice', $3, $3), \
                ($2, 'outsider', 'unused', 'Outsider', $3, $3)",
    )
    .bind(owner_user_id)
    .bind(outsider_user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入用户");
    sqlx::query(
        "INSERT INTO activities (id, name, base_currency, start_date, owner_member_id, \
         created_by_user_id, revision, created_at, updated_at) \
         VALUES ($1, 'Tokyo Trip', 'CNY', '2026-08-30', $2, $3, 7, $4, $4)",
    )
    .bind(activity_id)
    .bind(owner_member_id)
    .bind(owner_user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动");
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) \
         VALUES ($1, $2, $3, 'Alice', 'OWNER', $5), \
                ($4, $2, NULL, '小林', 'MEMBER', $5)",
    )
    .bind(owner_member_id)
    .bind(activity_id)
    .bind(owner_user_id)
    .bind(guest_member_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入成员");
    sqlx::query(
        "INSERT INTO expenses (id, activity_id, created_by_user_id, client_mutation_id, title, \
         category, note, occurred_at, original_currency, original_amount_minor, base_currency, \
         base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, '晚餐', 'FOOD', '拉面', $5, 'CNY', 1000, 'CNY', 1000, \
                 'IDENTITY', 1, 'EXACT', $5, $5)",
    )
    .bind(expense_id)
    .bind(activity_id)
    .bind(owner_user_id)
    .bind(Uuid::new_v4())
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入 Expense");
    sqlx::query(
        "INSERT INTO expense_payments (id, activity_id, expense_id, payer_member_id, \
         original_currency, original_amount_minor, base_currency, base_amount_minor) \
         VALUES ($1, $2, $3, $4, 'CNY', 1000, 'CNY', 1000)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(expense_id)
    .bind(owner_member_id)
    .execute(&mut *transaction)
    .await
    .expect("应插入付款事实");
    sqlx::query(
        "INSERT INTO expense_shares (id, activity_id, expense_id, member_id, original_currency, \
         original_amount_minor, base_currency, base_amount_minor) \
         VALUES ($1, $2, $3, $4, 'CNY', 1000, 'CNY', 1000)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(expense_id)
    .bind(guest_member_id)
    .execute(&mut *transaction)
    .await
    .expect("应插入分摊事实");
    sqlx::query(
        "INSERT INTO expense_attachments (
            id, expense_id, client_attachment_id, storage_key, mime_type,
            width, height, byte_size, created_at
         ) VALUES ($1, $2, $3, $4, 'image/webp', 640, 480, 1234, $5)",
    )
    .bind(Uuid::new_v4())
    .bind(expense_id)
    .bind(Uuid::new_v4())
    .bind(format!("{activity_id}/{expense_id}/private.webp"))
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入附件元数据");
    sqlx::query(
        "INSERT INTO settlements (id, activity_id, created_by_user_id, client_mutation_id, \
         payer_member_id, receiver_member_id, currency, amount_minor, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, 'CNY', 200, $7, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(owner_user_id)
    .bind(Uuid::new_v4())
    .bind(owner_member_id)
    .bind(guest_member_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入 Settlement");
    transaction.commit().await.expect("应提交基础数据");

    let owner_session = insert_session(&pool, owner_user_id, now).await;
    let outsider_session = insert_session(&pool, outsider_user_id, now).await;
    let app = router_with_state(
        None,
        AppState::new(
            pool.clone(),
            AppSecret::from_bytes([31; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );
    SnapshotContext {
        pool,
        app,
        activity_id,
        owner_user_id,
        owner_member_id,
        guest_member_id,
        owner_session,
        outsider_session,
    }
}

async fn insert_session(pool: &PgPool, user_id: Uuid, now: OffsetDateTime) -> SessionToken {
    let session = SessionToken::generate();
    let hash = session.sha256_hash();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
         idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(hash.as_slice())
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(pool)
    .await
    .expect("应插入 Session");
    session
}

fn snapshot_request(
    context: &SnapshotContext,
    session: &SessionToken,
    if_none_match: Option<&str>,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method("GET")
        .uri(format!("/api/activities/{}/snapshot", context.activity_id))
        .header(
            COOKIE,
            format!("huddletab_session={}", session.expose_for_cookie()),
        );
    if let Some(value) = if_none_match {
        builder = builder.header(IF_NONE_MATCH, value);
    }
    builder.body(Body::empty()).expect("请求应可构造")
}

async fn raw_response(
    context: &SnapshotContext,
    request: Request<Body>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let response = context
        .app
        .clone()
        .oneshot(request)
        .await
        .expect("router 应响应");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes()
        .to_vec();
    (status, headers, bytes)
}

async fn wait_until_snapshot_blocks(pool: &PgPool) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let blocked = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity \
             WHERE datname = current_database() AND state = 'active' \
             AND wait_event_type = 'Lock' AND query LIKE '%FROM expense_payments%')",
        )
        .fetch_one(pool)
        .await
        .expect("应读取 Snapshot 查询等待状态");
        if blocked {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "Snapshot 应在读取付款事实时等待表锁"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn snapshot_returns_complete_authorized_data_and_weak_etag() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;

    let (status, headers, bytes) = raw_response(
        &context,
        snapshot_request(&context, &context.owner_session, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[ETAG], "W/\"7\"");
    assert_eq!(headers[CACHE_CONTROL], "private, no-store");
    let body: Value = serde_json::from_slice(&bytes).expect("200 应返回 JSON");
    let snapshot = &body["data"];
    assert_eq!(snapshot["revision"], "7");
    assert_eq!(
        snapshot["activity"]["activityId"],
        context.activity_id.to_string()
    );
    assert_eq!(snapshot["activity"]["revision"], "7");
    assert_eq!(snapshot["members"].as_array().map(Vec::len), Some(2));
    assert_eq!(snapshot["expenses"].as_array().map(Vec::len), Some(1));
    assert_eq!(
        snapshot["expenses"][0]["payments"].as_array().map(Vec::len),
        Some(1)
    );
    assert_eq!(
        snapshot["expenses"][0]["shares"].as_array().map(Vec::len),
        Some(1)
    );
    let attachment = &snapshot["expenses"][0]["attachments"][0];
    assert_eq!(attachment["mimeType"], "image/webp");
    assert_eq!(attachment["width"], 640);
    assert_eq!(attachment["height"], 480);
    assert_eq!(attachment["byteSize"], "1234");
    assert!(
        snapshot.to_string().find("storageKey").is_none(),
        "Snapshot 不得暴露私有存储键"
    );
    assert_eq!(snapshot["settlements"].as_array().map(Vec::len), Some(1));
    assert_eq!(snapshot["ledger"]["revision"], "7");
    assert_eq!(snapshot["recommendations"]["revision"], "7");

    let (status, headers, bytes) = raw_response(
        &context,
        snapshot_request(&context, &context.owner_session, Some("W/\"7\"")),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_MODIFIED);
    assert_eq!(headers[ETAG], "W/\"7\"");
    assert_eq!(headers[CACHE_CONTROL], "private, no-store");
    assert!(bytes.is_empty(), "304 不应返回 body");

    for condition in ["W/\"6\"", "invalid-etag"] {
        let (status, _, bytes) = raw_response(
            &context,
            snapshot_request(&context, &context.owner_session, Some(condition)),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(!bytes.is_empty());
    }

    let (status, _, _) = raw_response(
        &context,
        snapshot_request(&context, &context.outsider_session, Some("W/\"7\"")),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn invite_mode_revision_invalidates_snapshot_etag() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;

    let (status, headers, bytes) = raw_response(
        &context,
        snapshot_request(&context, &context.owner_session, None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[ETAG], "W/\"7\"");
    let initial: Value = serde_json::from_slice(&bytes).expect("响应应为 JSON");
    assert_eq!(initial["data"]["activity"]["inviteMode"], "DIRECT_JOIN");

    sqlx::query(
        "UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL', revision = 8,
         version = version + 1, updated_at = NOW() WHERE id = $1",
    )
    .bind(context.activity_id)
    .execute(&context.pool)
    .await
    .expect("应修改邀请模式并推进 revision");

    let (status, headers, bytes) = raw_response(
        &context,
        snapshot_request(&context, &context.owner_session, Some("W/\"7\"")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[ETAG], "W/\"8\"");
    let modified: Value = serde_json::from_slice(&bytes).expect("响应应为 JSON");
    assert_eq!(modified["data"]["revision"], "8");
    assert_eq!(
        modified["data"]["activity"]["inviteMode"],
        "REQUIRE_APPROVAL"
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 单个场景连续验证绑定前后 ETag 和成员身份，避免拆分后重复数据库 fixture。
#[allow(clippy::too_many_lines)]
async fn guest_binding_updates_snapshot_without_changing_member_identity() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(context.activity_id)
        .execute(&context.pool)
        .await
        .expect("测试活动应启用审批模式");
    let target_user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
         VALUES ($1, 'binding-target', 'unused', '绑定用户', $2, $2)",
    )
    .bind(target_user_id)
    .bind(now)
    .execute(&context.pool)
    .await
    .expect("应插入绑定目标用户");
    let target_session = insert_session(&context.pool, target_user_id, now).await;
    let secret = AppSecret::from_bytes([31; 32]);
    let owner_csrf = CsrfToken::mint(
        &secret,
        CsrfContext::Session(&context.owner_session.sha256_hash()),
    );

    let create_response = context
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/api/activities/{}/members/{}/binding-invitations",
                    context.activity_id, context.guest_member_id
                ))
                .header(CONTENT_TYPE, "application/json")
                .header(
                    COOKIE,
                    format!(
                        "huddletab_session={}",
                        context.owner_session.expose_for_cookie()
                    ),
                )
                .header(ORIGIN, "http://localhost:5660")
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", owner_csrf.expose_for_header())
                .body(Body::from(r#"{"targetUsername":"binding-target"}"#))
                .expect("创建绑定邀请请求应可构造"),
        )
        .await
        .expect("router 应响应");
    assert_eq!(create_response.status(), StatusCode::CREATED);
    let create_body = create_response
        .into_body()
        .collect()
        .await
        .expect("应读取绑定邀请响应")
        .to_bytes();
    let created: Value = serde_json::from_slice(&create_body).expect("响应应为 JSON");
    let token = created["data"]["token"]
        .as_str()
        .expect("应返回一次性 token");

    let (before_status, before_headers, _) = raw_response(
        &context,
        snapshot_request(&context, &context.owner_session, None),
    )
    .await;
    assert_eq!(before_status, StatusCode::OK);
    assert_eq!(before_headers[ETAG], "W/\"8\"");

    let target_csrf = CsrfToken::mint(&secret, CsrfContext::Session(&target_session.sha256_hash()));
    let join_response = context
        .app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/invitations/{token}/join"))
                .header(CONTENT_TYPE, "application/json")
                .header(
                    COOKIE,
                    format!("huddletab_session={}", target_session.expose_for_cookie()),
                )
                .header(ORIGIN, "http://localhost:5660")
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", target_csrf.expose_for_header())
                .body(Body::from("{}"))
                .expect("确认绑定请求应可构造"),
        )
        .await
        .expect("router 应响应");
    assert_eq!(join_response.status(), StatusCode::OK);
    let join_body = join_response
        .into_body()
        .collect()
        .await
        .expect("应读取绑定响应")
        .to_bytes();
    let joined: Value = serde_json::from_slice(&join_body).expect("响应应为 JSON");
    assert_eq!(joined["data"]["status"], "BOUND");

    let (status, headers, bytes) = raw_response(
        &context,
        snapshot_request(&context, &target_session, Some("W/\"8\"")),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[ETAG], "W/\"9\"");
    let snapshot: Value = serde_json::from_slice(&bytes).expect("响应应为 JSON");
    let bound_members = snapshot["data"]["members"]
        .as_array()
        .expect("Snapshot 应包含成员")
        .iter()
        .filter(|member| member["memberId"] == context.guest_member_id.to_string())
        .collect::<Vec<_>>();
    assert_eq!(bound_members.len(), 1);
    assert_eq!(bound_members[0]["userId"], target_user_id.to_string());
    assert_eq!(bound_members[0]["displayName"], "小林");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn snapshot_keeps_revision_and_facts_in_one_repeatable_read_view() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let mut blocker = context.pool.begin().await.expect("应开启阻塞事务");
    sqlx::query("LOCK TABLE expense_payments IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .expect("应锁住付款事实表");

    let task_context = context.clone();
    let request = snapshot_request(&context, &context.owner_session, None);
    let snapshot_task = tokio::spawn(async move { raw_response(&task_context, request).await });
    wait_until_snapshot_blocks(&context.pool).await;

    let now = OffsetDateTime::now_utc();
    let mut writer = context.pool.begin().await.expect("应开启写事务");
    sqlx::query("UPDATE activities SET revision = revision + 1, updated_at = $2 WHERE id = $1")
        .bind(context.activity_id)
        .bind(now)
        .execute(&mut *writer)
        .await
        .expect("应推进 revision");
    sqlx::query(
        "INSERT INTO settlements (id, activity_id, created_by_user_id, client_mutation_id, \
         payer_member_id, receiver_member_id, currency, amount_minor, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, 'CNY', 300, $7, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(context.activity_id)
    .bind(context.owner_user_id)
    .bind(Uuid::new_v4())
    .bind(context.owner_member_id)
    .bind(context.guest_member_id)
    .bind(now)
    .execute(&mut *writer)
    .await
    .expect("应插入并发 Settlement");
    writer.commit().await.expect("应提交并发写");
    blocker.commit().await.expect("应释放表锁");

    let (status, headers, bytes) = snapshot_task.await.expect("Snapshot 请求应完成");
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[ETAG], "W/\"7\"");
    let body: Value = serde_json::from_slice(&bytes).expect("响应应为 JSON");
    assert_eq!(body["data"]["revision"], "7");
    assert_eq!(
        body["data"]["settlements"].as_array().map(Vec::len),
        Some(1)
    );
    let persisted = sqlx::query_as::<_, (i64, i64)>(
        "SELECT revision, (SELECT count(*) FROM settlements WHERE activity_id = $1) \
         FROM activities WHERE id = $1",
    )
    .bind(context.activity_id)
    .fetch_one(&context.pool)
    .await
    .expect("应读取最终事实");
    assert_eq!(persisted, (8, 2));
}
