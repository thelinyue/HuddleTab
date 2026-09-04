use std::sync::Mutex;

use async_trait::async_trait;
use huddletab_server::application::{
    exchange_rate::{
        CachedExchangeRate, ExchangeRateCache, ExchangeRateCacheError, ExchangeRateProvider,
        ExchangeRateProviderError, ProviderExchangeRate, SuggestExchangeRateError,
        suggest_exchange_rate,
    },
    ports::Clock,
};
use time::{Date, OffsetDateTime, macros::date};

struct FixedClock(OffsetDateTime);

impl Clock for FixedClock {
    fn now(&self) -> OffsetDateTime {
        self.0
    }
}

struct FakeProvider {
    result: Result<ProviderExchangeRate, ExchangeRateProviderError>,
}

#[async_trait]
impl ExchangeRateProvider for FakeProvider {
    async fn get_rate(
        &self,
        _from: &str,
        _to: &str,
        _date: Date,
    ) -> Result<ProviderExchangeRate, ExchangeRateProviderError> {
        self.result.clone()
    }
}

#[derive(Default)]
struct FakeCache {
    exact: Option<CachedExchangeRate>,
    recent: Option<CachedExchangeRate>,
    saved: Mutex<Vec<CachedExchangeRate>>,
}

#[async_trait]
impl ExchangeRateCache for FakeCache {
    async fn find_exact(
        &self,
        _from: &str,
        _to: &str,
        _date: Date,
    ) -> Result<Option<CachedExchangeRate>, ExchangeRateCacheError> {
        Ok(self.exact.clone())
    }

    async fn find_recent(
        &self,
        _from: &str,
        _to: &str,
        _date: Date,
        _earliest: Date,
    ) -> Result<Option<CachedExchangeRate>, ExchangeRateCacheError> {
        Ok(self.recent.clone())
    }

    async fn save(&self, value: CachedExchangeRate) -> Result<(), ExchangeRateCacheError> {
        self.saved.lock().expect("缓存写入锁不应中毒").push(value);
        Ok(())
    }
}

fn provider_success() -> FakeProvider {
    FakeProvider {
        result: Ok(ProviderExchangeRate {
            rate: "0.0420900".to_owned(),
            provider: "FRANKFURTER".to_owned(),
            reference_date: date!(2026 - 08 - 30),
        }),
    }
}

fn provider_failure() -> FakeProvider {
    FakeProvider {
        result: Err(ExchangeRateProviderError::Unavailable),
    }
}

fn clock() -> FixedClock {
    FixedClock(
        OffsetDateTime::parse(
            "2026-09-02T08:00:00Z",
            &time::format_description::well_known::Rfc3339,
        )
        .expect("固定时间有效"),
    )
}

#[tokio::test]
async fn provider_success_is_normalized_saved_and_returned_as_provider() {
    let cache = FakeCache::default();

    let suggestion = suggest_exchange_rate(
        &provider_success(),
        &cache,
        &clock(),
        "jpy",
        "CNY",
        date!(2026 - 08 - 30),
    )
    .await
    .expect("Provider 报价应成功");

    assert_eq!(suggestion.rate, "0.04209");
    assert_eq!(suggestion.source, "PROVIDER");
    assert_eq!(suggestion.reference_date, date!(2026 - 08 - 30));
    assert_eq!(cache.saved.lock().expect("缓存写入锁不应中毒").len(), 1);
}

#[tokio::test]
async fn exact_cache_precedes_provider_and_is_reported_as_cache() {
    let cache = FakeCache {
        exact: Some(CachedExchangeRate {
            from_currency: "JPY".to_owned(),
            to_currency: "CNY".to_owned(),
            rate: "0.0421".to_owned(),
            provider: "FRANKFURTER".to_owned(),
            reference_date: date!(2026 - 08 - 30),
        }),
        ..FakeCache::default()
    };

    let suggestion = suggest_exchange_rate(
        &provider_failure(),
        &cache,
        &clock(),
        "JPY",
        "CNY",
        date!(2026 - 08 - 30),
    )
    .await
    .expect("精确缓存应直接返回");

    assert_eq!(suggestion.source, "CACHE");
    assert_eq!(suggestion.rate, "0.0421");
}

#[tokio::test]
async fn provider_failure_uses_only_cache_within_the_previous_seven_days() {
    let cache = FakeCache {
        recent: Some(CachedExchangeRate {
            from_currency: "JPY".to_owned(),
            to_currency: "CNY".to_owned(),
            rate: "0.0418".to_owned(),
            provider: "FRANKFURTER".to_owned(),
            reference_date: date!(2026 - 08 - 23),
        }),
        ..FakeCache::default()
    };

    let error = suggest_exchange_rate(
        &provider_failure(),
        &cache,
        &clock(),
        "JPY",
        "CNY",
        date!(2026 - 08 - 31),
    )
    .await
    .expect_err("八天前缓存不能用于回退");

    assert_eq!(error, SuggestExchangeRateError::Unavailable);
}

#[tokio::test]
async fn future_or_same_currency_queries_are_invalid() {
    for (from, to, date) in [
        ("JPY", "JPY", date!(2026 - 08 - 30)),
        ("JPY", "CNY", date!(2026 - 09 - 03)),
    ] {
        let error = suggest_exchange_rate(
            &provider_success(),
            &FakeCache::default(),
            &clock(),
            from,
            to,
            date,
        )
        .await
        .expect_err("无效查询应在访问缓存和 Provider 前拒绝");
        assert_eq!(error, SuggestExchangeRateError::InvalidQuery);
    }
}
