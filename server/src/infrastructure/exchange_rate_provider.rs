use std::time::Duration;

use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use time::{Date, format_description::well_known::Iso8601};

use crate::{
    application::exchange_rate::{
        ExchangeRateProvider, ExchangeRateProviderError, ProviderExchangeRate,
    },
    domain::exchange_rate::ExchangeRate,
};

const FRANKFURTER_ENDPOINT: &str = "https://api.frankfurter.dev/v2";
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Clone, Debug)]
pub struct FrankfurterExchangeRateProvider {
    client: Client,
    endpoint: String,
    timeout: Duration,
}

impl Default for FrankfurterExchangeRateProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Deserialize)]
struct FrankfurterRateResponse {
    date: String,
    base: String,
    quote: String,
    rate: serde_json::Value,
}

impl FrankfurterExchangeRateProvider {
    /// 构造正式 Frankfurter v2 适配器。地址与三秒超时固定在服务端，避免把
    /// 任意外部 URL 变成部署配置或用户输入。
    #[must_use]
    pub fn new() -> Self {
        Self::with_endpoint(FRANKFURTER_ENDPOINT, PROVIDER_TIMEOUT)
    }

    /// 为确定性测试替换本地 HTTP 端点；正式启动只调用 `new`。
    #[must_use]
    pub fn with_endpoint(endpoint: &str, timeout: Duration) -> Self {
        let client = Client::new();
        let endpoint = endpoint.trim_end_matches('/').to_owned();
        Self {
            client,
            endpoint,
            timeout,
        }
    }
}

#[async_trait]
impl ExchangeRateProvider for FrankfurterExchangeRateProvider {
    async fn get_rate(
        &self,
        from: &str,
        to: &str,
        date: Date,
    ) -> Result<ProviderExchangeRate, ExchangeRateProviderError> {
        let response = self
            .client
            .get(format!("{}/rate/{from}/{to}", self.endpoint))
            .query(&[("date", date.to_string())])
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|error| {
                tracing::warn!(error = %error, "无法连接 Frankfurter 汇率服务");
                ExchangeRateProviderError::Unavailable
            })?;
        if !response.status().is_success() {
            tracing::warn!(status = %response.status(), "Frankfurter 汇率服务返回非成功状态");
            return Err(ExchangeRateProviderError::Unavailable);
        }
        let value = response
            .json::<FrankfurterRateResponse>()
            .await
            .map_err(|error| {
                tracing::warn!(error = %error, "Frankfurter 汇率响应格式无效");
                ExchangeRateProviderError::Unavailable
            })?;
        let reference_date = Date::parse(&value.date, &Iso8601::DATE)
            .map_err(|_| ExchangeRateProviderError::Unavailable)?;
        let rate_text = match value.rate {
            serde_json::Value::Number(number) => number.to_string(),
            _ => return Err(ExchangeRateProviderError::Unavailable),
        };
        let rate = ExchangeRate::parse(&rate_text)
            .map_err(|_| ExchangeRateProviderError::Unavailable)?
            .to_api();
        if value.base != from || value.quote != to || reference_date != date {
            return Err(ExchangeRateProviderError::Unavailable);
        }
        Ok(ProviderExchangeRate {
            rate,
            provider: "FRANKFURTER".to_owned(),
            reference_date,
        })
    }
}
