//! AI 设置与文字草稿 HTTP 边界。
//!
//! 这里负责认证、稳定错误映射和 `OpenAPI` DTO；任何草稿都不会调用 Expense 创建服务。

use std::sync::Arc;

use axum::{
    Extension, Json,
    extract::{FromRequest as _, Multipart, Path, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode},
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::ai_expense::{
        AI_IMAGE_MAX_BYTES, AI_TEXT_MAX_BYTES, AiExpenseDraftData, AiExpenseDraftProvider,
        AiExpenseRepository, AiParseError, AiProviderError, AiRepositoryError, AiSettingsError,
        AiSettingsUpdate, AiSettingsView, parse_draft, prepare_settings_update, settings_view,
        validate_base_url,
    },
    infrastructure::{
        ai_expense_repository::PostgresAiExpenseRepository,
        ai_provider::OpenAiCompatibleProvider,
        ai_secret,
        attachment_image::{AttachmentImageError, process_attachment_image},
    },
};

use super::{
    admin::{check_sensitive_limit, require_admin},
    collaboration::{authenticate, authenticate_mutation},
    error::{ApiError, RequestId},
    rate_limit::RateLimitCategory,
    router::AppState,
};

#[derive(Serialize, ToSchema)]
pub struct AiSettingsEnvelope {
    pub data: AiSettingsView,
}

/// 管理员设置 HTTP DTO；密钥只接收入站请求，不会出现在响应或日志中。
#[allow(clippy::struct_excessive_bools)]
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsRequest {
    pub enabled: bool,
    pub base_url: Option<String>,
    pub model: Option<String>,
    /// `OpenAI` JSON Mode 开关；关闭后仍要求 Provider 返回可解析 JSON，但不发送 `response_format`。
    pub json_mode: bool,
    pub timeout_seconds: i32,
    pub image_enabled: bool,
    pub max_image_bytes: i32,
    pub image_model: Option<String>,
    #[schema(nullable = true, write_only = true)]
    pub api_key: Option<String>,
    pub clear_api_key: bool,
    pub version: i64,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiCapabilityData {
    pub text_draft_available: bool,
    pub image_draft_available: bool,
}

#[derive(Serialize, ToSchema)]
pub struct AiCapabilityEnvelope {
    pub data: AiCapabilityData,
}

#[derive(Deserialize, ToSchema)]
pub struct AiTextDraftRequest {
    pub text: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiImageDraftRequest {
    #[schema(value_type = String, format = Binary)]
    pub file: Vec<u8>,
    pub reference_time: Option<String>,
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
            image_enabled: request.image_enabled,
            max_image_bytes: request.max_image_bytes,
            image_model: request.image_model,
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
        && settings
            .base_url
            .as_deref()
            .is_some_and(|value| validate_base_url(value).is_ok())
        && settings
            .model
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && settings
            .api_key_envelope
            .as_deref()
            .is_some_and(|envelope| {
                ai_secret::decrypt_api_key(&state.app_secret, envelope).is_ok()
            });
    let image_draft_available = available
        && settings.image_enabled
        && settings.max_image_bytes > 0
        && settings
            .image_model
            .as_deref()
            .or(settings.model.as_deref())
            .is_some_and(|value| !value.trim().is_empty());
    Ok(Json(AiCapabilityEnvelope {
        data: AiCapabilityData {
            text_draft_available: available,
            image_draft_available,
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
    check_ai_limit(&state, actor.user_id, request_id.clone())?;
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

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/ai/expense-draft/image",
    operation_id = "aiImageExpenseDraft",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("x-csrf-token" = String, Header, description = "当前 Session 的 CSRF token")
    ),
    request_body(content = AiImageDraftRequest, content_type = "multipart/form-data"),
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
#[allow(clippy::too_many_lines)]
pub(crate) async fn image_draft(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    request: Request,
) -> Result<Json<AiExpenseDraftEnvelope>, ApiError> {
    // 先鉴权和读取设置，再接收 multipart，避免未授权请求消耗图片解码资源。
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    check_ai_limit(&state, actor.user_id, request_id.clone())?;
    let activity_id =
        Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let repository = PostgresAiExpenseRepository::new(state.pool.clone());
    let context = repository
        .activity_context(activity_id, actor.user_id)
        .await
        .map_err(|error| map_repo_error(error, request_id.clone()))?;
    let settings = repository
        .get_settings()
        .await
        .map_err(|error| map_repo_error(error, request_id.clone()))?;
    if !settings.enabled {
        return Err(ApiError::ai_feature_disabled(request_id));
    }
    if !settings.image_enabled {
        return Err(ApiError::ai_image_disabled(request_id));
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
    let mut multipart = Multipart::from_request(request, &state)
        .await
        .map_err(|_| ApiError::invalid_attachment(request_id.clone()))?;
    let mut file: Option<(String, Vec<u8>)> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| map_image_multipart_error(error, request_id.clone()))?
    {
        match field.name() {
            Some("file") if file.is_none() => {
                let declared_mime = field
                    .content_type()
                    .map(str::to_owned)
                    .ok_or_else(|| ApiError::ai_unsupported_image(request_id.clone()))?;
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|error| map_image_multipart_error(error, request_id.clone()))?
                    .to_vec();
                if bytes.len()
                    > usize::try_from(settings.max_image_bytes).unwrap_or(AI_IMAGE_MAX_BYTES)
                {
                    return Err(ApiError::ai_image_too_large(request_id));
                }
                file = Some((declared_mime, bytes));
            }
            Some("referenceTime") => {
                // 参考时间是兼容性字段，当前解析器只使用服务端当前时间；拒绝远程 URL 等未知字段。
                let reference_time = field
                    .text()
                    .await
                    .map_err(|_| ApiError::invalid_attachment(request_id.clone()))?;
                if reference_time.len() > 128 {
                    return Err(ApiError::ai_input_too_large(request_id));
                }
            }
            _ => return Err(ApiError::invalid_attachment(request_id)),
        }
    }
    let (declared_mime, bytes) =
        file.ok_or_else(|| ApiError::ai_unsupported_image(request_id.clone()))?;
    let provider = OpenAiCompatibleProvider::new(
        base_url,
        model,
        api_key,
        settings.json_mode,
        settings.timeout_seconds,
        state.ai_provider_semaphore.clone(),
    )
    .map_err(|_| ApiError::ai_provider_not_configured(request_id.clone()))?
    .with_image_model(settings.image_model.as_deref());
    // 图片解码属于 CPU/内存密集阶段，必须先占用 AI 全局 Permit，不能等到 Provider 请求时才限流。
    let (processed, image_permit) =
        process_image_with_semaphore(state.ai_provider_semaphore.clone(), bytes, declared_mime)
            .await
            .map_err(|()| ApiError::ai_provider_unavailable(request_id.clone()))?
            .map_err(|error| map_image_error(error, request_id.clone()))?;
    let started = std::time::Instant::now();
    let response_content = provider
        .draft_from_image_with_permit(
            &processed.bytes,
            processed.mime_type,
            &context.base_currency,
            OffsetDateTime::now_utc(),
            image_permit,
        )
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id.0, model = %settings.image_model.as_deref().unwrap_or(model), elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX), error = ?error, "AI 图片草稿 Provider 请求失败");
            map_image_provider_error(error, request_id.clone())
        })?;
    tracing::info!(request_id = %request_id.0, model = %settings.image_model.as_deref().unwrap_or(model), elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX), "AI 图片草稿 Provider 请求成功");
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

fn check_ai_limit(
    state: &AppState,
    actor_user_id: Uuid,
    request_id: RequestId,
) -> Result<(), ApiError> {
    state
        .rate_limiter
        .check(RateLimitCategory::AiExpenseDraft, actor_user_id.to_string())
        .map_err(|limited| ApiError::ai_rate_limited(request_id, limited.retry_after()))
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
        AiProviderError::InputTooLarge => ApiError::ai_input_too_large(request_id),
    }
}

