//! 仅复用活动与认证测试相同的 HTTP 构造和响应读取，不管理数据库或认证夹具生命周期。
use axum::{
    body::Body,
    http::{
        Request, StatusCode,
        header::{CONTENT_TYPE, COOKIE, ORIGIN},
    },
};
use http_body_util::BodyExt as _;
use huddletab_server::infrastructure::{csrf::CsrfToken, session::SessionToken};
use serde_json::Value;
use tower::ServiceExt as _;

pub(super) fn authenticated_request(
    session: &SessionToken,
    csrf: &CsrfToken,
    method: &str,
    uri: &str,
    body: &str,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .header(
            COOKIE,
            format!("huddletab_session={}", session.expose_for_cookie()),
        )
        .header(ORIGIN, "http://localhost:5660")
        .header("sec-fetch-site", "same-origin")
        .header("x-csrf-token", csrf.expose_for_header())
        .body(Body::from(body.to_owned()))
        .expect("请求应可构造")
}

pub(super) async fn json_response(
    app: axum::Router,
    request: Request<Body>,
) -> (StatusCode, Value) {
    let response = app.oneshot(request).await.expect("router 应响应");
    let status = response.status();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let json = serde_json::from_slice(&body).expect("响应应为 JSON");
    (status, json)
}
