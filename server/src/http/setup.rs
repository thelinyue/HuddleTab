use axum::{
    Json,
    extract::State,
    http::{HeaderMap, HeaderValue, header::CACHE_CONTROL},
};
use serde::Serialize;
use utoipa::ToSchema;

use crate::application::bootstrap_user::setup_required;

use super::{
    error::{ApiError, RequestId},
    router::AppState,
};

/// 公开初始化状态只暴露是否需要 CLI 引导，不返回用户数量或账号资料。
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