fn map_image_provider_error(error: AiProviderError, request_id: RequestId) -> ApiError {
    match error {
        AiProviderError::InputTooLarge => ApiError::ai_image_too_large(request_id),
        other => map_provider_error(other, request_id),
    }
}

fn map_image_error(error: AttachmentImageError, request_id: RequestId) -> ApiError {
    match error {
        AttachmentImageError::TooLarge | AttachmentImageError::PixelLimitExceeded => {
            ApiError::ai_image_too_large(request_id)
        }
        AttachmentImageError::TypeNotAllowed
        | AttachmentImageError::MimeMismatch
        | AttachmentImageError::InvalidImage => ApiError::ai_unsupported_image(request_id),
    }
}

fn map_image_multipart_error(
    error: axum::extract::multipart::MultipartError,
    request_id: RequestId,
) -> ApiError {
    let status = error.status();
    drop(error);
    if status == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::ai_image_too_large(request_id)
    } else {
        ApiError::invalid_attachment(request_id)
    }
}

/// 图片解码前取得 Permit；返回嵌套结果以区分 Semaphore/阻塞任务失败和图片内容错误。
async fn process_image_with_semaphore(
    semaphore: Arc<Semaphore>,
    bytes: Vec<u8>,
    declared_mime: String,
) -> Result<
    Result<
        (
            crate::infrastructure::attachment_image::ProcessedAttachment,
            OwnedSemaphorePermit,
        ),
        AttachmentImageError,
    >,
    (),
> {
    let permit = semaphore.acquire_owned().await.map_err(|_| ())?;
    let processed =
        tokio::task::spawn_blocking(move || process_attachment_image(&bytes, &declared_mime))
            .await
            .map_err(|_| ())?;
    Ok(processed.map(|value| (value, permit)))
}

fn no_store_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    headers
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::time::timeout;

    #[tokio::test]
    async fn image_decode_waits_for_global_semaphore_before_blocking_work() {
        let semaphore = Arc::new(Semaphore::new(0));
        let mut pending = Box::pin(process_image_with_semaphore(
            semaphore.clone(),
            Vec::new(),
            "image/png".to_owned(),
        ));
        assert!(
            timeout(Duration::from_millis(25), &mut pending)
                .await
                .is_err()
        );
        semaphore.add_permits(1);
        assert!(matches!(pending.await, Ok(Err(_))));
    }

    #[test]
    fn image_body_limit_includes_multipart_overhead() {
        const {
            assert!(crate::http::attachment::MAX_MULTIPART_BYTES > AI_IMAGE_MAX_BYTES);
            assert!(crate::http::attachment::MAX_MULTIPART_BYTES <= AI_IMAGE_MAX_BYTES + 64 * 1024);
        }
    }
}
