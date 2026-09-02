use std::time::Duration as StdDuration;

use axum::{Json, Router, routing::get};
use huddletab_server::{
    application::exchange_rate::{ExchangeRateProvider, ExchangeRateProviderError},
    infrastructure::exchange_rate_provider::FrankfurterExchangeRateProvider,
};
use serde_json::json;
use time::macros::date;

async fn provider_for(
    body: serde_json::Value,
) -> (FrankfurterExchangeRateProvider, tokio::task::JoinHandle<()>) {
    let app = Router::new().route(
        "/rate/JPY/CNY",
        get(move || async move { Json(body.clone()) }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应监听测试端口");
    let address = listener.local_addr().expect("应读取测试端口");
    let task = tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("测试 Provider 应正常退出");
    });
    (
        FrankfurterExchangeRateProvider::with_endpoint(
            &format!("http://{address}"),
            StdDuration::from_secs(1),
        ),
        task,
    )
}

#[tokio::test]
async fn provider_preserves_json_decimal_text_without_float_conversion() {
    let (provider, task) = provider_for(json!({
        "date": "2026-08-30",
        "base": "JPY",
        "quote": "CNY",
        "rate": 0.042_090_0
    }))
    .await;

    let result = provider
        .get_rate("JPY", "CNY", date!(2026 - 08 - 30))
        .await
        .expect("合法响应应解析");

    assert_eq!(result.rate, "0.04209");
    assert_eq!(result.reference_date, date!(2026 - 08 - 30));
    assert_eq!(result.provider, "FRANKFURTER");
    task.abort();
}

#[tokio::test]
async fn provider_rejects_mismatched_or_non_decimal_responses() {
    for body in [
        json!({"date":"2026-08-29","base":"JPY","quote":"CNY","rate":0.042}),
        json!({"date":"2026-08-30","base":"USD","quote":"CNY","rate":0.042}),
        json!({"date":"2026-08-30","base":"JPY","quote":"CNY","rate":"NaN"}),
    ] {
        let (provider, task) = provider_for(body).await;
        let result = provider.get_rate("JPY", "CNY", date!(2026 - 08 - 30)).await;
        assert_eq!(result, Err(ExchangeRateProviderError::Unavailable));
        task.abort();
    }
}

#[tokio::test]
async fn provider_enforces_total_request_timeout() {
    let app = Router::new().route(
        "/rate/JPY/CNY",
        get(|| async {
            tokio::time::sleep(StdDuration::from_millis(100)).await;
            Json(json!({"date":"2026-08-30","base":"JPY","quote":"CNY","rate":0.042}))
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("应监听");
    let address = listener.local_addr().expect("应读取地址");
    let task = tokio::spawn(async move { axum::serve(listener, app).await.expect("应服务") });
    let provider = FrankfurterExchangeRateProvider::with_endpoint(
        &format!("http://{address}"),
        StdDuration::from_millis(20),
    );

    assert_eq!(
        provider.get_rate("JPY", "CNY", date!(2026 - 08 - 30)).await,
        Err(ExchangeRateProviderError::Unavailable)
    );
    task.abort();
}
