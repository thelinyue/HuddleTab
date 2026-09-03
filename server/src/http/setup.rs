use axum::{
    Extension, Json,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode, header::CACHE_CONTROL},
};
use serde::{Deserialize, Serialize};
use std::fmt;
use utoipa::ToSchema;

use crate::{
    application::bootstrap_user::{
        BootstrapUserError, BootstrapUserInput, bootstrap_first_user, setup_required,
    },
    infrastructure::{clock::SystemClock, password::Argon2PasswordHasher},
};

use super::{
    error::{ApiError, RequestId},
    rate_limit::{ClientIp, RateLimitCategory},
    router::AppState,
};

/// 公开初始化状态只暴露是否需要网页初始化，不返回用户数量或账号资料。
#[derive(Serialize, ToSchema)]
pub struct SetupStatusEnvelope {
    pub data: SetupStatusData,
}

/// 初始化状态是部署边界，前端不得将其持久化到 `IndexedDB` 或 Service Worker。
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatusData {
    pub setup_required: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupRequest {
    pub display_name: String,
    pub username: String,
    pub password: String,
}

/// 初始化请求会携带密码，但调试输出只能保留非敏感定位字段。
impl fmt::Debug for SetupRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SetupRequest")
            .field("display_name", &self.display_name)
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .finish()
    }
}

#[derive(Serialize, ToSchema)]
pub struct SetupInitializeEnvelope {
    pub data: SetupInitializeData,
}

#[derive(Serialize, ToSchema)]
pub struct SetupInitializeData {
    pub initialized: bool,
}

#[utoipa::path(
    get,
    path = "/api/setup/status",
    responses(
        (status = 200, description = "只读初始化状态", headers(("Cache-Control" = String, description = "no-store")), body = SetupStatusEnvelope),
        (status = 500, description = "初始化状态暂时不可用", headers(("Cache-Control" = String, description = "no-store")), body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn status(
    State(state): State<AppState>,
    axum::Extension(request_id): axum::Extension<RequestId>,
) -> Result<(HeaderMap, Json<SetupStatusEnvelope>), ApiError> {
    let required = setup_required(&state.pool).await.map_err(|error| {
        tracing::error!(%error, "读取初始化状态失败");
        ApiError::internal(request_id.clone())
    })?;
    let mut headers = HeaderMap::new();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((
        headers,
        Json(SetupStatusEnvelope {
            data: SetupStatusData {
                setup_required: required,
            },
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/api/setup",
    request_body = SetupRequest,
    responses(
        (status = 201, description = "首位系统管理员创建成功", headers(("Cache-Control" = String, description = "no-store")), body = SetupInitializeEnvelope),
        (status = 400, description = "初始化输入无效", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 校验失败", body = super::error::ErrorEnvelope),
        (status = 409, description = "系统已完成初始化", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求频率过高", headers(("Retry-After" = u64, description = "等待秒数")), body = super::error::ErrorEnvelope),
        (status = 500, description = "初始化服务内部错误", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn initialize(
    State(state): State<AppState>,
    Extension(client_ip): Extension<ClientIp>,
    Extension(request_id): Extension<RequestId>,
    jar: axum_extra::extract::cookie::CookieJar,
    headers: axum::http::HeaderMap,
    Json(request): Json<SetupRequest>,
) -> Result<(StatusCode, HeaderMap, Json<SetupInitializeEnvelope>), ApiError> {
    // 先完成 pre-auth 校验并计入 Auth 桶，再进入输入验证和数据库事务。
    super::auth::validate_pre_auth(&state, &jar, &headers, request_id.clone())?;
    state
        .rate_limiter
        .check(RateLimitCategory::Auth, client_ip.as_str())
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;

    bootstrap_first_user(
        &state.pool,
        &Argon2PasswordHasher,
        &SystemClock,
        BootstrapUserInput {
            username: request.username,
            password: request.password,
            display_name: request.display_name,
        },
    )
    .await
    .map_err(|error| match error {
        BootstrapUserError::InvalidIdentity(_) | BootstrapUserError::InvalidDisplayName => {
            ApiError::invalid_setup_input(request_id.clone())
        }
        BootstrapUserError::AlreadyBootstrapped => ApiError::setup_completed(request_id.clone()),
        BootstrapUserError::PasswordHashing(_) | BootstrapUserError::Database(_) => {
            tracing::error!(%error, "网页管理员初始化失败");
            ApiError::internal(request_id.clone())
        }
    })?;

    let mut response_headers = HeaderMap::new();
    response_headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok((
        StatusCode::CREATED,
        response_headers,
        Json(SetupInitializeEnvelope {
            data: SetupInitializeData { initialized: true },
        }),
    ))
}
