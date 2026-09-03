use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use huddletab_server::{
    http::router::{AppState, router_with_state},
    infrastructure::app_secret::AppSecret,
};
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[tokio::test]
async fn health_returns_the_success_envelope_and_request_id() {
    let response = huddletab_server::app()
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .expect("测试请求应可构造"),
        )
        .await
        .expect("router 应返回响应");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("x-request-id"));

    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("响应体应可读取");
    let payload: Value = serde_json::from_slice(&body).expect("响应体应为 JSON");

    assert_eq!(payload, json!({ "data": { "status": "ok" } }));
}

#[tokio::test]
async fn unknown_api_route_returns_the_json_error_envelope() {
    let response = huddletab_server::app()
        .oneshot(
            Request::builder()
                .uri("/api/not-a-route")
                .body(Body::empty())
                .expect("测试请求应可构造"),
        )
        .await
        .expect("router 应返回响应");

    assert_json_error(response, StatusCode::NOT_FOUND, "NOT_FOUND").await;
}

#[tokio::test]
async fn unsupported_api_method_returns_the_json_error_envelope() {
    let response = huddletab_server::app()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/health")
                .body(Body::empty())
                .expect("测试请求应可构造"),
        )
        .await
        .expect("router 应返回响应");

    assert_json_error(
        response,
        StatusCode::METHOD_NOT_ALLOWED,
        "METHOD_NOT_ALLOWED",
    )
    .await;
}

#[tokio::test]
async fn system_admin_routes_require_a_session() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://unused:unused@127.0.0.1/unused")
        .expect("测试应创建 lazy pool");
    let app = router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([7; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );
    for request in [
        ("GET", "/api/admin/users"),
        ("GET", "/api/admin/registration-policy"),
        ("GET", "/api/admin/storage"),
        ("GET", "/api/admin/system-information"),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(request.0)
                    .uri(request.1)
                    .body(Body::empty())
                    .expect("测试请求应可构造"),
            )
            .await
            .expect("router 应返回响应");
        assert_json_error(response, StatusCode::UNAUTHORIZED, "UNAUTHENTICATED").await;
    }
}

#[tokio::test]
async fn setup_status_is_read_only_and_has_a_json_route() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://unused:unused@127.0.0.1/unused")
        .expect("测试应创建 lazy pool");
    let app = router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([8; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/setup/status")
                .body(Body::empty())
                .expect("测试请求应可构造"),
        )
        .await
        .expect("router 应返回响应");
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/setup/status")
                .body(Body::empty())
                .expect("测试请求应可构造"),
        )
        .await
        .expect("router 应返回响应");
    assert_json_error(
        response,
        StatusCode::METHOD_NOT_ALLOWED,
        "METHOD_NOT_ALLOWED",
    )
    .await;
}

#[tokio::test]
async fn static_assets_and_spa_fallback_have_distinct_not_found_rules() {
    let static_dir = tempfile::tempdir().expect("应可创建临时静态目录");
    std::fs::create_dir(static_dir.path().join("assets")).expect("应可创建 assets 目录");
    std::fs::write(
        static_dir.path().join("index.html"),
        "<main>HuddleTab</main>",
    )
    .expect("应可写入 index.html");
    std::fs::write(
        static_dir.path().join("assets/app-123.js"),
        "window.app=true",
    )
    .expect("应可写入 hashed asset");

    let app = huddletab_server::app_with_static_dir(static_dir.path());

    let deep_link = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/activities/5bfe7262-8bfc-45ea-8de5-dc037ea49ab7")
                .body(Body::empty())
                .expect("测试请求应可构造"),
        )
        .await
        .expect("router 应返回响应");
    assert_eq!(deep_link.status(), StatusCode::OK);
    assert_eq!(response_text(deep_link).await, "<main>HuddleTab</main>");

    let asset = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/assets/app-123.js")
                .body(Body::empty())
                .expect("测试请求应可构造"),
        )
        .await
        .expect("router 应返回响应");
    assert_eq!(asset.status(), StatusCode::OK);
    assert_eq!(response_text(asset).await, "window.app=true");

    let missing_asset = app
        .oneshot(
            Request::builder()
                .uri("/assets/missing.js")
                .body(Body::empty())
                .expect("测试请求应可构造"),
        )
        .await
        .expect("router 应返回响应");
    assert_eq!(missing_asset.status(), StatusCode::NOT_FOUND);
    assert_ne!(response_text(missing_asset).await, "<main>HuddleTab</main>");
}

async fn assert_json_error(response: axum::response::Response, status: StatusCode, code: &str) {
    assert_eq!(response.status(), status);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/json")
    );

    let header_request_id = response
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .expect("错误响应应携带 request ID")
        .to_owned();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("响应体应可读取");
    let payload: Value = serde_json::from_slice(&body).expect("响应体应为 JSON");

    assert_eq!(payload["error"]["code"], code);
    assert_eq!(payload["error"]["requestId"], header_request_id);
    assert_eq!(payload["error"]["fieldErrors"], json!({}));
    assert_eq!(payload["error"]["details"], json!({}));
}

async fn response_text(response: axum::response::Response) -> String {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("响应体应可读取");
    String::from_utf8(body.to_vec()).expect("测试响应应为 UTF-8")
}
