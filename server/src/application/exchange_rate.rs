use async_trait::async_trait;
use thiserror::Error;
use time::{Date, Duration};

use crate::domain::{currency::Currency, exchange_rate::ExchangeRate};

use super::ports::Clock;

const PROVIDER_NAME: &str = "FRANKFURTER";
const CACHE_FALLBACK_DAYS: i64 = 7;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderExchangeRate {
    pub rate: String,
    pub provider: String,
    pub reference_date: Date,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CachedExchangeRate {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: String,
    pub provider: String,
    pub reference_date: Date,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExchangeRateSuggestion {
    pub from_currency: String,
    pub to_currency: String,
    pub rate: String,
    pub source: &'static str,
    pub provider: String,
    pub reference_date: Date,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ExchangeRateProviderError {
    #[error("参考汇率 Provider 暂时不可用")]
    Unavailable,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ExchangeRateCacheError {
    #[error("参考汇率缓存暂时不可用")]
    Unavailable,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum SuggestExchangeRateError {
    #[error("参考汇率查询无效")]
    InvalidQuery,
    #[error("参考汇率暂时不可用")]
    Unavailable,
}

#[async_trait]
pub trait ExchangeRateProvider: Send + Sync {
    async fn get_rate(
        &self,
        from: &str,
        to: &str,
        date: Date,
    ) -> Result<ProviderExchangeRate, ExchangeRateProviderError>;
}

#[async_trait]
pub trait ExchangeRateCache: Send + Sync {
    async fn find_exact(
        &self,
        from: &str,
        to: &str,
        date: Date,
    ) -> Result<Option<CachedExchangeRate>, ExchangeRateCacheError>;

    async fn find_recent(
        &self,
        from: &str,
        to: &str,
        date: Date,
        earliest: Date,
    ) -> Result<Option<CachedExchangeRate>, ExchangeRateCacheError>;

    async fn save(&self, value: CachedExchangeRate) -> Result<(), ExchangeRateCacheError>;
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ExchangeRateActivityError {
    #[error("没有参考汇率查询权限")]
    Forbidden,
    #[error("活动访问暂时不可用")]
    Unavailable,
}

#[async_trait]
pub trait ExchangeRateActivityAccess: Send + Sync {
    async fn writable_base_currency(
        &self,
        activity_id: uuid::Uuid,
        actor_user_id: uuid::Uuid,
    ) -> Result<String, ExchangeRateActivityError>;
}

/// 按“精确缓存 → Provider → 七天内缓存”返回参考值。建议值不参与 Expense
/// 事务；保存时仍由用户提交采用的精确字符串快照，避免上游故障阻塞手工记账。
///
/// # Errors
///
/// 币种或日期无效时返回 `InvalidQuery`；缓存、Provider 或响应内容无法形成可信
/// 建议时返回 `Unavailable`。
pub async fn suggest_exchange_rate(
    provider: &dyn ExchangeRateProvider,
    cache: &dyn ExchangeRateCache,
    clock: &dyn Clock,
    from: &str,
    to: &str,
    date: Date,
) -> Result<ExchangeRateSuggestion, SuggestExchangeRateError> {
    let from = Currency::parse(from).map_err(|_| SuggestExchangeRateError::InvalidQuery)?;
    let to = Currency::parse(to).map_err(|_| SuggestExchangeRateError::InvalidQuery)?;
    if from == to || date > clock.now().date() {
        return Err(SuggestExchangeRateError::InvalidQuery);
    }

    if let Some(cached) = cache
        .find_exact(from.code(), to.code(), date)
        .await
        .map_err(|_| SuggestExchangeRateError::Unavailable)?
    {
        return suggestion_from_cache(cached, from.code(), to.code(), date, date);
    }

    if let Ok(value) = provider.get_rate(from.code(), to.code(), date).await {
        let rate = normalize_provider_value(&value, date)?;
        let cached = CachedExchangeRate {
            from_currency: from.code().to_owned(),
            to_currency: to.code().to_owned(),
            rate: rate.clone(),
            provider: value.provider.clone(),
            reference_date: value.reference_date,
        };
        cache
            .save(cached)
            .await
            .map_err(|_| SuggestExchangeRateError::Unavailable)?;
        return Ok(ExchangeRateSuggestion {
            from_currency: from.code().to_owned(),
            to_currency: to.code().to_owned(),
            rate,
            source: "PROVIDER",
            provider: value.provider,
            reference_date: value.reference_date,
        });
    }

    let earliest = date - Duration::days(CACHE_FALLBACK_DAYS);
    let cached = cache
        .find_recent(from.code(), to.code(), date, earliest)
        .await
        .map_err(|_| SuggestExchangeRateError::Unavailable)?
        .ok_or(SuggestExchangeRateError::Unavailable)?;
    suggestion_from_cache(cached, from.code(), to.code(), earliest, date)
}

fn normalize_provider_value(
    value: &ProviderExchangeRate,
    requested_date: Date,
) -> Result<String, SuggestExchangeRateError> {
    if value.provider != PROVIDER_NAME || value.reference_date != requested_date {
        return Err(SuggestExchangeRateError::Unavailable);
    }
    ExchangeRate::parse(&value.rate)
        .map(|rate| rate.to_api())
        .map_err(|_| SuggestExchangeRateError::Unavailable)
}

fn suggestion_from_cache(
    cached: CachedExchangeRate,
    from: &str,
    to: &str,
    earliest: Date,
    latest: Date,
) -> Result<ExchangeRateSuggestion, SuggestExchangeRateError> {
    if cached.from_currency != from
        || cached.to_currency != to
        || cached.provider != PROVIDER_NAME
        || cached.reference_date < earliest
        || cached.reference_date > latest
    {
        return Err(SuggestExchangeRateError::Unavailable);
    }
    let rate = ExchangeRate::parse(&cached.rate)
        .map_err(|_| SuggestExchangeRateError::Unavailable)?
        .to_api();
    Ok(ExchangeRateSuggestion {
        from_currency: from.to_owned(),
        to_currency: to.to_owned(),
        rate,
        source: "CACHE",
        provider: cached.provider,
        reference_date: cached.reference_date,
    })
}
