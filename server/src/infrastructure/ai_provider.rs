//! OpenAI-compatible 文字 Provider，包括 `DeepSeek` 官方接口和本地兼容服务。
//!
//! 请求只传递用户主动提交的文字；HTTP 层禁止重定向，并将 DNS 解析结果固定到本次
//! 客户端，避免校验后的再次解析落入 SSRF/DNS rebinding 风险地址。

use std::{
    net::{IpAddr, Ipv6Addr, SocketAddr},
    time::Duration,
};

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::{Client, Url, redirect::Policy};
use serde_json::{Value, json};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::{net::lookup_host, sync::Semaphore};

use crate::application::ai_expense::{
    AI_RESPONSE_MAX_BYTES, AiExpenseDraftProvider, AiProviderError, validate_base_url,
};

const MAX_MODEL_OUTPUT_TOKENS: u32 = 4096;
const METADATA_HOSTS: &[&str] = &[
    "metadata",
    "metadata.google.internal",
    "instance-data",
    "instance-data.ec2.internal",
    "metadata.azure.com",
];

#[derive(Clone)]
pub struct OpenAiCompatibleProvider {
    base_url: Url,
    model: String,
    api_key: String,
    json_mode: bool,
    timeout: Duration,
    semaphore: std::sync::Arc<Semaphore>,
}

impl OpenAiCompatibleProvider {
    /// 构造 Provider；具体目标地址在每次调用前再次做 DNS 校验。
    ///
    /// # Errors
    ///
    /// Base URL 无效或不是受支持的 HTTP(S) 地址时返回错误。
    pub fn new(
        base_url: &str,
        model: &str,
        api_key: String,
        json_mode: bool,
        timeout_seconds: i32,
        semaphore: std::sync::Arc<Semaphore>,
    ) -> Result<Self, AiProviderError> {
        validate_base_url(base_url).map_err(|_| AiProviderError::Unavailable)?;
        let base_url = Url::parse(base_url).map_err(|_| AiProviderError::Unavailable)?;
        Ok(Self {
            base_url,
            model: model.to_owned(),
            api_key,
            json_mode,
            timeout: Duration::from_secs(
                u64::try_from(timeout_seconds).map_err(|_| AiProviderError::Unavailable)?,
            ),
            semaphore,
        })
    }

    async fn endpoint_and_addresses(
        &self,
    ) -> Result<(Url, String, Vec<SocketAddr>), AiProviderError> {
        let host = self
            .base_url
            .host_str()
            .ok_or(AiProviderError::Unavailable)?
            .to_owned();
        if forbidden_hostname(&host) {
            return Err(AiProviderError::Unavailable);
        }
        let port = self
            .base_url
            .port_or_known_default()
            .ok_or(AiProviderError::Unavailable)?;
        let addresses = if let Ok(ip) = host.parse::<IpAddr>() {
            if forbidden_ip(ip) {
                return Err(AiProviderError::Unavailable);
            }
            vec![SocketAddr::new(ip, port)]
        } else {
            let resolved = lookup_host((host.as_str(), port))
                .await
                .map_err(|_| AiProviderError::Unavailable)?
                .collect::<Vec<_>>();
            if resolved.is_empty() || resolved.iter().any(|address| forbidden_ip(address.ip())) {
                return Err(AiProviderError::Unavailable);
            }
            resolved
        };
        let endpoint = build_endpoint(&self.base_url);
        Ok((endpoint, host, addresses))
    }
}

#[async_trait]
impl AiExpenseDraftProvider for OpenAiCompatibleProvider {
    async fn draft_from_text(
        &self,
        input: &str,
        base_currency: &str,
        now: OffsetDateTime,
    ) -> Result<String, AiProviderError> {
        let _permit = self
            .semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| AiProviderError::Unavailable)?;
        let (endpoint, host, addresses) = self.endpoint_and_addresses().await?;
        let client = Client::builder()
            .redirect(Policy::none())
            .timeout(self.timeout)
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(|_| AiProviderError::Unavailable)?;
        let now = now
            .format(&Rfc3339)
            .unwrap_or_else(|_| "unknown".to_owned());
        let system_prompt = format!(
            "你是 HuddleTab 的账单草稿识别器。只输出 JSON object，不要 Markdown。\n\
             只能填写能够从输入安全确认的字段，不要编造。金额使用十进制字符串和三位大写币种。\n\
             成员姓名放入 payers 或 split.participants 的 name；‘我’原样输出为‘我’。不要输出 memberId、member_id 或任何数据库 UUID。\n\
             split.mode 只能是 EQUAL、EXACT、PERCENTAGE、WEIGHT。\n\
             当前时间为 {now}，活动主币种为 {base_currency}。\n\
             JSON 示例：{{\"title\":\"晚餐\",\"amount\":{{\"value\":\"128.50\",\"currency\":\"CNY\"}},\"payers\":[]}}"
        );
        let request_body = build_request_body(&self.model, &system_prompt, input, self.json_mode);
        let response = client
            .post(endpoint)
            .bearer_auth(&self.api_key)
            .json(&request_body)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    AiProviderError::Timeout
                } else {
                    AiProviderError::Unavailable
                }
            })?;
        if !response.status().is_success() {
            return Err(AiProviderError::Unavailable);
        }
        if response
            .content_length()
            .is_some_and(|length| length > 256_u64 * 1024)
        {
            return Err(AiProviderError::InvalidResponse);
        }
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| AiProviderError::Unavailable)?;
            if body.len().saturating_add(chunk.len()) > AI_RESPONSE_MAX_BYTES {
                return Err(AiProviderError::InvalidResponse);
            }
            body.extend_from_slice(&chunk);
        }
        let envelope: Value =
            serde_json::from_slice(&body).map_err(|_| AiProviderError::InvalidResponse)?;
        extract_assistant_content(&envelope).ok_or(AiProviderError::InvalidResponse)
    }
}

