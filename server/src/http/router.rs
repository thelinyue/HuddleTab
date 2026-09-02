use axum::{
    Extension, Json, Router,
    extract::{ConnectInfo, DefaultBodyLimit, State},
    http::{HeaderName, HeaderValue, Request},
    middleware::{self, Next},
    response::Response,
    routing::get,
};
use serde::Serialize;
use sqlx::PgPool;
use std::{net::SocketAddr, path::PathBuf};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::infrastructure::app_secret::AppSecret;

use super::rate_limit::{ClientIp, RateLimiter};
use super::static_files::mount_static_files;
use super::{
    accounting, activity, attachment, auth, collaboration,
    error::{ApiError, RequestId},
    expense, notification, settlement, sharing, snapshot,
};

const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
const DEFAULT_TIME_ZONE: &str = "Asia/Shanghai";

#[derive(Serialize, ToSchema)]
pub struct HealthEnvelope {
    pub data: HealthData,
}

#[derive(Serialize, ToSchema)]
pub struct HealthData {
    pub status: &'static str,
}

/// HTTP 入口共享的运行依赖。结构体只保存可安全克隆的 handle，不保存请求级状态。
#[derive(Clone)]
pub struct AppState {
    pub(crate) pool: PgPool,
    pub(crate) app_secret: AppSecret,
    pub(crate) base_origin: String,
    pub(crate) secure_cookies: bool,
    pub(crate) time_zone: String,
    pub(crate) trust_proxy: bool,
    pub(crate) rate_limiter: RateLimiter,
    pub(crate) uploads_dir: PathBuf,
}

impl AppState {
    #[must_use]
    pub fn new(pool: PgPool, app_secret: AppSecret, base_origin: String) -> Self {
        let secure_cookies = base_origin.starts_with("https://");
        let time_zone = std::env::var("TZ")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_TIME_ZONE.to_owned());
        let trust_proxy = std::env::var("TRUST_PROXY").as_deref() == Ok("true");
        Self {
            pool,
            app_secret,
            base_origin,
            secure_cookies,
            time_zone,
            trust_proxy,
            rate_limiter: RateLimiter::new(),
            uploads_dir: PathBuf::from("/data/uploads"),
        }
    }

    #[must_use]
    pub fn with_uploads_dir(mut self, uploads_dir: PathBuf) -> Self {
        self.uploads_dir = uploads_dir;
        self
    }
}

pub fn router(static_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/health", get(health).fallback(api_method_not_allowed))
        .fallback(api_not_found);

    finish_router(api, static_dir)
}

