use axum::{
    body::Body,
    http::{
        Request, StatusCode,
        header::{CONTENT_TYPE, COOKIE, ORIGIN},
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
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use tower::ServiceExt as _;
use uuid::Uuid;

struct TestActor {
    user_id: Uuid,
    session: SessionToken,
    csrf: CsrfToken,
}

async fn seed_actor(pool: &PgPool, secret: &AppSecret, username: &str) -> TestActor {
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
         VALUES ($1, $2, 'unused', $2, $3, $3)",
    )
    .bind(user_id)
    .bind(username)
    .bind(now)
    .execute(pool)
    .await
    .expect("应插入通知测试用户");
    let session = SessionToken::generate();
    let session_hash = session.sha256_hash();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at,
         idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(session_hash.as_slice())
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(pool)
    .await
    .expect("应插入通知测试 Session");
    TestActor {
        user_id,
        csrf: CsrfToken::mint(secret, CsrfContext::Session(&session_hash)),
        session,
    }
}

async fn seed_activity(pool: &PgPool, owner: &TestActor) -> Uuid {
    let activity_id = Uuid::new_v4();
    let owner_member_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let mut transaction = pool.begin().await.expect("应开启活动事务");
    sqlx::query(
        "INSERT INTO activities (id, name, base_currency, start_date, owner_member_id,
         created_by_user_id, created_at, updated_at)
         VALUES ($1, 'Notification Test', 'CNY', '2026-09-01', $2, $3, $4, $4)",
    )
    .bind(activity_id)
    .bind(owner_member_id)
    .bind(owner.user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动");
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at)
         VALUES ($1, $2, $3, 'Alice', 'OWNER', $4)",
    )
    .bind(owner_member_id)
    .bind(activity_id)
    .bind(owner.user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入 Owner member");
    transaction.commit().await.expect("应提交活动事务");
    activity_id
}

fn request(actor: &TestActor, method: &str, uri: String) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .header(
            COOKIE,
            format!("huddletab_session={}", actor.session.expose_for_cookie()),
        )
        .header(ORIGIN, "http://localhost:5660")
        .header("sec-fetch-site", "same-origin")
        .header("x-csrf-token", actor.csrf.expose_for_header())
        .body(Body::empty())
        .expect("通知请求应可构造")
}

fn request_with_body(actor: &TestActor, method: &str, uri: String, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .header(
            COOKIE,
            format!("huddletab_session={}", actor.session.expose_for_cookie()),
        )
        .header(ORIGIN, "http://localhost:5660")
        .header("sec-fetch-site", "same-origin")
        .header("x-csrf-token", actor.csrf.expose_for_header())
        .body(Body::from(body.to_string()))
        .expect("带 JSON 的通知请求应可构造")
}

async fn json_response(app: &axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.expect("router 应响应");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let body = serde_json::from_slice(&bytes).expect("响应应为 JSON");
    (status, body)
}

