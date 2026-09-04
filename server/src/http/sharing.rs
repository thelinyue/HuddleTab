use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{
        HeaderMap, HeaderValue,
        header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE},
    },
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::CookieJar;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::sharing::{
        ActivitySummary, SharingError, load_export, load_summary, serialize_expense_csv,
    },
    infrastructure::sharing_repository::PostgresSharingRepository,
};

use super::{
    collaboration::authenticate,
    error::{ApiError, RequestId},
    router::AppState,
};

#[derive(Serialize, ToSchema)]
pub struct ActivitySummaryEnvelope {
    pub data: ActivitySummaryData,
}

/// 活动结算摘要只包含授权成员可见的账务统计，不包含账号或内部字段。
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySummaryData {
    pub activity_name: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub member_count: usize,
    pub total_expense_minor: String,
    pub expense_count: i64,
    pub participating_member_count: i64,
    pub average_expense_minor: String,
    pub currency: String,
    pub revision: String,
    pub current_user_balance_minor: String,
    pub original_currency_totals: Vec<SummaryCurrencyTotalData>,
    pub category_totals: Vec<SummaryCategoryTotalData>,
    pub balances: Vec<SummaryBalanceData>,
    pub recommendations: Vec<SummaryRecommendationData>,
}

/// 按原币种返回未删除账单的原始最小单位汇总。
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryCurrencyTotalData {
    pub currency: String,
    pub amount_minor: String,
}

/// 按固定分类值排序的主币种最小单位汇总。
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryCategoryTotalData {
    pub category: String,
    pub amount_minor: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryBalanceData {
    pub member_id: String,
    pub display_name: String,
    pub net_minor: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRecommendationData {
    pub payer_member_id: String,
    pub receiver_member_id: String,
    pub amount_minor: String,
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/summary",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses(
        (status = 200, description = "活动结算摘要", headers(("Cache-Control" = String, description = "private, no-store")), body = ActivitySummaryEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无读取权限", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn summary(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<(HeaderMap, Json<ActivitySummaryEnvelope>), ApiError> {
    let (activity_id, actor) =
        authenticated_activity(&state, request_id.clone(), &activity_id, &jar).await?;
    let repository = PostgresSharingRepository::new(state.pool, state.time_zone);
    let summary = load_summary(&repository, activity_id, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id))?;
    let mut headers = HeaderMap::new();
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    Ok((
        headers,
        Json(ActivitySummaryEnvelope {
            data: summary_data(summary),
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/export.csv",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses(
        (status = 200, description = "活动支出 CSV", content_type = "text/csv"),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无读取权限", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn export_csv(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<Response, ApiError> {
    let (activity_id, actor) =
        authenticated_activity(&state, request_id.clone(), &activity_id, &jar).await?;
    let repository = PostgresSharingRepository::new(state.pool, state.time_zone);
    let rows = load_export(&repository, activity_id, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok((
        [
            (CACHE_CONTROL, HeaderValue::from_static("private, no-store")),
            (
                CONTENT_DISPOSITION,
                HeaderValue::from_static("attachment; filename=\"activity-export.csv\""),
            ),
            (
                CONTENT_TYPE,
                HeaderValue::from_static("text/csv; charset=utf-8"),
            ),
        ],
        serialize_expense_csv(&rows),
    )
        .into_response())
}

async fn authenticated_activity(
    state: &AppState,
    request_id: RequestId,
    activity_id: &str,
    jar: &CookieJar,
) -> Result<(Uuid, crate::application::auth::CurrentSession), ApiError> {
    let actor = authenticate(state, jar, request_id.clone()).await?;
    let activity_id = Uuid::parse_str(activity_id).map_err(|_| ApiError::not_found(request_id))?;
    Ok((activity_id, actor))
}

fn summary_data(summary: ActivitySummary) -> ActivitySummaryData {
    ActivitySummaryData {
        activity_name: summary.activity_name,
        start_date: summary.start_date,
        end_date: summary.end_date,
        member_count: summary.member_count,
        total_expense_minor: summary.total_expense_minor.to_string(),
        expense_count: summary.expense_count,
        participating_member_count: summary.participating_member_count,
        average_expense_minor: summary.average_expense_minor.to_string(),
        currency: summary.currency,
        revision: summary.revision.to_string(),
        current_user_balance_minor: summary.current_user_balance_minor.to_string(),
        original_currency_totals: summary
            .original_currency_totals
            .into_iter()
            .map(|item| SummaryCurrencyTotalData {
                currency: item.currency,
                amount_minor: item.amount_minor.to_string(),
            })
            .collect(),
        category_totals: summary
            .category_totals
            .into_iter()
            .map(|item| SummaryCategoryTotalData {
                category: item.category,
                amount_minor: item.amount_minor.to_string(),
            })
            .collect(),
        balances: summary
            .balances
            .into_iter()
            .map(|balance| SummaryBalanceData {
                member_id: balance.member_id.to_string(),
                display_name: balance.display_name,
                net_minor: balance.net_minor.to_string(),
            })
            .collect(),
        recommendations: summary
            .recommendations
            .into_iter()
            .map(|item| SummaryRecommendationData {
                payer_member_id: item.payer_member_id.to_string(),
                receiver_member_id: item.receiver_member_id.to_string(),
                amount_minor: item.amount_minor.to_string(),
            })
            .collect(),
    }
}

fn map_error(error: SharingError, request_id: RequestId) -> ApiError {
    match error {
        SharingError::Forbidden => ApiError::operation_forbidden(request_id),
        SharingError::Integrity | SharingError::Unavailable => ApiError::internal(request_id),
    }
}
