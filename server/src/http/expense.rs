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
    application::expense::{
        CreateExpenseInput, ExpenseAggregate, ExpenseDraftInput, ExpenseError, UpdateExpenseInput,
        create_expense, delete_expense, get_expense, list_expenses, update_expense,
    },
    domain::expense::{ExpenseSplitInput, PaymentInput, SplitEntryInput},
    infrastructure::{clock::SystemClock, expense_repository::PostgresExpenseRepository},
};

use super::{
    collaboration::{authenticate, authenticate_mutation},
    error::{ApiError, RequestId},
    router::AppState,
};

#[derive(Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExpensePaymentRequest {
    pub member_id: String,
    pub amount_minor: String,
}

#[derive(Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseSplitEntryRequest {
    pub member_id: String,
    pub value: String,
}

#[derive(Clone, Deserialize, ToSchema)]
pub struct ExpenseSplitRequest {
    pub mode: String,
    pub members: Option<Vec<String>>,
    pub entries: Option<Vec<ExpenseSplitEntryRequest>>,
}

#[derive(Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseDraftRequest {
    pub client_mutation_id: String,
    pub title: String,
    pub category: String,
    pub note: Option<String>,
    pub occurred_at: String,
    pub original_currency: String,
    pub original_amount_minor: String,
    pub exchange_rate_kind: String,
    pub exchange_rate: String,
    pub payments: Vec<ExpensePaymentRequest>,
    pub split: ExpenseSplitRequest,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateExpenseRequest {
    pub version: String,
    #[serde(flatten)]
    pub draft: ExpenseDraftRequest,
}