async fn insert_notification(
    pool: &PgPool,
    recipient_user_id: Uuid,
    activity_id: Uuid,
    kind: &str,
    target_type: &str,
    read_at: Option<OffsetDateTime>,
) -> Uuid {
    let notification_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO notifications (
            id, recipient_user_id, type, target_type, target_id, activity_id,
            payload, read_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, now())",
    )
    .bind(notification_id)
    .bind(recipient_user_id)
    .bind(kind)
    .bind(target_type)
    .bind(activity_id)
    .bind(serde_json::json!({"activityName": "通知测试", "status": "ENDED"}))
    .bind(read_at)
    .execute(pool)
    .await
    .expect("应插入测试通知");
    notification_id
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn notifications_are_user_scoped_and_order_unread_before_read() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let secret = AppSecret::from_bytes([29; 32]);
    let alice = seed_actor(&pool, &secret, "alice").await;
    let bob = seed_actor(&pool, &secret, "bob").await;
    let activity_id = seed_activity(&pool, &alice).await;
    let now = OffsetDateTime::now_utc();
    let older_unread = Uuid::new_v4();
    let newer_unread = Uuid::new_v4();
    let read = Uuid::new_v4();
    let other_user = Uuid::new_v4();
    for (id, recipient, kind, created_at, read_at) in [
        (
            older_unread,
            alice.user_id,
            "JOIN_APPROVAL_REQUESTED",
            now - Duration::minutes(3),
            None,
        ),
        (
            newer_unread,
            alice.user_id,
            "JOIN_APPROVAL_RESOLVED",
            now - Duration::minutes(1),
            None,
        ),
        (
            read,
            alice.user_id,
            "JOIN_APPROVAL_RESOLVED",
            now,
            Some(now),
        ),
        (
            other_user,
            bob.user_id,
            "JOIN_APPROVAL_REQUESTED",
            now + Duration::minutes(1),
            None,
        ),
    ] {
        sqlx::query(
            "INSERT INTO notifications (
                id, recipient_user_id, type, target_type, target_id, activity_id,
                payload, read_at, created_at
             ) VALUES ($1, $2, $3, 'ACTIVITY', $4, $4, $5, $6, $7)",
        )
        .bind(id)
        .bind(recipient)
        .bind(kind)
        .bind(activity_id)
        .bind(serde_json::json!({"requestId": id.to_string(), "status": "APPROVED"}))
        .bind(read_at)
        .bind(created_at)
        .execute(&pool)
        .await
        .expect("应插入测试通知");
    }
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );

    let (status, body) = json_response(
        &app,
        request(&alice, "GET", "/api/notifications".to_owned()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["unreadCount"], 2);
    let items = body["data"]["items"].as_array().expect("应返回通知数组");
    assert_eq!(items.len(), 3);
    assert_eq!(items[0]["notificationId"], newer_unread.to_string());
    assert_eq!(items[1]["notificationId"], older_unread.to_string());
    assert_eq!(items[2]["notificationId"], read.to_string());
    assert_eq!(items[0]["activityId"], activity_id.to_string());
    assert_eq!(items[0]["payload"]["status"], "APPROVED");
    assert_eq!(items[0]["activityDeleted"], false);

    sqlx::query(
        "UPDATE activities SET deleted_at = $2, purge_after = $2 + interval '30 days' WHERE id = $1",
    )
    .bind(activity_id)
    .bind(now)
    .execute(&pool)
    .await
    .expect("应软删除测试活动");
    let (status, deleted_body) = json_response(
        &app,
        request(&alice, "GET", "/api/notifications".to_owned()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        deleted_body["data"]["items"]
            .as_array()
            .expect("应返回通知数组")
            .iter()
            .all(|item| item["activityDeleted"] == true)
    );

    let (status, read_body) = json_response(
        &app,
        request(
            &alice,
            "POST",
            format!("/api/notifications/{newer_unread}/read"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(read_body["data"]["activityDeleted"], true);

    sqlx::query("UPDATE activities SET deleted_at = NULL, purge_after = NULL WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应恢复测试活动");
    let (status, restored_body) = json_response(
        &app,
        request(&alice, "GET", "/api/notifications".to_owned()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        restored_body["data"]["items"]
            .as_array()
            .expect("应返回通知数组")
            .iter()
            .all(|item| item["activityDeleted"] == false)
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn notification_read_is_recipient_scoped_and_idempotent() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let secret = AppSecret::from_bytes([29; 32]);
    let alice = seed_actor(&pool, &secret, "alice").await;
    let bob = seed_actor(&pool, &secret, "bob").await;
    let activity_id = seed_activity(&pool, &alice).await;
    let notification_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO notifications (
            id, recipient_user_id, type, target_type, target_id, activity_id, payload, created_at
         ) VALUES ($1, $2, 'JOIN_APPROVAL_RESOLVED', 'ACTIVITY', $3, $3, '{}', now())",
    )
    .bind(notification_id)
    .bind(alice.user_id)
    .bind(activity_id)
    .execute(&pool)
    .await
    .expect("应插入未读通知");
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    let uri = format!("/api/notifications/{notification_id}/read");

    let (other_status, other) = json_response(&app, request(&bob, "POST", uri.clone())).await;
    assert_eq!(other_status, StatusCode::NOT_FOUND);
    assert_eq!(other["error"]["code"], "NOT_FOUND");

    let mut timestamps = Vec::new();
    for _ in 0..2 {
        let (status, body) = json_response(&app, request(&alice, "POST", uri.clone())).await;
        assert_eq!(status, StatusCode::OK);
        timestamps.push(
            body["data"]["readAt"]
                .as_str()
                .expect("已读通知应返回 readAt")
                .to_owned(),
        );
    }
    assert_eq!(timestamps[0], timestamps[1]);
    let stored = sqlx::query_as::<_, (i64, i64)>(
        "SELECT count(*), count(read_at) FROM notifications WHERE id = $1",
    )
    .bind(notification_id)
    .fetch_one(&pool)
    .await
    .expect("应读取通知已读状态");
    assert_eq!(stored, (1, 1));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn notification_list_caps_items_but_counts_all_unread_and_returns_time_zone() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let secret = AppSecret::from_bytes([31; 32]);
    let alice = seed_actor(&pool, &secret, "alice").await;
    let activity_id = seed_activity(&pool, &alice).await;
    for index in 0..55 {
        sqlx::query(
            "INSERT INTO notifications (
                id, recipient_user_id, type, target_type, target_id, activity_id,
                payload, created_at
             ) VALUES ($1, $2, 'ACTIVITY_STATUS_CHANGED', 'ACTIVITY', $3, $3, $4, $5)",
        )
        .bind(Uuid::new_v4())
        .bind(alice.user_id)
        .bind(activity_id)
        .bind(serde_json::json!({"status": "ENDED"}))
        .bind(OffsetDateTime::now_utc() + Duration::seconds(index))
        .execute(&pool)
        .await
        .expect("应插入测试通知");
    }
    let app = router_with_state(
        None,
        AppState::new(pool, secret, "http://localhost:5660".to_owned()),
    );

    let (status, body) = json_response(
        &app,
        request(&alice, "GET", "/api/notifications".to_owned()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["data"]["items"].as_array().expect("应返回数组").len(),
        50
    );
    assert_eq!(body["data"]["unreadCount"], 55);
    assert_eq!(body["data"]["timeZone"], "Asia/Shanghai");
    let first = &body["data"]["items"][0];
    OffsetDateTime::parse(
        first["createdAt"].as_str().expect("通知应返回创建时间"),
        &Rfc3339,
    )
    .expect("通知创建时间必须是浏览器可解析的 RFC 3339");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn notification_read_all_updates_every_unread_without_crossing_users_or_overwriting_read_time()
 {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let secret = AppSecret::from_bytes([37; 32]);
    let alice = seed_actor(&pool, &secret, "alice").await;
    let bob = seed_actor(&pool, &secret, "bob").await;
    let activity_id = seed_activity(&pool, &alice).await;
    let first_read_at = OffsetDateTime::now_utc() - Duration::days(1);
    insert_notification(
        &pool,
        alice.user_id,
        activity_id,
        "ACTIVITY_STATUS_CHANGED",
        "ACTIVITY",
        Some(first_read_at),
    )
    .await;
    for _ in 0..55 {
        insert_notification(
            &pool,
            alice.user_id,
            activity_id,
            "ACTIVITY_STATUS_CHANGED",
            "ACTIVITY",
            None,
        )
        .await;
    }
    insert_notification(
        &pool,
        bob.user_id,
        activity_id,
        "ACTIVITY_STATUS_CHANGED",
        "ACTIVITY",
        None,
    )
    .await;
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );

    let (status, body) = json_response(
        &app,
        request(&alice, "POST", "/api/notifications/read-all".to_owned()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["unreadCount"], 0);
    assert!(
        body["data"]["items"]
            .as_array()
            .expect("应返回通知数组")
            .iter()
            .all(|item| item["readAt"].is_string())
    );
    let alice_unread: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL",
    )
    .bind(alice.user_id)
    .fetch_one(&pool)
    .await
    .expect("应读取 Alice 未读数");
    let bob_unread: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL",
    )
    .bind(bob.user_id)
    .fetch_one(&pool)
    .await
    .expect("应读取 Bob 未读数");
    assert_eq!(alice_unread, 0);
    assert_eq!(bob_unread, 1);
    let stored_read_at: Option<OffsetDateTime> = sqlx::query_scalar(
        "SELECT read_at FROM notifications WHERE recipient_user_id = $1 AND read_at = $2",
    )
    .bind(alice.user_id)
    .bind(first_read_at)
    .fetch_optional(&pool)
    .await
    .expect("应读取原有已读时间")
    .flatten();
    assert_eq!(stored_read_at, Some(first_read_at));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn notification_clear_applies_each_filter_to_all_history_and_preserves_other_user_data() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let secret = AppSecret::from_bytes([41; 32]);
    let alice = seed_actor(&pool, &secret, "alice").await;
    let bob = seed_actor(&pool, &secret, "bob").await;
    let activity_id = seed_activity(&pool, &alice).await;
    let read_at = Some(OffsetDateTime::now_utc() - Duration::hours(1));
    insert_notification(
        &pool,
        alice.user_id,
        activity_id,
        "JOIN_APPROVAL_RESOLVED",
        "ACTIVITY",
        read_at,
    )
    .await;
    insert_notification(
        &pool,
        alice.user_id,
        activity_id,
        "JOIN_APPROVAL_REQUESTED",
        "ACTIVITY",
        None,
    )
    .await;
    insert_notification(
        &pool,
        alice.user_id,
        activity_id,
        "SETTLEMENT_RECEIVED",
        "SETTLEMENT",
        None,
    )
    .await;
    for _ in 0..55 {
        insert_notification(
            &pool,
            alice.user_id,
            activity_id,
            "ACTIVITY_STATUS_CHANGED",
            "ACTIVITY",
            None,
        )
        .await;
    }
    insert_notification(
        &pool,
        bob.user_id,
        activity_id,
        "JOIN_APPROVAL_REQUESTED",
        "ACTIVITY",
        None,
    )
    .await;
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );

    let (status, body) = json_response(
        &app,
        request_with_body(
            &alice,
            "DELETE",
            "/api/notifications".to_owned(),
            serde_json::json!({"filter": "UNREAD"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["unreadCount"], 0);
    let remaining_after_unread: i64 =
        sqlx::query_scalar("SELECT count(*) FROM notifications WHERE recipient_user_id = $1")
            .bind(alice.user_id)
            .fetch_one(&pool)
            .await
            .expect("应读取未读清理后的通知数");
    assert_eq!(remaining_after_unread, 1);

    insert_notification(
        &pool,
        alice.user_id,
        activity_id,
        "SETTLEMENT_RECEIVED",
        "SETTLEMENT",
        read_at,
    )
    .await;
    insert_notification(
        &pool,
        alice.user_id,
        activity_id,
        "ACTIVITY_STATUS_CHANGED",
        "ACTIVITY",
        read_at,
    )
    .await;
    let (status, _) = json_response(
        &app,
        request_with_body(
            &alice,
            "DELETE",
            "/api/notifications".to_owned(),
            serde_json::json!({"filter": "INVITATION"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let invitation_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE recipient_user_id = $1 AND type IN ('JOIN_APPROVAL_REQUESTED', 'JOIN_APPROVAL_RESOLVED', 'MEMBER_JOINED')",
    )
    .bind(alice.user_id)
    .fetch_one(&pool)
    .await
    .expect("应读取邀请通知数");
    assert_eq!(invitation_count, 0);

    let (status, _) = json_response(
        &app,
        request_with_body(
            &alice,
            "DELETE",
            "/api/notifications".to_owned(),
            serde_json::json!({"filter": "SETTLEMENT"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let settlement_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE recipient_user_id = $1 AND type = 'SETTLEMENT_RECEIVED'",
    )
    .bind(alice.user_id)
    .fetch_one(&pool)
    .await
    .expect("应读取结算通知数");
    assert_eq!(settlement_count, 0);

    let (status, _) = json_response(
        &app,
        request_with_body(
            &alice,
            "DELETE",
            "/api/notifications".to_owned(),
            serde_json::json!({"filter": "SYSTEM"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let alice_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM notifications WHERE recipient_user_id = $1")
            .bind(alice.user_id)
            .fetch_one(&pool)
            .await
            .expect("应读取 Alice 清理后的通知数");
    let bob_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM notifications WHERE recipient_user_id = $1")
            .bind(bob.user_id)
            .fetch_one(&pool)
            .await
            .expect("应读取 Bob 通知数");
    assert_eq!(alice_count, 0);
    assert_eq!(bob_count, 1);

    insert_notification(
        &pool,
        alice.user_id,
        activity_id,
        "MEMBER_JOINED",
        "ACTIVITY",
        read_at,
    )
    .await;
    let (status, _) = json_response(
        &app,
        request_with_body(
            &alice,
            "DELETE",
            "/api/notifications".to_owned(),
            serde_json::json!({"filter": "ALL"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let activity_count: i64 = sqlx::query_scalar("SELECT count(*) FROM activities WHERE id = $1")
        .bind(activity_id)
        .fetch_one(&pool)
        .await
        .expect("清理通知不应删除活动");
    assert_eq!(activity_count, 1);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn notification_delete_is_recipient_scoped_idempotently_and_preserves_activity() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let secret = AppSecret::from_bytes([43; 32]);
    let alice = seed_actor(&pool, &secret, "alice").await;
    let bob = seed_actor(&pool, &secret, "bob").await;
    let activity_id = seed_activity(&pool, &alice).await;
    let notification_id = insert_notification(
        &pool,
        alice.user_id,
        activity_id,
        "JOIN_APPROVAL_REQUESTED",
        "ACTIVITY",
        None,
    )
    .await;
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    let uri = format!("/api/notifications/{notification_id}");

    let (status, body) = json_response(&app, request(&bob, "DELETE", uri.clone())).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "NOT_FOUND");
    let (status, body) = json_response(&app, request(&alice, "DELETE", uri.clone())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["data"]["items"]
            .as_array()
            .expect("应返回通知数组")
            .len(),
        0
    );
    let (status, body) = json_response(&app, request(&alice, "DELETE", uri)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["error"]["code"], "NOT_FOUND");
    let activity_count: i64 = sqlx::query_scalar("SELECT count(*) FROM activities WHERE id = $1")
        .bind(activity_id)
        .fetch_one(&pool)
        .await
        .expect("删除通知不应删除活动");
    assert_eq!(activity_count, 1);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn notification_bulk_mutations_require_authentication_and_csrf() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let secret = AppSecret::from_bytes([47; 32]);
    let alice = seed_actor(&pool, &secret, "alice").await;
    let app = router_with_state(
        None,
        AppState::new(pool, secret, "http://localhost:5660".to_owned()),
    );
    let mut missing_csrf = request(&alice, "POST", "/api/notifications/read-all".to_owned());
    missing_csrf.headers_mut().remove("x-csrf-token");
    let (status, body) = json_response(&app, missing_csrf).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"]["code"], "CSRF_INVALID");

    let mut missing_csrf = request_with_body(
        &alice,
        "DELETE",
        "/api/notifications".to_owned(),
        serde_json::json!({"filter": "ALL"}),
    );
    missing_csrf.headers_mut().remove("x-csrf-token");
    let (status, body) = json_response(&app, missing_csrf).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"]["code"], "CSRF_INVALID");

    let mut missing_csrf = request(
        &alice,
        "DELETE",
        format!("/api/notifications/{}", Uuid::new_v4()),
    );
    missing_csrf.headers_mut().remove("x-csrf-token");
    let (status, body) = json_response(&app, missing_csrf).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"]["code"], "CSRF_INVALID");

    for (method, uri, body) in [
        ("POST", "/api/notifications/read-all", None),
        (
            "DELETE",
            "/api/notifications",
            Some(serde_json::json!({"filter": "ALL"})),
        ),
        (
            "DELETE",
            "/api/notifications/00000000-0000-0000-0000-000000000000",
            None,
        ),
    ] {
        let mut builder = Request::builder().method(method).uri(uri);
        if body.is_some() {
            builder = builder.header(CONTENT_TYPE, "application/json");
        }
        let request = builder
            .body(body.map_or_else(Body::empty, |value| Body::from(value.to_string())))
            .expect("未认证通知请求应可构造");
        let (status, response_body) = json_response(&app, request).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(response_body["error"]["code"], "UNAUTHENTICATED");
    }
}
