//! OpenAI-compatible 文字 Provider，包括 `DeepSeek` 官方接口和本地兼容服务。
//!
//! 请求只传递用户主动提交的文字；HTTP 层禁止重定向，并将 DNS 解析结果固定到本次
//! 客户端，避免校验后的再次解析落入 SSRF/DNS rebinding 风险地址。

use std::{
    io::{self, Write},
    net::{IpAddr, Ipv6Addr, SocketAddr},
    time::Duration,
};

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use futures_util::StreamExt;
use reqwest::{Client, Url, redirect::Policy};
use serde_json::{Value, json};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use tokio::{net::lookup_host, sync::Semaphore};

use crate::application::ai_expense::{
    AI_RESPONSE_MAX_BYTES, AiExpenseDraftProvider, AiProviderError, validate_base_url,
};

const MAX_MODEL_OUTPUT_TOKENS: u32 = 4096;
const MAX_IMAGE_DATA_URL_BYTES: usize = 14 * 1024 * 1024;
const MAX_PROVIDER_REQUEST_BYTES: usize = 16 * 1024 * 1024;
const PROVIDER_IMAGE_MIME_TYPE: &str = "image/webp";
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
    image_model: Option<String>,
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
            image_model: None,
        })
    }

    #[must_use]
    pub fn with_image_model(mut self, image_model: Option<&str>) -> Self {
        self.image_model = image_model.map(str::to_owned);
        self
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
        request_completion(&client, endpoint, &self.api_key, request_body).await
    }

    async fn draft_from_image(
        &self,
        image_bytes: &[u8],
        mime_type: &str,
        base_currency: &str,
        now: OffsetDateTime,
    ) -> Result<String, AiProviderError> {
        let permit = self
            .semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| AiProviderError::Unavailable)?;
        self.draft_from_image_inner(image_bytes, mime_type, base_currency, now, permit)
            .await
    }

    async fn draft_from_image_with_permit(
        &self,
        image_bytes: &[u8],
        mime_type: &str,
        base_currency: &str,
        now: OffsetDateTime,
        permit: tokio::sync::OwnedSemaphorePermit,
    ) -> Result<String, AiProviderError> {
        self.draft_from_image_inner(image_bytes, mime_type, base_currency, now, permit)
            .await
    }
}

impl OpenAiCompatibleProvider {
    async fn draft_from_image_inner(
        &self,
        image_bytes: &[u8],
        _mime_type: &str,
        base_currency: &str,
        now: OffsetDateTime,
        _permit: tokio::sync::OwnedSemaphorePermit,
    ) -> Result<String, AiProviderError> {
        let encoded_len = image_data_url_len(image_bytes.len(), PROVIDER_IMAGE_MIME_TYPE)
            .ok_or(AiProviderError::InputTooLarge)?;
        if encoded_len > MAX_IMAGE_DATA_URL_BYTES {
            return Err(AiProviderError::InputTooLarge);
        }
        let encoded = BASE64.encode(image_bytes);
        let data_url = format!("data:{PROVIDER_IMAGE_MIME_TYPE};base64,{encoded}");
        if data_url.len() > MAX_IMAGE_DATA_URL_BYTES {
            return Err(AiProviderError::InputTooLarge);
        }
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
            "你是 HuddleTab 的小票账单草稿识别器。只输出 JSON object，不要 Markdown。\n\
             只能填写图片中能够安全确认的字段，不要编造；金额使用十进制字符串和三位大写币种。\n\
             可选识别字段包括 merchant、items、tax、serviceFee、discount、location 和 note。\n\
             成员姓名放入 payers 或 split.participants 的 name；不要输出 memberId、member_id 或任何数据库 UUID。\n\
             当前时间为 {now}，活动主币种为 {base_currency}。"
        );
        let model = self.image_model.as_deref().unwrap_or(&self.model);
        let request_body =
            build_multimodal_request_body(model, &system_prompt, &data_url, self.json_mode);
        request_completion(&client, endpoint, &self.api_key, request_body).await
    }
}

