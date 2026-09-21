use axum::{
    Extension, Json,
    extract::{Path, Query, State},
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::accounting::{
        AccountingError, LedgerSnapshot, RecommendationSnapshot, RequestedRecommendationStrategy,
        load_ledger, load_recommendations,
    },
    infrastructure::accounting_repository::PostgresAccountingRepository,
};

use super::{
    collaboration::authenticate,
    error::{ApiError, RequestId},
    router::AppState,
};

#[derive(Serialize, ToSchema)]
pub struct LedgerEnvelope {
    pub data: LedgerData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LedgerData {
    pub base_currency: String,
    pub revision: String,
    pub balances: Vec<BalanceData>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BalanceData {
    pub member_id: String,
    pub net_minor: String,
}

#[derive(Serialize, ToSchema)]
pub struct RecommendationEnvelope {
    pub data: StrategyRecommendationData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationData {
    pub base_currency: String,
    pub revision: String,
    pub recommendations: Vec<RecommendationItemData>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StrategyRecommendationData {
    pub base_currency: String,
    pub revision: String,
    pub effective_strategy: String,
    pub hub_member_id: Option<String>,
    pub recommendations: Vec<RecommendationItemData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecommendationQuery {
    pub strategy: Option<String>,
    pub hub_member_id: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationItemData {
    pub payer_member_id: String,
    pub receiver_member_id: String,
    pub amount_minor: String,
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/ledger",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses(
        (status = 200, description = "权威 Ledger", body = LedgerEnvelope),
        (status = 403, description = "无读取权限", body = super::error::ErrorEnvelope),
        (status = 500, description = "账务事实不完整", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn ledger(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<Json<LedgerEnvelope>, ApiError> {
    let snapshot = snapshot(state, request_id.clone(), &activity_id, &jar).await?;
    Ok(Json(LedgerEnvelope {
        data: LedgerData {
            base_currency: snapshot.base_currency,
            revision: snapshot.revision.to_string(),
            balances: snapshot
                .balances
                .into_iter()
                .map(|balance| BalanceData {
                    member_id: balance.member_id().to_string(),
                    net_minor: balance.net_minor().to_string(),
                })
                .collect(),
        },
    }))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/recommendations",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("strategy" = Option<String>, Query, description = "min_transfers 或 centralized"),
        ("hubMemberId" = Option<String>, Query, description = "统一结算人 UUID")
    ),
    responses(
        (status = 200, description = "确定性结算建议", body = RecommendationEnvelope),
        (status = 403, description = "无读取权限", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn recommendations(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    Query(query): Query<RecommendationQuery>,
    jar: CookieJar,
) -> Result<Json<RecommendationEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id =
        Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let requested = parse_recommendation_query(&query, request_id.clone())?;
    let repository = PostgresAccountingRepository::new(state.pool);
    let snapshot = load_recommendations(&repository, activity_id, actor.user_id, requested)
        .await
        .map_err(|error| map_recommendation_error(error, request_id.clone()))?;
    Ok(Json(RecommendationEnvelope {
        data: recommendation_data(snapshot),
    }))
}

pub(crate) fn recommendation_data(snapshot: RecommendationSnapshot) -> StrategyRecommendationData {
    let (effective_strategy, hub_member_id) = match snapshot.effective_strategy {
        crate::domain::settlement::RecommendationStrategy::MinTransfers => {
            ("MIN_TRANSFERS".to_owned(), None)
        }
        crate::domain::settlement::RecommendationStrategy::Centralized { hub_member_id } => {
            ("CENTRALIZED".to_owned(), Some(hub_member_id.to_string()))
        }
    };
    StrategyRecommendationData {
        base_currency: snapshot.base_currency,
        revision: snapshot.revision.to_string(),
        effective_strategy,
        hub_member_id,
        recommendations: snapshot
            .recommendations
            .into_iter()
            .map(|item| RecommendationItemData {
                payer_member_id: item.payer_member_id().to_string(),
                receiver_member_id: item.receiver_member_id().to_string(),
                amount_minor: item.amount_minor().to_string(),
            })
            .collect(),
    }
}

pub(crate) fn parse_recommendation_query(
    query: &RecommendationQuery,
    request_id: RequestId,
) -> Result<RequestedRecommendationStrategy, ApiError> {
    match (query.strategy.as_deref(), query.hub_member_id.as_deref()) {
        (None, None) => Ok(RequestedRecommendationStrategy::Default),
        (Some("min_transfers"), None) => Ok(RequestedRecommendationStrategy::MinTransfers),
        (Some("centralized"), Some(hub_member_id)) => {
            Ok(RequestedRecommendationStrategy::Centralized {
                hub_member_id: Uuid::parse_str(hub_member_id)
                    .map_err(|_| ApiError::invalid_recommendation_strategy(request_id))?,
            })
        }
        _ => Err(ApiError::invalid_recommendation_strategy(request_id)),
    }
}

async fn snapshot(
    state: AppState,
    request_id: RequestId,
    activity_id: &str,
    jar: &CookieJar,
) -> Result<LedgerSnapshot, ApiError> {
    let actor = authenticate(&state, jar, request_id.clone()).await?;
    let activity_id =
        Uuid::parse_str(activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let repository = PostgresAccountingRepository::new(state.pool);
    load_ledger(&repository, activity_id, actor.user_id)
        .await
        .map_err(|error| match error {
            AccountingError::Forbidden => ApiError::operation_forbidden(request_id.clone()),
            AccountingError::InvalidRecommendationStrategy
            | AccountingError::RecommendationHubForbidden => ApiError::internal(request_id.clone()),
            AccountingError::Integrity | AccountingError::Unavailable => {
                ApiError::internal(request_id)
            }
        })
}

fn map_recommendation_error(error: AccountingError, request_id: RequestId) -> ApiError {
    match error {
        AccountingError::Forbidden | AccountingError::RecommendationHubForbidden => {
            ApiError::operation_forbidden(request_id)
        }
        AccountingError::InvalidRecommendationStrategy => {
            ApiError::invalid_recommendation_strategy(request_id)
        }
        AccountingError::Integrity | AccountingError::Unavailable => ApiError::internal(request_id),
    }
}
