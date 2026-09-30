use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use huddletab_server::{
    http::router::{AppState, router_with_state},
    infrastructure::app_secret::AppSecret,
};
use tower::ServiceExt;

async fn app() -> axum::Router {
    let pool = huddletab_server::infrastructure::database::connect_and_migrate(
        &std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL"),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE system_settings SET access_origins = ARRAY['http://localhost:5660'] WHERE id = 'singleton'").execute(&pool).await.unwrap();
    router_with_state(None, AppState::new(pool, AppSecret::from_bytes([11; 32])))
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn mcp_requires_bearer_and_advertises_auth_challenge() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .header("host", "localhost:5660")
                .method("POST")
                .uri("/mcp")
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应返回响应");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response
            .headers()
            .get("www-authenticate")
            .and_then(|value| value.to_str().ok()),
        Some("Bearer realm=\"HuddleTab MCP\"")
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn mcp_rejects_cross_origin_requests_before_token_lookup() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .header("host", "localhost:5660")
                .method("POST")
                .uri("/mcp")
                .header("Origin", "https://attacker.example")
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应返回响应");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn mcp_rejects_ambiguous_authentication_headers() {
    let response = app()
        .await
        .oneshot(
            Request::builder()
                .header("host", "localhost:5660")
                .method("POST")
                .uri("/mcp")
                .header("Authorization", "Bearer ht_mcp_invalid")
                .header("Authorization", "Bearer ht_mcp_invalid_again")
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应返回响应");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
