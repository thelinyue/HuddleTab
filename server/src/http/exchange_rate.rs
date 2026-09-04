use axum::{
    Extension, Json,
    extract::{Path, RawQuery, State},
};
use axum_extra::extract::cookie::CookieJar;
use serde::Serialize;
use time::{Date, format_description::well_known::Iso8601};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::exchange_rate::{
        ExchangeRateActivityAccess, ExchangeRateActivityError, SuggestExchangeRateError,
        suggest_exchange_rate,
    },
    infrastructure::{clock::SystemClock, exchange_rate_repository::PostgresExchangeRateCache},
};

use super::{
    collaboration::authenticate,
    error::{ApiError, RequestId},
    router::AppState,
};

#[derive(Serialize, ToSchema)]
pub struct ExchangeRateSuggestionEnvelope {
    pub data: ExchangeRateSuggestionData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeRateSuggestionData {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: String,
    pub source: String,
    pub provider: String,
    pub reference_date: String,
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/exchange-rate",
    params(
        ("activity_id" = String, Path, description = "Activity UUID"),
        ("from" = String, Query, description = "原币三字母代码"),
        ("date" = String, Query, description = "Expense occurredAt 的 UTC 日期")
    ),
    responses(
        (status = 200, description = "参考汇率建议", body = ExchangeRateSuggestionEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无活动写入权限", body = super::error::ErrorEnvelope),
        (status = 422, description = "币种或日期无效", body = super::error::ErrorEnvelope),
        (status = 503, description = "Provider 与缓存均不可用", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn suggest(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    RawQuery(raw_query): RawQuery,
    jar: CookieJar,
) -> Result<Json<ExchangeRateSuggestionEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id = Uuid::parse_str(&activity_id)
        .map_err(|_| ApiError::invalid_exchange_rate_query(request_id.clone()))?;
    let (from, date) = parse_query(raw_query.as_deref())
        .ok_or_else(|| ApiError::invalid_exchange_rate_query(request_id.clone()))?;
    let date = Date::parse(date, &Iso8601::DATE)
        .map_err(|_| ApiError::invalid_exchange_rate_query(request_id.clone()))?;
    let repository = PostgresExchangeRateCache::new(state.pool);
    let to = repository
        .writable_base_currency(activity_id, actor.user_id)
        .await
        .map_err(|error| match error {
            ExchangeRateActivityError::Forbidden => {
                ApiError::operation_forbidden(request_id.clone())
            }
            ExchangeRateActivityError::Unavailable => ApiError::internal(request_id.clone()),
        })?;
    let suggestion = suggest_exchange_rate(
        state.exchange_rate_provider.as_ref(),
        &repository,
        &SystemClock,
        from,
        &to,
        date,
    )
    .await
    .map_err(|error| match error {
        SuggestExchangeRateError::InvalidQuery => {
            ApiError::invalid_exchange_rate_query(request_id.clone())
        }
        SuggestExchangeRateError::Unavailable => {
            ApiError::exchange_rate_unavailable(request_id.clone())
        }
    })?;
    Ok(Json(ExchangeRateSuggestionEnvelope {
        data: ExchangeRateSuggestionData {
            from_currency: suggestion.from_currency,
            to_currency: suggestion.to_currency,
            rate: suggestion.rate,
            source: suggestion.source.to_owned(),
            provider: suggestion.provider,
            reference_date: suggestion.reference_date.to_string(),
        },
    }))
}

fn parse_query(raw: Option<&str>) -> Option<(&str, &str)> {
    let mut from = None;
    let mut date = None;
    for pair in raw?.split('&') {
        let (key, value) = pair.split_once('=')?;
        match key {
            "from" if from.is_none() => from = Some(value),
            "date" if date.is_none() => date = Some(value),
            _ => return None,
        }
    }
    Some((from?, date?))
}