/// 按 OpenAI-compatible 约定拼接唯一的 chat completions endpoint。
///
/// Base URL 可以是根地址或带 `/v1` 的地址，尾部斜杠只影响展示，不会导致重复 `/v1`。
fn build_endpoint(base_url: &Url) -> Url {
    let mut endpoint = base_url.clone();
    let path = format!("{}/chat/completions", endpoint.path().trim_end_matches('/'));
    endpoint.set_path(&path);
    endpoint
}

fn build_request_body(model: &str, system_prompt: &str, input: &str, json_mode: bool) -> Value {
    let mut request_body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": input}
        ],
        "stream": false,
        "max_tokens": MAX_MODEL_OUTPUT_TOKENS
    });
    if json_mode {
        request_body["response_format"] = json!({"type": "json_object"});
    }
    request_body
}

fn extract_assistant_content(envelope: &Value) -> Option<String> {
    let message = envelope
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?;
    if message
        .get("role")
        .and_then(Value::as_str)
        .is_some_and(|role| role != "assistant")
    {
        return None;
    }
    let content = message.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_owned());
    }
    let parts = content.as_array()?;
    let mut result = String::new();
    for part in parts {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            result.push_str(text);
        }
    }
    (!result.is_empty()).then_some(result)
}

fn forbidden_hostname(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    METADATA_HOSTS
        .iter()
        .any(|blocked| host == *blocked || host.ends_with(&format!(".{blocked}")))
}

fn forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            value.is_unspecified()
                || value.is_link_local()
                || value.is_multicast()
                || value.octets() == [100, 100, 100, 200]
                || (value.octets()[0] == 100 && (value.octets()[1] & 0b1100_0000) == 0b0100_0000)
        }
        IpAddr::V6(value) => {
            value.is_unspecified()
                || value.is_multicast()
                || value.is_unicast_link_local()
                || value == Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    #[test]
    fn extracts_string_and_text_parts() {
        let string = json!({"choices":[{"message":{"content":"{\"title\":\"x\"}"}}]});
        assert_eq!(
            extract_assistant_content(&string).unwrap(),
            "{\"title\":\"x\"}"
        );
        let parts =
            json!({"choices":[{"message":{"content":[{"type":"text","text":"{"},{"text":"}"}]}}]});
        assert_eq!(extract_assistant_content(&parts).unwrap(), "{}");
    }

    #[test]
    fn blocks_metadata_and_special_addresses_but_allows_local_model_ranges() {
        assert!(forbidden_hostname("metadata.google.internal"));
        assert!(forbidden_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))));
        assert!(!forbidden_ip(IpAddr::V4(Ipv4Addr::LOCALHOST)));
        assert!(!forbidden_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20))));
    }

    #[test]
    fn deepseek_base_urls_build_one_correct_endpoint() {
        for (base, expected) in [
            (
                "https://api.deepseek.com",
                "https://api.deepseek.com/chat/completions",
            ),
            (
                "https://api.deepseek.com/",
                "https://api.deepseek.com/chat/completions",
            ),
            (
                "https://api.deepseek.com/v1",
                "https://api.deepseek.com/v1/chat/completions",
            ),
            (
                "https://api.deepseek.com/v1/",
                "https://api.deepseek.com/v1/chat/completions",
            ),
        ] {
            let url = Url::parse(base).unwrap();
            assert_eq!(build_endpoint(&url).as_str(), expected);
        }
    }

    #[test]
    fn json_mode_is_explicit_and_never_retried() {
        let without_json_mode = build_request_body("local", "system", "input", false);
        assert!(without_json_mode.get("response_format").is_none());
        let with_json_mode = build_request_body("deepseek-chat", "system", "input", true);
        assert_eq!(
            with_json_mode["response_format"]["type"],
            Value::String("json_object".to_owned())
        );
    }
}