#[derive(Deserialize, ToSchema)]
pub struct DeleteExpenseRequest {
    pub version: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseData {
    pub expense_id: String,
    pub activity_id: String,
    pub client_mutation_id: String,
    pub title: String,
    pub category: String,
    pub note: Option<String>,
    pub occurred_at: String,
    pub original_currency: String,
    pub original_amount_minor: String,
    pub base_currency: String,
    pub base_amount_minor: String,
    pub exchange_rate_kind: String,
    pub exchange_rate: String,
    pub split_mode: String,
    pub version: String,
    pub revision: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseFactData {
    pub fact_id: String,
    pub member_id: String,
    pub original_amount_minor: String,
    pub base_amount_minor: String,
}

#[derive(Serialize, ToSchema)]
pub struct ExpenseAggregateData {
    pub expense: ExpenseData,
    pub payments: Vec<ExpenseFactData>,
    pub shares: Vec<ExpenseFactData>,
    pub attachments: Vec<ExpenseAttachmentData>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseAttachmentData {
    pub id: String,
    pub mime_type: String,
    pub width: i32,
    pub height: i32,
    pub byte_size: String,
    pub created_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct ExpenseEnvelope {
    pub data: ExpenseAggregateData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedExpenseData {
    pub expense: ExpenseData,
    pub payments: Vec<ExpenseFactData>,
    pub shares: Vec<ExpenseFactData>,
    pub idempotent_replay: bool,
}

#[derive(Serialize, ToSchema)]
pub struct CreatedExpenseEnvelope {
    pub data: CreatedExpenseData,
}

#[derive(Serialize, ToSchema)]
pub struct ExpenseListEnvelope {
    pub data: Vec<ExpenseAggregateData>,
}

#[derive(Serialize, ToSchema)]
pub struct DeletedExpenseEnvelope {
    pub data: DeletedExpenseData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeletedExpenseData {
    pub status: &'static str,
    pub version: String,
    pub revision: String,
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/expenses",
    operation_id = "createExpense",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = ExpenseDraftRequest,
    responses(
        (status = 201, description = "Expense 已创建", body = CreatedExpenseEnvelope),
        (status = 200, description = "幂等重放", body = CreatedExpenseEnvelope),
        (status = 409, description = "幂等键冲突", body = super::error::ErrorEnvelope),
        (status = 422, description = "账单输入无效", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<ExpenseDraftRequest>,
) -> Result<(StatusCode, Json<CreatedExpenseEnvelope>), ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let repository = PostgresExpenseRepository::new(state.pool);
    let result = create_expense(
        &repository,
        &SystemClock,
        CreateExpenseInput {
            activity_id,
            actor_user_id: actor.user_id,
            draft: draft(request, request_id.clone())?,
        },
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    let status = if result.idempotent_replay {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    let data = aggregate_data(result.aggregate);
    Ok((
        status,
        Json(CreatedExpenseEnvelope {
            data: CreatedExpenseData {
                expense: data.expense,
                payments: data.payments,
                shares: data.shares,
                idempotent_replay: result.idempotent_replay,
            },
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/expenses",
    operation_id = "listExpenses",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses((status = 200, description = "Expense 列表", body = ExpenseListEnvelope))
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<Json<ExpenseListEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let repository = PostgresExpenseRepository::new(state.pool);
    let expenses = list_expenses(&repository, activity_id, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(ExpenseListEnvelope {
        data: expenses.into_iter().map(aggregate_data).collect(),
    }))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/expenses/{expense_id}",
    operation_id = "getExpense",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("expense_id" = String, Path, description = "Expense UUID")
    ),
    responses(
        (status = 200, description = "Expense 详情", body = ExpenseEnvelope),
        (status = 404, description = "Expense 不存在", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, expense_id)): Path<(String, String)>,
    jar: CookieJar,
) -> Result<Json<ExpenseEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let expense_id = parse_uuid(&expense_id, request_id.clone())?;
    let repository = PostgresExpenseRepository::new(state.pool);
    let expense = get_expense(&repository, activity_id, expense_id, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(ExpenseEnvelope {
        data: aggregate_data(expense),
    }))
}

#[utoipa::path(
    put,
    path = "/api/activities/{activity_id}/expenses/{expense_id}",
    operation_id = "updateExpense",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("expense_id" = String, Path, description = "Expense UUID")
    ),
    request_body = UpdateExpenseRequest,
    responses(
        (status = 200, description = "Expense 已更新", body = ExpenseEnvelope),
        (status = 409, description = "版本冲突", body = super::error::ErrorEnvelope),
        (status = 422, description = "账单输入无效", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, expense_id)): Path<(String, String)>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<UpdateExpenseRequest>,
) -> Result<Json<ExpenseEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let expense_id = parse_uuid(&expense_id, request_id.clone())?;
    let repository = PostgresExpenseRepository::new(state.pool);
    let expense = update_expense(
        &repository,
        &SystemClock,
        UpdateExpenseInput {
            activity_id,
            expense_id,
            actor_user_id: actor.user_id,
            version: request.version,
            draft: draft(request.draft, request_id.clone())?,
        },
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok(Json(ExpenseEnvelope {
        data: aggregate_data(expense),
    }))
}

#[utoipa::path(
    delete,
    path = "/api/activities/{activity_id}/expenses/{expense_id}",
    operation_id = "deleteExpense",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("expense_id" = String, Path, description = "Expense UUID")
    ),
    request_body = DeleteExpenseRequest,
    responses(
        (status = 200, description = "Expense 已软删除", body = DeletedExpenseEnvelope),
        (status = 409, description = "版本冲突", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn delete(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, expense_id)): Path<(String, String)>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<DeleteExpenseRequest>,
) -> Result<Json<DeletedExpenseEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let expense_id = parse_uuid(&expense_id, request_id.clone())?;
    let repository = PostgresExpenseRepository::new(state.pool);
    let (version, revision) = delete_expense(
        &repository,
        &SystemClock,
        activity_id,
        expense_id,
        actor.user_id,
        &request.version,
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok(Json(DeletedExpenseEnvelope {
        data: DeletedExpenseData {
            status: "DELETED",
            version: version.to_string(),
            revision: revision.to_string(),
        },
    }))
}

fn draft(
    request: ExpenseDraftRequest,
    request_id: RequestId,
) -> Result<ExpenseDraftInput, ApiError> {
    let client_mutation_id = parse_uuid(&request.client_mutation_id, request_id.clone())?;
    let occurred_at = OffsetDateTime::parse(&request.occurred_at, &Rfc3339)
        .map_err(|_| ApiError::invalid_expense(request_id.clone()))?;
    let payments = request
        .payments
        .into_iter()
        .map(|payment| {
            Ok(PaymentInput {
                member_id: parse_uuid(&payment.member_id, request_id.clone())?,
                amount_minor: payment.amount_minor,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let split = split(request.split, request_id)?;
    Ok(ExpenseDraftInput {
        client_mutation_id,
        title: request.title,
        category: request.category,
        note: request.note,
        occurred_at,
        original_currency: request.original_currency,
        original_amount_minor: request.original_amount_minor,
        exchange_rate_kind: request.exchange_rate_kind,
        exchange_rate: request.exchange_rate,
        payments,
        split,
    })
}

fn split(
    request: ExpenseSplitRequest,
    request_id: RequestId,
) -> Result<ExpenseSplitInput, ApiError> {
    match request.mode.as_str() {
        "EQUAL" => Ok(ExpenseSplitInput::Equal(
            request
                .members
                .ok_or_else(|| ApiError::invalid_expense(request_id.clone()))?
                .into_iter()
                .map(|member| parse_uuid(&member, request_id.clone()))
                .collect::<Result<Vec<_>, _>>()?,
        )),
        "EXACT" | "PERCENTAGE" | "WEIGHT" => {
            let entries = request
                .entries
                .ok_or_else(|| ApiError::invalid_expense(request_id.clone()))?
                .into_iter()
                .map(|entry| {
                    Ok(SplitEntryInput {
                        member_id: parse_uuid(&entry.member_id, request_id.clone())?,
                        value: entry.value,
                    })
                })
                .collect::<Result<Vec<_>, ApiError>>()?;
            match request.mode.as_str() {
                "EXACT" => Ok(ExpenseSplitInput::Exact(entries)),
                "PERCENTAGE" => Ok(ExpenseSplitInput::Percentage(entries)),
                "WEIGHT" => Ok(ExpenseSplitInput::Weight(entries)),
                _ => unreachable!(),
            }
        }
        _ => Err(ApiError::invalid_expense(request_id)),
    }
}

pub(crate) fn aggregate_data(aggregate: ExpenseAggregate) -> ExpenseAggregateData {
    ExpenseAggregateData {
        expense: ExpenseData {
            expense_id: aggregate.expense.id.to_string(),
            activity_id: aggregate.expense.activity_id.to_string(),
            client_mutation_id: aggregate.expense.client_mutation_id.to_string(),
            title: aggregate.expense.title,
            category: aggregate.expense.category,
            note: aggregate.expense.note,
            occurred_at: format_time(aggregate.expense.occurred_at),
            original_currency: aggregate.expense.original_currency,
            original_amount_minor: aggregate.expense.original_amount_minor.to_string(),
            base_currency: aggregate.expense.base_currency,
            base_amount_minor: aggregate.expense.base_amount_minor.to_string(),
            exchange_rate_kind: aggregate.expense.exchange_rate_kind,
            exchange_rate: aggregate.expense.exchange_rate,
            split_mode: aggregate.expense.split_mode,
            version: aggregate.expense.version.to_string(),
            revision: aggregate.expense.revision.to_string(),
            created_at: format_time(aggregate.expense.created_at),
            updated_at: format_time(aggregate.expense.updated_at),
        },
        payments: aggregate
            .payments
            .into_iter()
            .map(|fact| ExpenseFactData {
                fact_id: fact.id.to_string(),
                member_id: fact.member_id.to_string(),
                original_amount_minor: fact.original_amount_minor.to_string(),
                base_amount_minor: fact.base_amount_minor.to_string(),
            })
            .collect(),
        shares: aggregate
            .shares
            .into_iter()
            .map(|fact| ExpenseFactData {
                fact_id: fact.id.to_string(),
                member_id: fact.member_id.to_string(),
                original_amount_minor: fact.original_amount_minor.to_string(),
                base_amount_minor: fact.base_amount_minor.to_string(),
            })
            .collect(),
        attachments: aggregate
            .attachments
            .into_iter()
            .map(|attachment| ExpenseAttachmentData {
                id: attachment.id.to_string(),
                mime_type: attachment.mime_type,
                width: attachment.width,
                height: attachment.height,
                byte_size: attachment.byte_size.to_string(),
                created_at: format_time(attachment.created_at),
            })
            .collect(),
    }
}

fn format_time(value: OffsetDateTime) -> String {
    value.format(&Rfc3339).expect("数据库时间始终可格式化")
}

fn parse_uuid(value: &str, request_id: RequestId) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| ApiError::invalid_expense(request_id))
}

fn map_error(error: ExpenseError, request_id: RequestId) -> ApiError {
    match error {
        ExpenseError::InvalidInput | ExpenseError::InvalidMember => {
            ApiError::invalid_expense(request_id)
        }
        ExpenseError::Forbidden => ApiError::operation_forbidden(request_id),
        ExpenseError::NotFound => ApiError::not_found(request_id),
        ExpenseError::VersionConflict => ApiError::version_conflict(request_id),
        ExpenseError::MutationConflict => ApiError::mutation_conflict(request_id),
        ExpenseError::Unavailable => ApiError::internal(request_id),
    }
}
