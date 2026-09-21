use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use huddletab_server::{
    http::router::{AppState, router_with_state},
    infrastructure::app_secret::AppSecret,
};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

fn app() -> axum::Router {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://unused:unused@127.0.0.1/unused")
        .expect("测试应创建 lazy pool");
    router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([11; 32]),
            "http://localhost:5660".to_owned(),
        ),
    )
}

#[tokio::test]
async fn mcp_requires_bearer_and_advertises_auth_challenge() {
    let response = app()
        .oneshot(
            Request::builder()
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
async fn mcp_rejects_cross_origin_requests_before_token_lookup() {
    let response = app()
        .oneshot(
            Request::builder()
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
async fn mcp_rejects_ambiguous_authentication_headers() {
    let response = app()
        .oneshot(
            Request::builder()
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
