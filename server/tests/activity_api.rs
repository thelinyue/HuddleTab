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
use time::{Duration, OffsetDateTime};
use tower::ServiceExt as _;
use uuid::Uuid;

async fn seed_authenticated_actor() -> (PgPool, axum::Router, SessionToken, CsrfToken, Uuid) {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'alice', 'unused', 'Alice', $2, $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&pool)
    .await
    .expect("应插入测试用户");
    let session = SessionToken::generate();
    let session_hash = session.sha256_hash();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
         idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(session_hash.as_slice())
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(&pool)
    .await
    .expect("应插入测试 Session");
    let secret = AppSecret::from_bytes([9; 32]);
    let csrf = CsrfToken::mint(&secret, CsrfContext::Session(&session_hash));
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    (pool, app, session, csrf, user_id)
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn create_activity_atomically_creates_its_owner_member() {
    let (pool, app, session, csrf, user_id) = seed_authenticated_actor().await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/activities")
                .header(CONTENT_TYPE, "application/json")
                .header(
                    COOKIE,
                    format!("huddletab_session={}", session.expose_for_cookie()),
                )
                .header(ORIGIN, "http://localhost:5660")
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", csrf.expose_for_header())
                .body(Body::from(r#"{"name":"Tokyo Trip","baseCurrency":"jpy"}"#))
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let json: Value = serde_json::from_slice(&body).expect("响应应为 JSON");
    let activity_id = Uuid::parse_str(
        json["data"]["activityId"]
            .as_str()
            .expect("应返回 activityId"),
    )
    .expect("activityId 应为 UUID");
    let owner_member_id = Uuid::parse_str(
        json["data"]["ownerMemberId"]
            .as_str()
            .expect("应返回 ownerMemberId"),
    )
    .expect("ownerMemberId 应为 UUID");
    assert_eq!(json["data"]["baseCurrency"], "JPY");
    assert_eq!(json["data"]["version"], "1");
    assert_eq!(json["data"]["revision"], "1");

    let stored = sqlx::query_as::<_, (Uuid, Uuid, String, String)>(
        "SELECT a.owner_member_id, m.user_id, m.role, m.display_name \
         FROM activities a JOIN activity_members m \
         ON m.activity_id = a.id AND m.id = a.owner_member_id WHERE a.id = $1",
    )
    .bind(activity_id)
    .fetch_one(&pool)
    .await
    .expect("活动与 OWNER member 应同时持久化");
    assert_eq!(
        stored,
        (owner_member_id, user_id, "OWNER".into(), "Alice".into())
    );
    let audit = sqlx::query_as::<_, (String, String, Uuid, Uuid, Uuid, i64)>(
        "SELECT action, resource_type, resource_id, actor_user_id, actor_member_id, \
         activity_revision FROM activity_audit_logs WHERE activity_id = $1",
    )
    .bind(activity_id)
    .fetch_one(&pool)
    .await
    .expect("活动创建应写入初始 Audit");
    assert_eq!(
        audit,
        (
            "ACTIVITY_CREATED".into(),
            "ACTIVITY".into(),
            activity_id,
            user_id,
            owner_member_id,
            1,
        ),
    );
}
