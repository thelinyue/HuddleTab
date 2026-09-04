use async_trait::async_trait;
use sqlx::{FromRow, PgPool};
use time::Date;

use crate::application::exchange_rate::{
    CachedExchangeRate, ExchangeRateActivityAccess, ExchangeRateActivityError, ExchangeRateCache,
    ExchangeRateCacheError,
};

#[derive(Clone, Debug)]
pub struct PostgresExchangeRateCache {
    pool: PgPool,
}

#[async_trait]
impl ExchangeRateActivityAccess for PostgresExchangeRateCache {
    async fn writable_base_currency(
        &self,
        activity_id: uuid::Uuid,
        actor_user_id: uuid::Uuid,
    ) -> Result<String, ExchangeRateActivityError> {
        sqlx::query_scalar::<_, String>(
            "SELECT a.base_currency FROM activities a JOIN activity_members m ON m.activity_id = a.id \
             WHERE a.id = $1 AND a.status = 'ACTIVE' AND a.deleted_at IS NULL \
             AND m.user_id = $2 AND m.status = 'ACTIVE'",
        )
        .bind(activity_id)
        .bind(actor_user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "读取参考汇率活动权限失败");
            ExchangeRateActivityError::Unavailable
        })?
        .map(|currency| currency.trim().to_owned())
        .ok_or(ExchangeRateActivityError::Forbidden)
    }
}

#[derive(FromRow)]
struct ExchangeRateCacheRow {
    original_currency: String,
    base_currency: String,
    rate: String,
    provider: String,
    reference_date: Date,
}

impl PostgresExchangeRateCache {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ExchangeRateCache for PostgresExchangeRateCache {
    async fn find_exact(
        &self,
        from: &str,
        to: &str,
        date: Date,
    ) -> Result<Option<CachedExchangeRate>, ExchangeRateCacheError> {
        sqlx::query_as::<_, ExchangeRateCacheRow>(
            "SELECT original_currency, base_currency, rate::text AS rate, provider, reference_date \
             FROM exchange_rate_cache WHERE original_currency = $1 AND base_currency = $2 \
             AND reference_date = $3 AND provider = 'FRANKFURTER'",
        )
        .bind(from)
        .bind(to)
        .bind(date)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(map_row))
        .map_err(log_cache_error)
    }

    async fn find_recent(
        &self,
        from: &str,
        to: &str,
        date: Date,
        earliest: Date,
    ) -> Result<Option<CachedExchangeRate>, ExchangeRateCacheError> {
        sqlx::query_as::<_, ExchangeRateCacheRow>(
            "SELECT original_currency, base_currency, rate::text AS rate, provider, reference_date \
             FROM exchange_rate_cache WHERE original_currency = $1 AND base_currency = $2 \
             AND reference_date BETWEEN $3 AND $4 AND provider = 'FRANKFURTER' \
             ORDER BY reference_date DESC LIMIT 1",
        )
        .bind(from)
        .bind(to)
        .bind(earliest)
        .bind(date)
        .fetch_optional(&self.pool)
        .await
        .map(|row| row.map(map_row))
        .map_err(log_cache_error)
    }

    async fn save(&self, value: CachedExchangeRate) -> Result<(), ExchangeRateCacheError> {
        sqlx::query(
            "INSERT INTO exchange_rate_cache \
             (original_currency, base_currency, reference_date, provider, rate) \
             VALUES ($1, $2, $3, $4, CAST($5 AS NUMERIC)) ON CONFLICT DO NOTHING",
        )
        .bind(value.from_currency)
        .bind(value.to_currency)
        .bind(value.reference_date)
        .bind(value.provider)
        .bind(value.rate)
        .execute(&self.pool)
        .await
        .map(|_| ())
        .map_err(log_cache_error)
    }
}

fn map_row(row: ExchangeRateCacheRow) -> CachedExchangeRate {
    CachedExchangeRate {
        from_currency: row.original_currency.trim().to_owned(),
        to_currency: row.base_currency.trim().to_owned(),
        rate: normalize_numeric_text(&row.rate),
        provider: row.provider,
        reference_date: row.reference_date,
    }
}

fn normalize_numeric_text(value: &str) -> String {
    let normalized = value.trim_end_matches('0').trim_end_matches('.');
    if normalized.is_empty() {
        "0".to_owned()
    } else {
        normalized.to_owned()
    }
}

fn log_cache_error(error: sqlx::Error) -> ExchangeRateCacheError {
    tracing::error!(error = %error, "读写参考汇率缓存失败");
    drop(error);
    ExchangeRateCacheError::Unavailable
}
