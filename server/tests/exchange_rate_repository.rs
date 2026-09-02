use huddletab_server::{
    application::exchange_rate::{CachedExchangeRate, ExchangeRateCache},
    infrastructure::{
        database::connect_and_migrate, exchange_rate_repository::PostgresExchangeRateCache,
    },
};
use time::macros::date;

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn cache_is_unique_and_recent_fallback_stays_inside_requested_range() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE exchange_rate_cache")
        .execute(&pool)
        .await
        .expect("应清空缓存");
    let cache = PostgresExchangeRateCache::new(pool.clone());

    for (reference_date, rate) in [
        (date!(2026 - 08 - 23), "0.041"),
        (date!(2026 - 08 - 28), "0.042"),
        (date!(2026 - 08 - 30), "0.043"),
    ] {
        cache
            .save(CachedExchangeRate {
                from_currency: "JPY".to_owned(),
                to_currency: "CNY".to_owned(),
                rate: rate.to_owned(),
                provider: "FRANKFURTER".to_owned(),
                reference_date,
            })
            .await
            .expect("应保存缓存");
    }
    cache
        .save(CachedExchangeRate {
            from_currency: "JPY".to_owned(),
            to_currency: "CNY".to_owned(),
            rate: "0.0430".to_owned(),
            provider: "FRANKFURTER".to_owned(),
            reference_date: date!(2026 - 08 - 30),
        })
        .await
        .expect("同一报价应幂等保存");

    let exact = cache
        .find_exact("JPY", "CNY", date!(2026 - 08 - 30))
        .await
        .expect("应读取精确缓存")
        .expect("精确缓存应存在");
    assert_eq!(exact.rate, "0.043");

    let recent = cache
        .find_recent("JPY", "CNY", date!(2026 - 08 - 31), date!(2026 - 08 - 24))
        .await
        .expect("应读取最近缓存")
        .expect("七天内缓存应存在");
    assert_eq!(recent.reference_date, date!(2026 - 08 - 30));

    let row_count = sqlx::query_scalar::<_, i64>("SELECT count(*) FROM exchange_rate_cache")
        .fetch_one(&pool)
        .await
        .expect("应统计缓存");
    assert_eq!(row_count, 3);
}
