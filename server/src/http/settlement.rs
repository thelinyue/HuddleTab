use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::settlement::{
        CreateSettlementInput, SettlementError, SettlementRecord, UpdateSettlementInput,
        create_settlement, get_settlement, list_settlements, update_settlement, void_settlement,
    },
    infrastructure::{clock::SystemClock, settlement_repository::PostgresSettlementRepository},
};

use super::{
    collaboration::{authenticate, authenticate_mutation},
    error::{ApiError, RequestId},
    router::AppState,
};

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateSettlementRequest {
    pub client_mutation_id: String,
    pub payer_member_id: String,
    pub receiver_member_id: String,
    pub currency: String,
    pub amount_minor: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettlementRequest {
    pub version: String,
    pub payer_member_id: String,
    pub receiver_member_id: String,
    pub amount_minor: String,
}

#[derive(Deserialize, ToSchema)]
pub struct VoidSettlementRequest {
    pub version: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettlementData {
    pub settlement_id: String,
    pub activity_id: String,
    pub client_mutation_id: String,
    pub payer_member_id: String,
    pub receiver_member_id: String,
    pub currency: String,
    pub amount_minor: String,
    pub status: String,
    pub version: String,
    pub revision: String,
    pub created_at: String,
    pub updated_at: String,
    pub voided_at: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct SettlementEnvelope {
    pub data: SettlementEnvelopeData,
}

#[derive(Serialize, ToSchema)]
pub struct SettlementEnvelopeData {
    pub settlement: SettlementData,
}

#[derive(Serialize, ToSchema)]
pub struct CreatedSettlementEnvelope {
    pub data: CreatedSettlementData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedSettlementData {
    pub settlement: SettlementData,
    pub idempotent_replay: bool,
}

#[derive(Serialize, ToSchema)]
pub struct SettlementListEnvelope {
    pub data: Vec<SettlementData>,
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/settlements",
    operation_id = "createSettlement",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = CreateSettlementRequest,
    responses(
        (status = 201, description = "Settlement 已创建", body = CreatedSettlementEnvelope),
        (status = 200, description = "幂等重放", body = CreatedSettlementEnvelope),
        (status = 409, description = "幂等键冲突", body = super::error::ErrorEnvelope),
        (status = 422, description = "结算输入无效", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<CreateSettlementRequest>,
) -> Result<(StatusCode, Json<CreatedSettlementEnvelope>), ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let repository = PostgresSettlementRepository::new(state.pool);
    let result = create_settlement(
        &repository,
        &SystemClock,
        CreateSettlementInput {
            activity_id: parse_uuid(&activity_id, request_id.clone())?,
            actor_user_id: actor.user_id,
            client_mutation_id: parse_uuid(&request.client_mutation_id, request_id.clone())?,
            payer_member_id: parse_uuid(&request.payer_member_id, request_id.clone())?,
            receiver_member_id: parse_uuid(&request.receiver_member_id, request_id.clone())?,
            currency: request.currency,
            amount_minor: request.amount_minor,
        },
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    let status = if result.idempotent_replay {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    Ok((
        status,
        Json(CreatedSettlementEnvelope {
            data: CreatedSettlementData {
                settlement: settlement_data(result.settlement),
                idempotent_replay: result.idempotent_replay,
            },
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/settlements",
    operation_id = "listSettlements",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses((status = 200, description = "Settlement 列表", body = SettlementListEnvelope))
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<Json<SettlementListEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let repository = PostgresSettlementRepository::new(state.pool);
    let records = list_settlements(&repository, activity_id, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(SettlementListEnvelope {
        data: records.into_iter().map(settlement_data).collect(),
    }))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/settlements/{settlement_id}",
    operation_id = "getSettlement",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("settlement_id" = String, Path, description = "Settlement UUID")
    ),
    responses(
        (status = 200, description = "Settlement 详情", body = SettlementEnvelope),
        (status = 404, description = "Settlement 不存在", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, settlement_id)): Path<(String, String)>,
    jar: CookieJar,
) -> Result<Json<SettlementEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let repository = PostgresSettlementRepository::new(state.pool);
    let record = get_settlement(
        &repository,
        parse_uuid(&activity_id, request_id.clone())?,
        parse_uuid(&settlement_id, request_id.clone())?,
        actor.user_id,
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok(Json(SettlementEnvelope {
        data: SettlementEnvelopeData {
            settlement: settlement_data(record),
        },
    }))
}

#[utoipa::path(
    put,
    path = "/api/activities/{activity_id}/settlements/{settlement_id}",
    operation_id = "updateSettlement",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("settlement_id" = String, Path, description = "Settlement UUID")
    ),
    request_body = UpdateSettlementRequest,
    responses(
        (status = 200, description = "Settlement 已更新", body = SettlementEnvelope),
        (status = 409, description = "版本冲突", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, settlement_id)): Path<(String, String)>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<UpdateSettlementRequest>,
) -> Result<Json<SettlementEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let repository = PostgresSettlementRepository::new(state.pool);
    let record = update_settlement(
        &repository,
        &SystemClock,
        UpdateSettlementInput {
            activity_id: parse_uuid(&activity_id, request_id.clone())?,
            settlement_id: parse_uuid(&settlement_id, request_id.clone())?,
            actor_user_id: actor.user_id,
            version: request.version,
            payer_member_id: parse_uuid(&request.payer_member_id, request_id.clone())?,
            receiver_member_id: parse_uuid(&request.receiver_member_id, request_id.clone())?,
            amount_minor: request.amount_minor,
        },
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok(Json(SettlementEnvelope {
        data: SettlementEnvelopeData {
            settlement: settlement_data(record),
        },
    }))
}

#[utoipa::path(
    delete,
    path = "/api/activities/{activity_id}/settlements/{settlement_id}",
    operation_id = "voidSettlement",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("settlement_id" = String, Path, description = "Settlement UUID")
    ),
    request_body = VoidSettlementRequest,
    responses(
        (status = 200, description = "Settlement 已 VOID", body = SettlementEnvelope),
        (status = 409, description = "版本冲突", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn void(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, settlement_id)): Path<(String, String)>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<VoidSettlementRequest>,
) -> Result<Json<SettlementEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let repository = PostgresSettlementRepository::new(state.pool);
    let record = void_settlement(
        &repository,
        &SystemClock,
        parse_uuid(&activity_id, request_id.clone())?,
        parse_uuid(&settlement_id, request_id.clone())?,
        actor.user_id,
        &request.version,
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok(Json(SettlementEnvelope {
        data: SettlementEnvelopeData {
            settlement: settlement_data(record),
        },
    }))
}

fn settlement_data(record: SettlementRecord) -> SettlementData {
    SettlementData {
        settlement_id: record.id.to_string(),
        activity_id: record.activity_id.to_string(),
        client_mutation_id: record.client_mutation_id.to_string(),
        payer_member_id: record.payer_member_id.to_string(),
        receiver_member_id: record.receiver_member_id.to_string(),
        currency: record.currency,
        amount_minor: record.amount_minor.to_string(),
        status: record.status,
        version: record.version.to_string(),
        revision: record.revision.to_string(),
        created_at: format_time(record.created_at),
        updated_at: format_time(record.updated_at),
        voided_at: record.voided_at.map(format_time),
    }
}

fn format_time(value: OffsetDateTime) -> String {
    value.format(&Rfc3339).expect("数据库时间始终可格式化")
}

fn parse_uuid(value: &str, request_id: RequestId) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| ApiError::invalid_expense(request_id))
}

fn map_error(error: SettlementError, request_id: RequestId) -> ApiError {
    match error {
        SettlementError::InvalidInput => ApiError::invalid_expense(request_id),
        SettlementError::Forbidden => ApiError::operation_forbidden(request_id),
        SettlementError::NotFound => ApiError::not_found(request_id),
        SettlementError::VersionConflict => ApiError::version_conflict(request_id),
        SettlementError::MutationConflict => ApiError::mutation_conflict(request_id),
        SettlementError::Unavailable => ApiError::internal(request_id),
    }
}
