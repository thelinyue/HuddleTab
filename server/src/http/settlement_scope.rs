use super::{
    collaboration::{authenticate, authenticate_mutation},
    error::{ApiError, RequestId},
    router::AppState,
};
use crate::application::{
    settlement::SettlementRepositoryError,
    settlement_scope::{
        ConfirmBillOffsetsData, ConfirmBillOffsetsRequest, SettlementPreview,
        SettlementPreviewRequest,
    },
};
use crate::infrastructure::settlement_scope;
use axum::{
    Extension, Json,
    extract::{Path, State},
    http::HeaderMap,
};
use axum_extra::extract::cookie::CookieJar;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
pub struct SettlementPreviewEnvelope {
    pub data: SettlementPreview,
}
#[derive(Serialize, ToSchema)]
pub struct ConfirmBillOffsetsEnvelope {
    pub data: ConfirmBillOffsetsData,
}

#[utoipa::path(post, path = "/api/activities/{activity_id}/settlement-preview", request_body = SettlementPreviewRequest,
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses((status = 200, description = "日期范围只读结算预览", body = SettlementPreviewEnvelope), (status = 422, description = "日期或时区无效", body = super::error::ErrorEnvelope)))]
pub(crate) async fn preview(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    Json(request): Json<SettlementPreviewRequest>,
) -> Result<Json<SettlementPreviewEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity =
        Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let data = settlement_scope::preview(&state.pool, activity, actor.user_id, request)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(SettlementPreviewEnvelope { data }))
}

#[utoipa::path(post, path = "/api/activities/{activity_id}/offset-confirmations", request_body = ConfirmBillOffsetsRequest,
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses((status = 200, description = "已确认抵销，无现金转账", body = ConfirmBillOffsetsEnvelope), (status = 409, description = "预览过期或幂等冲突", body = super::error::ErrorEnvelope)))]
pub(crate) async fn confirm(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<ConfirmBillOffsetsRequest>,
) -> Result<Json<ConfirmBillOffsetsEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let activity =
        Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let mutation = Uuid::parse_str(&request.client_mutation_id)
        .map_err(|_| ApiError::invalid_settlement_scope(request_id.clone()))?;
    let data = settlement_scope::confirm_offsets(
        &state.pool,
        activity,
        actor.user_id,
        mutation,
        request.scope,
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok(Json(ConfirmBillOffsetsEnvelope { data }))
}

fn map_error(error: SettlementRepositoryError, request_id: RequestId) -> ApiError {
    match error {
        SettlementRepositoryError::PreviewExpired => {
            ApiError::settlement_preview_expired(request_id)
        }
        SettlementRepositoryError::InvalidScope | SettlementRepositoryError::InvalidMember => {
            ApiError::invalid_settlement_scope(request_id)
        }
        SettlementRepositoryError::Forbidden => ApiError::operation_forbidden(request_id),
        SettlementRepositoryError::NotFound => ApiError::not_found(request_id),
        SettlementRepositoryError::VersionConflict => ApiError::version_conflict(request_id),
        SettlementRepositoryError::MutationConflict => ApiError::mutation_conflict(request_id),
        SettlementRepositoryError::Unavailable => ApiError::internal(request_id),
    }
}