async fn request_completion(
    client: &Client,
    endpoint: Url,
    api_key: &str,
    request_body: Value,
) -> Result<String, AiProviderError> {
    let request_body = serialize_request_body(&request_body)?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(request_body)
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

fn base64_encoded_len(input_len: usize) -> Option<usize> {
    input_len
        .checked_add(2)?
        .checked_div(3)
        .and_then(|groups| groups.checked_mul(4))
}

fn image_data_url_len(input_len: usize, mime_type: &str) -> Option<usize> {
    "data:"
        .len()
        .checked_add(mime_type.len())
        .and_then(|length| length.checked_add(";base64,".len()))
        .and_then(|length| length.checked_add(base64_encoded_len(input_len)?))
}

fn serialize_request_body(request_body: &Value) -> Result<Vec<u8>, AiProviderError> {
    let mut writer = LimitedJsonWriter::new(MAX_PROVIDER_REQUEST_BYTES);
    serde_json::to_writer(&mut writer, request_body).map_err(|_| {
        if writer.exceeded {
            AiProviderError::InputTooLarge
        } else {
            AiProviderError::InvalidResponse
        }
    })?;
    Ok(writer.into_inner())
}

/// 序列化 Provider 请求时限制最终 JSON 缓冲区，避免超限后才生成一个无界请求体。
struct LimitedJsonWriter {
    bytes: Vec<u8>,
    limit: usize,
    exceeded: bool,
}

impl LimitedJsonWriter {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Vec::with_capacity(limit.min(64 * 1024)),
            limit,
            exceeded: false,
        }
    }

    fn into_inner(self) -> Vec<u8> {
        self.bytes
    }
}

impl Write for LimitedJsonWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let Some(end) = self.bytes.len().checked_add(buffer.len()) else {
            self.exceeded = true;
            return Err(io::Error::other("provider JSON request exceeds limit"));
        };
        if end > self.limit {
            self.exceeded = true;
            return Err(io::Error::other("provider JSON request exceeds limit"));
        }
        self.bytes.extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
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

fn build_multimodal_request_body(
    model: &str,
    system_prompt: &str,
    image_data_url: &str,
    json_mode: bool,
) -> Value {
    let mut request_body = json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": [
                {"type": "text", "text": "请识别这张图片中的账单信息。"},
                {"type": "image_url", "image_url": {"url": image_data_url}}
            ]}
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

    #[test]
    fn multimodal_request_uses_data_url_and_respects_json_mode() {
        let body = build_multimodal_request_body(
            "vision-model",
            "system",
            "data:image/webp;base64,AA==",
            false,
        );
        assert_eq!(body["model"], "vision-model");
        assert!(
            body["messages"][1]["content"]
                .as_array()
                .is_some_and(|parts| parts.iter().any(|part| part["type"] == "image_url"))
        );
        assert_eq!(
            body["messages"][1]["content"][1]["image_url"]["url"],
            "data:image/webp;base64,AA=="
        );
        assert!(body.get("response_format").is_none());
    }

    #[test]
    fn image_model_falls_back_to_text_model_when_unset() {
        let model = None::<String>.as_deref().unwrap_or("deepseek-chat");
        let body =
            build_multimodal_request_body(model, "system", "data:image/webp;base64,AA==", true);
        assert_eq!(body["model"], "deepseek-chat");
        assert_eq!(body["response_format"]["type"], "json_object");
    }

    #[test]
    fn base64_and_data_url_lengths_are_checked_before_encoding() {
        assert_eq!(base64_encoded_len(0), Some(0));
        assert_eq!(base64_encoded_len(1), Some(4));
        assert_eq!(base64_encoded_len(2), Some(4));
        assert_eq!(base64_encoded_len(3), Some(4));
        assert_eq!(base64_encoded_len(4), Some(8));
        let input_len = (MAX_IMAGE_DATA_URL_BYTES / 4) * 3;
        assert!(
            image_data_url_len(input_len, "image/webp")
                .is_some_and(|value| value > MAX_IMAGE_DATA_URL_BYTES)
        );
    }

    #[test]
    fn provider_json_body_has_an_explicit_upper_bound() {
        let normal = serialize_request_body(&json!({"model":"local"})).unwrap();
        assert!(!normal.is_empty());
        let oversized = json!({"payload": "x".repeat(MAX_PROVIDER_REQUEST_BYTES)});
        assert_eq!(
            serialize_request_body(&oversized),
            Err(AiProviderError::InputTooLarge)
        );
    }
}
