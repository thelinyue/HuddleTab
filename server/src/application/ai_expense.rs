//! AI 文字录入的应用层合同与纯解析逻辑。
//!
//! 本模块只生成待确认草稿，不接触 Expense 写入事务；Provider 返回的内容必须先经过
//! 这里的字段级校验、Money 标准化和活动成员安全匹配，才允许离开服务端。

use async_trait::async_trait;
use serde::Serialize;
use serde_json::Value;
use thiserror::Error;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use unicode_normalization::UnicodeNormalization;
use url::Url;
use uuid::Uuid;

use crate::{
    domain::{currency::Currency, money::Money},
    infrastructure::{ai_secret, app_secret::AppSecret},
};

pub const AI_TEXT_MAX_BYTES: usize = 8 * 1024;
pub const AI_RESPONSE_MAX_BYTES: usize = 256 * 1024;

#[derive(Clone, Eq, PartialEq)]
pub struct AiSettings {
    pub enabled: bool,
    pub base_url: Option<String>,
    pub model: Option<String>,
    /// 是否向 `OpenAI` JSON Mode 发送请求；本地兼容服务可显式关闭。
    pub json_mode: bool,
    pub timeout_seconds: i32,
    pub api_key_envelope: Option<Vec<u8>>,
    pub version: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApiKeyStatus {
    NotSet,
    Configured,
    ReconfigurationRequired,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsView {
    pub enabled: bool,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub json_mode: bool,
    pub timeout_seconds: i32,
    pub api_key_status: ApiKeyStatus,
    pub version: i64,
}

#[derive(Clone, Eq, PartialEq)]
pub struct AiSettingsUpdate {
    pub enabled: bool,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub json_mode: bool,
    pub timeout_seconds: i32,
    pub api_key: Option<String>,
    pub clear_api_key: bool,
    pub expected_version: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AiActivityMember {
    /// 该 ID 由服务端从当前活动成员表读取，Provider 原始响应永远不能提供它。
    pub member_id: Uuid,
    pub display_name: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AiActivityContext {
    pub base_currency: String,
    pub actor_member_id: Uuid,
    pub actor_display_name: String,
    pub members: Vec<AiActivityMember>,
}

#[derive(Clone, Eq, PartialEq)]
pub struct AiSettingsWrite {
    pub enabled: bool,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub json_mode: bool,
    pub timeout_seconds: i32,
    pub api_key_envelope: Option<Vec<u8>>,
    pub changed_fields: Vec<String>,
    pub secret_action: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AiRepositoryError {
    VersionConflict,
    Forbidden,
    Unavailable,
}

/// 系统设置和活动成员查询的最小数据库端口；实现位于 infrastructure，便于纯逻辑测试。
#[async_trait]
pub trait AiExpenseRepository: Send + Sync {
    async fn get_settings(&self) -> Result<AiSettings, AiRepositoryError>;
    async fn update_settings(
        &self,
        actor_user_id: Uuid,
        expected_version: i64,
        write: AiSettingsWrite,
        now: OffsetDateTime,
    ) -> Result<AiSettings, AiRepositoryError>;
    async fn activity_context(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<AiActivityContext, AiRepositoryError>;
}

/// Provider 只负责完成一次在线识别并返回 assistant content；业务解析永远在本地完成。
#[async_trait]
pub trait AiExpenseDraftProvider: Send + Sync {
    async fn draft_from_text(
        &self,
        input: &str,
        base_currency: &str,
        now: OffsetDateTime,
    ) -> Result<String, AiProviderError>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AiProviderError {
    Timeout,
    Unavailable,
    InvalidResponse,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiMoneyData {
    pub currency: String,
    pub amount_minor: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiExpenseDraftMemberSuggestion {
    pub mention: String,
    pub match_status: String,
    pub member_id: Option<Uuid>,
    pub candidate_member_ids: Vec<Uuid>,
    pub matched_display_name: Option<String>,
    pub candidate_count: Option<u32>,
    pub amount: Option<AiMoneyData>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiSplitParticipantData {
    pub mention: String,
    pub match_status: String,
    pub member_id: Option<Uuid>,
    pub candidate_member_ids: Vec<Uuid>,
    pub matched_display_name: Option<String>,
    pub candidate_count: Option<u32>,
    pub value: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiSplitSuggestionData {
    pub mode: String,
    pub participants: Vec<AiSplitParticipantData>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiDraftItemData {
    pub description: String,
    pub amount: Option<AiMoneyData>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiWarningData {
    pub code: String,
    pub field: Option<String>,
    pub message: String,
}

/// AI 对外只返回建议字段；账务实体的身份、版本和生命周期字段明确不存在于此 DTO。
#[derive(Clone, Debug, Eq, PartialEq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiExpenseDraftData {
    pub title: Option<String>,
    pub merchant: Option<String>,
    pub amount: Option<AiMoneyData>,
    pub occurred_at: Option<String>,
    pub category_suggestion: Option<String>,
    pub location: Option<String>,
    pub note: Option<String>,
    pub items: Vec<AiDraftItemData>,
    pub payer_suggestions: Vec<AiExpenseDraftMemberSuggestion>,
    pub split_suggestion: Option<AiSplitSuggestionData>,
    pub warnings: Vec<AiWarningData>,
    pub incomplete_fields: Vec<String>,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum AiSettingsError {
    #[error("AI 设置请求无效")]
    InvalidInput,
    #[error("AI API Key 需要重新配置")]
    ReconfigurationRequired,
    #[error("AI Provider 未配置")]
    NotConfigured,
    #[error("AI 设置版本冲突")]
    VersionConflict,
    #[error("AI 设置不可用")]
    Unavailable,
}

/// 读取设置时只把密钥映射为状态，永远不把解密后的明文放入 HTTP DTO。
#[must_use]
pub fn settings_view(settings: &AiSettings, app_secret: &AppSecret) -> AiSettingsView {
    let api_key_status = match settings.api_key_envelope.as_deref() {
        None => ApiKeyStatus::NotSet,
        Some(envelope) if ai_secret::decrypt_api_key(app_secret, envelope).is_ok() => {
            ApiKeyStatus::Configured
        }
        Some(_) => ApiKeyStatus::ReconfigurationRequired,
    };
    AiSettingsView {
        enabled: settings.enabled,
        base_url: settings.base_url.clone(),
        model: settings.model.clone(),
        json_mode: settings.json_mode,
        timeout_seconds: settings.timeout_seconds,
        api_key_status,
        version: settings.version,
    }
}

/// 构造设置写入数据并计算审计字段；数据库事务由 Repository 完成。
///
/// # Errors
///
/// 输入字段不合法、密钥无法加密、启用时配置不完整或旧密文无法恢复时返回错误。
pub fn prepare_settings_update(
    current: &AiSettings,
    input: AiSettingsUpdate,
    app_secret: &AppSecret,
) -> Result<AiSettingsWrite, AiSettingsError> {
    if input.expected_version <= 0
        || !(5..=120).contains(&input.timeout_seconds)
        || input.api_key.is_some() && input.clear_api_key
    {
        return Err(AiSettingsError::InvalidInput);
    }
    let base_url = normalize_base_url(input.base_url)?;
    let model = normalize_model(input.model)?;
    let envelope = if input.clear_api_key {
        None
    } else if let Some(api_key) = input.api_key.as_deref() {
        Some(
            ai_secret::encrypt_api_key(app_secret, api_key)
                .map_err(|_| AiSettingsError::InvalidInput)?,
        )
    } else {
        current.api_key_envelope.clone()
    };
    if input.enabled && (base_url.is_none() || model.is_none() || envelope.is_none()) {
        return Err(if envelope.is_some() {
            AiSettingsError::NotConfigured
        } else {
            AiSettingsError::ReconfigurationRequired
        });
    }
    if input.enabled
        && envelope
            .as_deref()
            .is_some_and(|value| ai_secret::decrypt_api_key(app_secret, value).is_err())
        && input.api_key.is_none()
    {
        return Err(AiSettingsError::ReconfigurationRequired);
    }

    let mut changed_fields = Vec::new();
    if current.enabled != input.enabled {
        changed_fields.push("enabled".to_owned());
    }
    if current.base_url != base_url {
        changed_fields.push("baseUrl".to_owned());
    }
    if current.model != model {
        changed_fields.push("model".to_owned());
    }
    if current.json_mode != input.json_mode {
        changed_fields.push("jsonMode".to_owned());
    }
    if current.timeout_seconds != input.timeout_seconds {
        changed_fields.push("timeoutSeconds".to_owned());
    }
    let secret_action = match (
        current.api_key_envelope.is_some(),
        input.clear_api_key,
        input.api_key.is_some(),
    ) {
        (false, false, true) => Some("SET".to_owned()),
        (true, false, true) => Some("REPLACED".to_owned()),
        (true, true, false) => Some("CLEARED".to_owned()),
        _ => None,
    };
    Ok(AiSettingsWrite {
        enabled: input.enabled,
        base_url,
        model,
        json_mode: input.json_mode,
        timeout_seconds: input.timeout_seconds,
        api_key_envelope: envelope,
        changed_fields,
        secret_action,
    })
}

fn normalize_base_url(value: Option<String>) -> Result<Option<String>, AiSettingsError> {
    let Some(value) = value else { return Ok(None) };
    validate_base_url(&value).map_err(|_| AiSettingsError::InvalidInput)?;
    Ok(Some(value.trim_end_matches('/').to_owned()))
}

fn normalize_model(value: Option<String>) -> Result<Option<String>, AiSettingsError> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 128 {
        return Err(AiSettingsError::InvalidInput);
    }
    Ok(Some(value.to_owned()))
}

/// 只做不需要 DNS 的 URL 检查；每次 Provider 请求还会再次解析并固定地址。
///
/// # Errors
///
/// URL 不是合法的 HTTP(S) Base URL，或包含凭据、query、fragment、完整接口路径时返回错误。
pub fn validate_base_url(value: &str) -> Result<(), &'static str> {
    let url = Url::parse(value).map_err(|_| "URL 格式无效")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Base URL 必须是无凭据、无 query、无 fragment 的 HTTP(S) 地址");
    }
    if url
        .path()
        .trim_end_matches('/')
        .ends_with("/chat/completions")
    {
        return Err("Base URL 不应包含 chat/completions 路径");
    }
    Ok(())
}

/// 将 Provider content 严格转换为草稿。外层 JSON 合法但单字段非法时保留其他字段。
///
/// # Errors
///
/// content 不是 JSON object 或完全没有可确认核心字段时返回对应错误。
pub fn parse_draft(
    response_content: &str,
    activity_context: &AiActivityContext,
) -> Result<AiExpenseDraftData, AiParseError> {
    let value: Value =
        serde_json::from_str(response_content).map_err(|_| AiParseError::InvalidResponse)?;
    let object = value.as_object().ok_or(AiParseError::InvalidResponse)?;
    let mut warnings = Vec::new();
    let mut incomplete_fields = Vec::new();
    let allowed = [
        "title",
        "merchant",
        "amount",
        "currency",
        "occurredAt",
        "category",
        "location",
        "note",
        "items",
        "payers",
        "split",
    ];
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            warnings.push(warning("AI_FIELD_DROPPED", Some(key), "未识别字段已忽略"));
        }
    }
    let title = bounded_string(object.get("title"), 120, "title", &mut warnings);
    let merchant = bounded_string(object.get("merchant"), 120, "merchant", &mut warnings);
    let category_suggestion = bounded_string(object.get("category"), 64, "category", &mut warnings);
    let location = bounded_string(object.get("location"), 120, "location", &mut warnings);
    let note = bounded_string(object.get("note"), 2000, "note", &mut warnings);
    let occurred_at = parse_time(object.get("occurredAt"), &mut warnings);
    let amount = parse_money_value(
        object.get("amount"),
        object.get("currency"),
        activity_context,
        "amount",
        &mut warnings,
    );
    let items = parse_items(object.get("items"), activity_context, &mut warnings);
    let payer_suggestions = parse_payers(object.get("payers"), activity_context, &mut warnings);
    let split_suggestion = parse_split(object.get("split"), activity_context, &mut warnings);

    if title.is_none()
        && amount.is_none()
        && occurred_at.is_none()
        && !payer_suggestions
            .iter()
            .any(|item| item.member_id.is_some())
        && !split_suggestion.as_ref().is_some_and(|split| {
            split
                .participants
                .iter()
                .any(|item| item.member_id.is_some())
        })
    {
        return Err(AiParseError::Incomplete);
    }
    if title.is_none() {
        incomplete_fields.push("title".to_owned());
    }
    if amount.is_none() {
        incomplete_fields.push("amount".to_owned());
    }
    if payer_suggestions.is_empty() {
        incomplete_fields.push("payer".to_owned());
    }
    Ok(AiExpenseDraftData {
        title,
        merchant,
        amount,
        occurred_at,
        category_suggestion,
        location,
        note,
        items,
        payer_suggestions,
        split_suggestion,
        warnings,
        incomplete_fields,
    })
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum AiParseError {
    #[error("Provider 返回内容不可解析")]
    InvalidResponse,
    #[error("Provider 未返回可确认的核心账单字段")]
    Incomplete,
}

fn warning(code: &str, field: Option<&str>, message: &str) -> AiWarningData {
    AiWarningData {
        code: code.to_owned(),
        field: field.map(str::to_owned),
        message: message.to_owned(),
    }
}

fn bounded_string(
    value: Option<&Value>,
    max: usize,
    field: &str,
    warnings: &mut Vec<AiWarningData>,
) -> Option<String> {
    let value = value?;
    let Some(text) = value.as_str() else {
        warnings.push(warning(
            "AI_FIELD_INVALID",
            Some(field),
            "字段类型无效，已忽略",
        ));
        return None;
    };
    let text = text.trim();
    if text.is_empty() || text.chars().count() > max {
        warnings.push(warning(
            "AI_FIELD_INVALID",
            Some(field),
            "字段为空或长度超限，已忽略",
        ));
        return None;
    }
    Some(text.to_owned())
}

fn parse_time(value: Option<&Value>, warnings: &mut Vec<AiWarningData>) -> Option<String> {
    let text = value.and_then(Value::as_str)?;
    if let Ok(value) = OffsetDateTime::parse(text, &Rfc3339) {
        Some(value.to_string())
    } else {
        warnings.push(warning(
            "AI_FIELD_INVALID",
            Some("occurredAt"),
            "时间不是有效 RFC3339，已忽略",
        ));
        None
    }
}

fn parse_money_value(
    value: Option<&Value>,
    currency_value: Option<&Value>,
    context: &AiActivityContext,
    field: &str,
    warnings: &mut Vec<AiWarningData>,
) -> Option<AiMoneyData> {
    let (raw_amount, raw_currency) = if let Some(object) = value.and_then(Value::as_object) {
        (
            object.get("value").or_else(|| object.get("amount")),
            object.get("currency").or(currency_value),
        )
    } else {
        (value, currency_value)
    };
    value?;
    let Some(raw_amount) = raw_amount.and_then(Value::as_str) else {
        warnings.push(warning(
            "AI_AMOUNT_INVALID",
            Some(field),
            "金额必须是十进制字符串，已忽略",
        ));
        return None;
    };
    let Some(raw_currency) = raw_currency.and_then(Value::as_str) else {
        warnings.push(warning(
            "AI_AMOUNT_INVALID",
            Some(field),
            "金额缺少币种，已忽略",
        ));
        return None;
    };
    let code = raw_currency.trim().to_ascii_uppercase();
    let Ok(currency) = Currency::parse(&code) else {
        warnings.push(warning(
            "AI_AMOUNT_INVALID",
            Some(field),
            "币种不受支持，已忽略",
        ));
        return None;
    };
    let Ok(money) = Money::from_major_decimal(currency.clone(), raw_amount) else {
        warnings.push(warning(
            "AI_AMOUNT_INVALID",
            Some(field),
            "金额格式或范围无效，已忽略",
        ));
        return None;
    };
    if money.amount_minor() <= 0 {
        warnings.push(warning(
            "AI_AMOUNT_INVALID",
            Some(field),
            "金额必须大于零，已忽略",
        ));
        return None;
    }
    let _ = context;
    Some(AiMoneyData {
        currency: currency.code().to_owned(),
        amount_minor: money.to_api_amount(),
    })
}

fn parse_items(
    value: Option<&Value>,
    context: &AiActivityContext,
    warnings: &mut Vec<AiWarningData>,
) -> Vec<AiDraftItemData> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let description = bounded_string(object.get("description"), 120, "items", warnings)?;
            let amount = parse_money_value(
                object.get("amount"),
                object.get("currency"),
                context,
                "items.amount",
                warnings,
            );
            Some(AiDraftItemData {
                description,
                amount,
            })
        })
        .collect()
}

/// Provider 的成员建议只保留用户可读 mention 和原始金额字段。
///
/// 特意不定义 `member_id`/`memberId` 字段：模型即使返回伪造 UUID，也只能作为被忽略的
/// 未知字段进入 warning，不能穿透到标准化草稿。真实 ID 只能来自 `AiActivityContext`。
#[derive(Clone, Debug)]
pub(crate) struct ProviderRawMemberSuggestion {
    mention: String,
    amount: Option<Value>,
    currency: Option<Value>,
    value: Option<String>,
}

fn parse_raw_member_suggestion(
    value: &Value,
    field: &str,
    warnings: &mut Vec<AiWarningData>,
) -> Option<ProviderRawMemberSuggestion> {
    let object = value.as_object()?;
    for key in object.keys() {
        if !matches!(key.as_str(), "name" | "amount" | "currency" | "value") {
            let message = if matches!(key.as_str(), "memberId" | "member_id") {
                "模型提供的成员 ID 已忽略，只接受服务端匹配结果"
            } else {
                "未识别成员字段已忽略"
            };
            warnings.push(warning("AI_MEMBER_FIELD_DROPPED", Some(field), message));
        }
    }
    let mention = match bounded_string(object.get("name"), 80, field, warnings) {
        Some(mention) => mention,
        None if object.get("name").is_none() => {
            warnings.push(warning(
                "AI_MEMBER_INVALID",
                Some(field),
                "成员缺少姓名，已忽略",
            ));
            return None;
        }
        None => return None,
    };
    Some(ProviderRawMemberSuggestion {
        mention,
        amount: object.get("amount").cloned(),
        currency: object.get("currency").cloned(),
        value: object
            .get("value")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

fn parse_payers(
    value: Option<&Value>,
    context: &AiActivityContext,
    warnings: &mut Vec<AiWarningData>,
) -> Vec<AiExpenseDraftMemberSuggestion> {
    let Some(payers) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    payers
        .iter()
        .filter_map(|item| {
            let raw = parse_raw_member_suggestion(item, "payers", warnings)?;
            let matched = match_member(&raw.mention, context);
            let amount = parse_money_value(
                raw.amount.as_ref(),
                raw.currency.as_ref(),
                context,
                "payers.amount",
                warnings,
            );
            Some(AiExpenseDraftMemberSuggestion {
                mention: raw.mention,
                match_status: matched.status.to_owned(),
                member_id: matched.member_id,
                candidate_member_ids: matched.candidate_member_ids,
                matched_display_name: matched.display_name,
                candidate_count: matched.candidate_count,
                amount,
            })
        })
        .collect()
}

fn parse_split(
    value: Option<&Value>,
    context: &AiActivityContext,
    warnings: &mut Vec<AiWarningData>,
) -> Option<AiSplitSuggestionData> {
    let object = value?.as_object()?;
    let mode = object.get("mode")?.as_str()?.to_owned();
    if !matches!(mode.as_str(), "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT") {
        warnings.push(warning(
            "AI_SPLIT_INVALID",
            Some("split"),
            "分摊模式不受支持，已忽略",
        ));
        return None;
    }
    let participants: Vec<AiSplitParticipantData> = object
        .get("participants")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let raw = parse_raw_member_suggestion(item, "split.participants", warnings)?;
                    let matched = match_member(&raw.mention, context);
                    let value = raw.value.as_deref().and_then(|text| {
                        if mode == "EQUAL" {
                            warnings.push(warning(
                                "AI_SPLIT_INVALID",
                                Some("split.participants.value"),
                                "平均分摊不接受额外参数，已忽略",
                            ));
                            return None;
                        }
                        if mode == "EXACT" {
                            return parse_exact_split_value(text, context, warnings);
                        }
                        let valid = is_decimal_parameter(text);
                        if valid {
                            Some(text.to_owned())
                        } else {
                            warnings.push(warning(
                                "AI_SPLIT_INVALID",
                                Some("split.participants.value"),
                                "分摊参数无效，已忽略",
                            ));
                            None
                        }
                    });
                    Some(AiSplitParticipantData {
                        mention: raw.mention,
                        match_status: matched.status.to_owned(),
                        member_id: matched.member_id,
                        candidate_member_ids: matched.candidate_member_ids,
                        matched_display_name: matched.display_name,
                        candidate_count: matched.candidate_count,
                        value,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if participants.is_empty() {
        warnings.push(warning(
            "AI_SPLIT_INCOMPLETE",
            Some("split.participants"),
            "分摊缺少参与成员",
        ));
    }
    Some(AiSplitSuggestionData { mode, participants })
}

fn parse_exact_split_value(
    text: &str,
    context: &AiActivityContext,
    warnings: &mut Vec<AiWarningData>,
) -> Option<String> {
    let Ok(currency) = Currency::parse(&context.base_currency) else {
        warnings.push(warning(
            "AI_SPLIT_INVALID",
            Some("split.participants.value"),
            "活动主币种无效，固定金额已忽略",
        ));
        return None;
    };
    match Money::from_major_decimal(currency, text) {
        Ok(value) if value.amount_minor() >= 0 => Some(value.to_api_amount()),
        _ => {
            warnings.push(warning(
                "AI_SPLIT_INVALID",
                Some("split.participants.value"),
                "固定金额无效，已忽略",
            ));
            None
        }
    }
}

fn is_decimal_parameter(value: &str) -> bool {
    if value.is_empty() || value.len() > 32 || value.contains(['e', 'E', '+', '-']) {
        return false;
    }
    let mut parts = value.split('.');
    let whole = parts.next().unwrap_or("");
    let fractional = parts.next().unwrap_or("");
    parts.next().is_none()
        && !whole.is_empty()
        && whole.bytes().all(|byte| byte.is_ascii_digit())
        && (whole == "0" || !whole.starts_with('0'))
        && fractional.bytes().all(|byte| byte.is_ascii_digit())
}

struct MemberMatch {
    status: &'static str,
    member_id: Option<Uuid>,
    candidate_member_ids: Vec<Uuid>,
    display_name: Option<String>,
    candidate_count: Option<u32>,
}

fn match_member(mention: &str, context: &AiActivityContext) -> MemberMatch {
    if mention.trim() == "我" {
        return MemberMatch {
            status: "MATCHED",
            member_id: Some(context.actor_member_id),
            candidate_member_ids: Vec::new(),
            display_name: Some(context.actor_display_name.clone()),
            candidate_count: None,
        };
    }
    let normalized = normalize_member(mention);
    let matches: Vec<&AiActivityMember> = context
        .members
        .iter()
        .filter(|member| normalize_member(&member.display_name) == normalized)
        .collect();
    match matches.as_slice() {
        [member] => MemberMatch {
            status: "MATCHED",
            member_id: Some(member.member_id),
            candidate_member_ids: Vec::new(),
            display_name: Some(member.display_name.clone()),
            candidate_count: None,
        },
        [] => MemberMatch {
            status: "UNMATCHED",
            member_id: None,
            candidate_member_ids: Vec::new(),
            display_name: None,
            candidate_count: None,
        },
        values => MemberMatch {
            status: "AMBIGUOUS",
            member_id: None,
            candidate_member_ids: values.iter().map(|member| member.member_id).collect(),
            display_name: None,
            candidate_count: u32::try_from(values.len()).ok(),
        },
    }
}

fn normalize_member(value: &str) -> String {
    value
        .nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> AiActivityContext {
        AiActivityContext {
            base_currency: "CNY".to_owned(),
            actor_member_id: Uuid::from_u128(1),
            actor_display_name: "林樾".to_owned(),
            members: vec![
                AiActivityMember {
                    member_id: Uuid::from_u128(1),
                    display_name: "林樾".to_owned(),
                },
                AiActivityMember {
                    member_id: Uuid::from_u128(2),
                    display_name: "小王".to_owned(),
                },
                AiActivityMember {
                    member_id: Uuid::from_u128(3),
                    display_name: "小王".to_owned(),
                },
            ],
        }
    }

    #[test]
    fn parses_partial_draft_without_float() {
        let draft = parse_draft(r#"{"title":"居酒屋","amount":{"value":"12800","currency":"JPY"},"payers":[{"name":"我"}],"unknown":1}"#, &context()).unwrap();
        assert_eq!(draft.amount.unwrap().amount_minor, "12800");
        assert_eq!(draft.payer_suggestions[0].match_status, "MATCHED");
        assert_eq!(
            draft.payer_suggestions[0].member_id,
            Some(Uuid::from_u128(1))
        );
        assert!(
            draft
                .warnings
                .iter()
                .any(|item| item.code == "AI_FIELD_DROPPED")
        );
    }

    #[test]
    fn ambiguous_member_is_not_selected() {
        let draft =
            parse_draft(r#"{"title":"晚餐","payers":[{"name":"小王"}]}"#, &context()).unwrap();
        assert_eq!(draft.payer_suggestions[0].match_status, "AMBIGUOUS");
        assert_eq!(
            draft.payer_suggestions[0].candidate_member_ids,
            vec![Uuid::from_u128(2), Uuid::from_u128(3)]
        );
        assert!(draft.payer_suggestions[0].matched_display_name.is_none());
    }

    #[test]
    fn invalid_content_and_empty_core_are_distinct() {
        assert_eq!(
            parse_draft("not-json", &context()),
            Err(AiParseError::InvalidResponse)
        );
        assert_eq!(
            parse_draft(r#"{"note":"仅备注"}"#, &context()),
            Err(AiParseError::Incomplete)
        );
    }

    #[test]
    fn settings_update_uses_explicit_secret_actions_and_rejects_unsafe_urls() {
        let secret = AppSecret::from_bytes([9; 32]);
        let current = AiSettings {
            enabled: false,
            base_url: None,
            model: None,
            json_mode: true,
            timeout_seconds: 30,
            api_key_envelope: None,
            version: 1,
        };
        let write = prepare_settings_update(
            &current,
            AiSettingsUpdate {
                enabled: true,
                base_url: Some("https://api.deepseek.com".to_owned()),
                model: Some("deepseek-chat".to_owned()),
                json_mode: true,
                timeout_seconds: 30,
                api_key: Some("test-key".to_owned()),
                clear_api_key: false,
                expected_version: 1,
            },
            &secret,
        )
        .unwrap();
        assert_eq!(write.secret_action.as_deref(), Some("SET"));
        assert!(
            prepare_settings_update(
                &current,
                AiSettingsUpdate {
                    enabled: false,
                    base_url: Some("https://user:pass@example.test".to_owned()),
                    model: None,
                    json_mode: true,
                    timeout_seconds: 30,
                    api_key: None,
                    clear_api_key: false,
                    expected_version: 1,
                },
                &secret,
            )
            .is_err()
        );
    }

    #[test]
    fn provider_member_id_is_ignored_and_server_ids_are_used() {
        let fake = Uuid::from_u128(999);
        let draft = parse_draft(
            &format!(r#"{{"title":"晚餐","payers":[{{"name":"林樾","memberId":"{fake}"}}]}}"#),
            &context(),
        )
        .unwrap();
        assert_eq!(
            draft.payer_suggestions[0].member_id,
            Some(Uuid::from_u128(1))
        );
        assert!(
            !draft.payer_suggestions[0]
                .candidate_member_ids
                .contains(&fake)
        );
        assert!(
            draft
                .warnings
                .iter()
                .any(|item| item.code == "AI_MEMBER_FIELD_DROPPED")
        );
    }

    #[test]
    fn unmatched_members_never_receive_an_id() {
        let draft = parse_draft(
            r#"{"title":"晚餐","payers":[{"name":"不存在的人"}]}"#,
            &context(),
        )
        .unwrap();
        assert_eq!(draft.payer_suggestions[0].match_status, "UNMATCHED");
        assert!(draft.payer_suggestions[0].member_id.is_none());
        assert!(draft.payer_suggestions[0].candidate_member_ids.is_empty());
    }

    #[test]
    fn invalid_business_field_is_dropped_with_warning() {
        let draft = parse_draft(
            r#"{"title":"晚餐","amount":{"value":128,"currency":"CNY"}}"#,
            &context(),
        )
        .unwrap();
        assert!(draft.amount.is_none());
        assert!(
            draft
                .warnings
                .iter()
                .any(|item| item.code == "AI_AMOUNT_INVALID")
        );
    }
}
