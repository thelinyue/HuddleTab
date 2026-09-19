//! AI 设置与文字草稿 HTTP 边界。
//!
//! 这里负责认证、稳定错误映射和 `OpenAPI` DTO；任何草稿都不会调用 Expense 创建服务。

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue},
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::ai_expense::{
        AI_TEXT_MAX_BYTES, AiExpenseDraftData, AiExpenseDraftProvider, AiExpenseRepository,
        AiParseError, AiProviderError, AiRepositoryError, AiSettingsError, AiSettingsUpdate,
        AiSettingsView, parse_draft, prepare_settings_update, settings_view,
    },
    infrastructure::{
        ai_expense_repository::PostgresAiExpenseRepository, ai_provider::OpenAiCompatibleProvider,
        ai_secret,
    },
};

use super::{
    admin::{check_sensitive_limit, require_admin},
    collaboration::{authenticate, authenticate_mutation},
    error::{ApiError, RequestId},
    router::AppState,
};

#[derive(Serialize, ToSchema)]
pub struct AiSettingsEnvelope {
    pub data: AiSettingsView,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsRequest {
    pub enabled: bool,
    pub base_url: Option<String>,
    pub model: Option<String>,
    /// `OpenAI` JSON Mode 开关；关闭后仍要求 Provider 返回可解析 JSON，但不发送 `response_format`。
    pub json_mode: bool,
    pub timeout_seconds: i32,
    #[schema(nullable = true, write_only = true)]
    pub api_key: Option<String>,
    pub clear_api_key: bool,
    pub version: i64,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiCapabilityData {
    pub text_draft_available: bool,
}

#[derive(Serialize, ToSchema)]
pub struct AiCapabilityEnvelope {
    pub data: AiCapabilityData,
}

#[derive(Deserialize, ToSchema)]
pub struct AiTextDraftRequest {
    pub text: String,
}

#[derive(Serialize, ToSchema)]
pub struct AiExpenseDraftEnvelope {
    pub data: AiExpenseDraftData,
}

#[utoipa::path(
    get,
    path = "/api/admin/ai-expense-draft-settings",
    responses(
        (status = 200, description = "AI 文字草稿设置", body = AiSettingsEnvelope),
        (status = 401, body = super::error::ErrorEnvelope),
        (status = 403, body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn get_settings(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<(HeaderMap, Json<AiSettingsEnvelope>), ApiError> {
    require_admin(&state, &jar, &headers, request_id.clone(), false).await?;
    let repository = PostgresAiExpenseRepository::new(state.pool.clone());
    let settings = repository
        .get_settings()
        .await
        .map_err(|error| map_repo_error(error, request_id.clone()))?;
    Ok((
        no_store_headers(),
        Json(AiSettingsEnvelope {
            data: settings_view(&settings, &state.app_secret),
        }),
    ))
}

#[utoipa::path(
    put,
    path = "/api/admin/ai-expense-draft-settings",
    request_body = AiSettingsRequest,
    responses(
        (status = 200, description = "AI 文字草稿设置已更新", body = AiSettingsEnvelope),
        (status = 401, body = super::error::ErrorEnvelope),
        (status = 403, body = super::error::ErrorEnvelope),
        (status = 409, body = super::error::ErrorEnvelope),
        (status = 422, body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn update_settings(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<AiSettingsRequest>,
) -> Result<(HeaderMap, Json<AiSettingsEnvelope>), ApiError> {
    let actor = require_admin(&state, &jar, &headers, request_id.clone(), true).await?;
    check_sensitive_limit(&state, actor, request_id.clone())?;
    let repository = PostgresAiExpenseRepository::new(state.pool.clone());
    let current = repository
        .get_settings()
        .await
        .map_err(|error| map_repo_error(error, request_id.clone()))?;
    if current.version != request.version {
        return Err(ApiError::admin_version_conflict(request_id));
    }
    let write = prepare_settings_update(
        &current,
        AiSettingsUpdate {
            enabled: request.enabled,
            base_url: request.base_url,
            model: request.model,
            json_mode: request.json_mode,
            timeout_seconds: request.timeout_seconds,
            api_key: request.api_key,
            clear_api_key: request.clear_api_key,
            expected_version: request.version,
        },
        &state.app_secret,
    )
    .map_err(|error| map_settings_error(error, request_id.clone()))?;
    if write.changed_fields.is_empty() && write.secret_action.is_none() {
        return Ok((
            no_store_headers(),
            Json(AiSettingsEnvelope {
                data: settings_view(&current, &state.app_secret),
            }),
        ));
    }
    let updated = repository
        .update_settings(actor, request.version, write, OffsetDateTime::now_utc())
        .await
        .map_err(|error| map_repo_error(error, request_id.clone()))?;
    Ok((
        no_store_headers(),
        Json(AiSettingsEnvelope {
            data: settings_view(&updated, &state.app_secret),
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/ai/expense-draft/capabilities",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses(
        (status = 200, body = AiCapabilityEnvelope),
        (status = 401, body = super::error::ErrorEnvelope),
        (status = 403, body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn capabilities(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<Json<AiCapabilityEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id =
        Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let repository = PostgresAiExpenseRepository::new(state.pool.clone());
    let _context = repository
        .activity_context(activity_id, actor.user_id)
        .await
        .map_err(|error| map_repo_error(error, request_id.clone()))?;
    let settings = repository
        .get_settings()
        .await
        .map_err(|error| map_repo_error(error, request_id.clone()))?;
    let available = settings.enabled
        && settings.base_url.is_some()
        && settings.model.is_some()
        && settings
            .api_key_envelope
            .as_deref()
            .is_some_and(|envelope| {
                ai_secret::decrypt_api_key(&state.app_secret, envelope).is_ok()
            });
    Ok(Json(AiCapabilityEnvelope {
        data: AiCapabilityData {
            text_draft_available: available,
        },
    }))
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/ai/expense-draft/text",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = AiTextDraftRequest,
    responses(
        (status = 200, body = AiExpenseDraftEnvelope),
        (status = 401, body = super::error::ErrorEnvelope),
        (status = 403, body = super::error::ErrorEnvelope),
        (status = 413, body = super::error::ErrorEnvelope),
        (status = 422, body = super::error::ErrorEnvelope),
        (status = 502, body = super::error::ErrorEnvelope),
        (status = 503, body = super::error::ErrorEnvelope),
        (status = 504, body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn text_draft(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<AiTextDraftRequest>,
) -> Result<Json<AiExpenseDraftEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    check_sensitive_limit(&state, actor.user_id, request_id.clone())?;
    if request.text.trim().is_empty() {
        return Err(ApiError::ai_draft_incomplete(request_id));
    }
    if request.text.len() > AI_TEXT_MAX_BYTES {
        return Err(ApiError::ai_input_too_large(request_id));
    }
    let activity_id =
        Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let repository = PostgresAiExpenseRepository::new(state.pool.clone());
    let settings = repository
        .get_settings()
        .await
        .map_err(|error| map_repo_error(error, request_id.clone()))?;
    if !settings.enabled {
        return Err(ApiError::ai_feature_disabled(request_id));
    }
    let base_url = settings
        .base_url
        .as_deref()
        .ok_or_else(|| ApiError::ai_provider_not_configured(request_id.clone()))?;
    let model = settings
        .model
        .as_deref()
        .ok_or_else(|| ApiError::ai_provider_not_configured(request_id.clone()))?;
    let envelope = settings
        .api_key_envelope
        .as_deref()
        .ok_or_else(|| ApiError::ai_provider_not_configured(request_id.clone()))?;
    let api_key = ai_secret::decrypt_api_key(&state.app_secret, envelope)
        .map_err(|_| ApiError::ai_api_key_reconfiguration_required(request_id.clone()))?;
    let context = repository
        .activity_context(activity_id, actor.user_id)
        .await
        .map_err(|error| map_repo_error(error, request_id.clone()))?;
    let provider = OpenAiCompatibleProvider::new(
        base_url,
        model,
        api_key,
        settings.json_mode,
        settings.timeout_seconds,
        state.ai_provider_semaphore.clone(),
    )
    .map_err(|_| ApiError::ai_provider_not_configured(request_id.clone()))?;
    let started = std::time::Instant::now();
    let response_content = provider
        .draft_from_text(&request.text, &context.base_currency, OffsetDateTime::now_utc())
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id.0, model = %model, elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX), error = ?error, "AI 文字草稿 Provider 请求失败");
            map_provider_error(error, request_id.clone())
        })?;
    tracing::info!(request_id = %request_id.0, model = %model, elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX), "AI 文字草稿 Provider 请求成功");
    let draft = parse_draft(&response_content, &context).map_err(|error| match error {
        AiParseError::InvalidResponse => ApiError::ai_invalid_response(request_id.clone()),
        AiParseError::Incomplete => ApiError::ai_draft_incomplete(request_id.clone()),
    })?;
    Ok(Json(AiExpenseDraftEnvelope { data: draft }))
}

fn map_repo_error(error: AiRepositoryError, request_id: RequestId) -> ApiError {
    match error {
        AiRepositoryError::VersionConflict => ApiError::admin_version_conflict(request_id),
        AiRepositoryError::Forbidden => ApiError::operation_forbidden(request_id),
        AiRepositoryError::Unavailable => ApiError::internal(request_id),
    }
}

fn map_settings_error(error: AiSettingsError, request_id: RequestId) -> ApiError {
    match error {
        AiSettingsError::InvalidInput => ApiError::invalid_admin_input(request_id),
        AiSettingsError::ReconfigurationRequired => {
            ApiError::ai_api_key_reconfiguration_required(request_id)
        }
        AiSettingsError::NotConfigured => ApiError::ai_provider_not_configured(request_id),
        AiSettingsError::VersionConflict => ApiError::admin_version_conflict(request_id),
        AiSettingsError::Unavailable => ApiError::internal(request_id),
    }
}

fn map_provider_error(error: AiProviderError, request_id: RequestId) -> ApiError {
    match error {
        AiProviderError::Timeout => ApiError::ai_provider_timeout(request_id),
        AiProviderError::Unavailable => ApiError::ai_provider_unavailable(request_id),
        AiProviderError::InvalidResponse => ApiError::ai_invalid_response(request_id),
    }
}

fn no_store_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers
}