// 路由表集中展示完整 HTTP 面，拆分只会隐藏路径与 handler 的对应关系。
#[allow(clippy::too_many_lines)]
pub fn router_with_state(static_dir: Option<PathBuf>, state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health).fallback(api_method_not_allowed))
        .route(
            "/auth/csrf",
            get(auth::csrf).fallback(api_method_not_allowed),
        )
        .route(
            "/auth/login",
            axum::routing::post(auth::login).fallback(api_method_not_allowed),
        )
        .route(
            "/auth/register",
            axum::routing::post(auth::register).fallback(api_method_not_allowed),
        )
        .route(
            "/auth/session",
            get(auth::session).fallback(api_method_not_allowed),
        )
        .route(
            "/auth/logout",
            axum::routing::post(auth::logout).fallback(api_method_not_allowed),
        )
        .route(
            "/me/password",
            axum::routing::put(auth::change_password).fallback(api_method_not_allowed),
        )
        .route(
            "/activities",
            get(activity::list)
                .post(activity::create)
                .fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}",
            get(activity::get)
                .put(activity::update)
                .delete(activity::delete)
                .fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/lifecycle",
            axum::routing::post(activity::transition).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/restore",
            axum::routing::post(activity::restore).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/members",
            get(activity::list_members).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/members/guests",
            axum::routing::post(collaboration::create_guest).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/members/{member_id}/binding-invitations",
            axum::routing::post(collaboration::create_guest_binding_invitation)
                .fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/invitations",
            get(collaboration::list_invitations)
                .post(collaboration::create_invitation)
                .fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/invitations/{invitation_id}",
            axum::routing::delete(collaboration::revoke_invitation)
                .fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/join-requests",
            get(collaboration::list_join_requests).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/join-requests/{join_request_id}",
            axum::routing::post(collaboration::decide_join_request)
                .fallback(api_method_not_allowed),
        )
        .route(
            "/join-requests/{join_request_id}",
            get(collaboration::get_join_request).fallback(api_method_not_allowed),
        )
        .route(
            "/notifications",
            get(notification::list).fallback(api_method_not_allowed),
        )
        .route(
            "/notifications/{notification_id}/read",
            axum::routing::post(notification::mark_read).fallback(api_method_not_allowed),
        )
        .route(
            "/invitations/{token}",
            get(collaboration::preview_invitation).fallback(api_method_not_allowed),
        )
        .route(
            "/invitations/{token}/join",
            axum::routing::post(collaboration::join_invitation).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/expenses",
            get(expense::list)
                .post(expense::create)
                .fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/expenses/{expense_id}",
            get(expense::get)
                .put(expense::update)
                .delete(expense::delete)
                .fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/expenses/{expense_id}/attachments",
            axum::routing::post(attachment::upload)
                .layer(DefaultBodyLimit::max(attachment::MAX_MULTIPART_BYTES))
                .fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/expenses/{expense_id}/attachments/{attachment_id}",
            get(attachment::download).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/ledger",
            get(accounting::ledger).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/recommendations",
            get(accounting::recommendations).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/summary",
            get(sharing::summary).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/snapshot",
            get(snapshot::get).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/export.csv",
            get(sharing::export_csv).fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/settlements",
            get(settlement::list)
                .post(settlement::create)
                .fallback(api_method_not_allowed),
        )
        .route(
            "/activities/{activity_id}/settlements/{settlement_id}",
            get(settlement::get)
                .put(settlement::update)
                .delete(settlement::void)
                .fallback(api_method_not_allowed),
        )
        .fallback(api_not_found)
        .with_state(state.clone())
        .layer(middleware::from_fn_with_state(state, attach_client_ip));

    finish_router(api, static_dir)
}

fn finish_router(api: Router, static_dir: Option<PathBuf>) -> Router {
    let router = Router::new().nest("/api", api);
    let router = static_dir.map_or(router.clone(), |directory| {
        mount_static_files(router, &directory)
    });

    router.layer(middleware::from_fn(attach_request_id))
}

#[utoipa::path(
    get,
    path = "/api/health",
    responses(
        (status = 200, description = "服务正常", body = HealthEnvelope),
        (status = 500, description = "服务内部错误", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn health() -> Json<HealthEnvelope> {
    Json(HealthEnvelope {
        data: HealthData { status: "ok" },
    })
}

async fn api_not_found(Extension(request_id): Extension<RequestId>) -> ApiError {
    ApiError::not_found(request_id)
}

async fn api_method_not_allowed(Extension(request_id): Extension<RequestId>) -> ApiError {
    ApiError::method_not_allowed(request_id)
}

/// 每个入口请求都生成独立 ID，后续错误响应和中文诊断日志共用该关联标识。
async fn attach_request_id(mut request: Request<axum::body::Body>, next: Next) -> Response {
    let request_id = RequestId(Uuid::new_v4().to_string());
    request.extensions_mut().insert(request_id.clone());
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        REQUEST_ID_HEADER,
        HeaderValue::from_str(&request_id.0).expect("UUID 始终是合法 HeaderValue"),
    );
    response
}

/// 仅在显式信任反向代理时读取单值 X-Real-IP，默认固定使用 TCP 对端地址。
async fn attach_client_ip(
    State(state): State<AppState>,
    mut request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|address| address.0);
    let client_ip = ClientIp::resolve(request.headers(), peer, state.trust_proxy);
    request.extensions_mut().insert(client_ip);
    next.run(request).await
}
