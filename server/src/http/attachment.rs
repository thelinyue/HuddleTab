use axum::{
    Extension,
    body::Body,
    extract::{FromRequest as _, Multipart, Path, Request, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE},
    },
    response::{IntoResponse as _, Response},
};
use axum_extra::extract::cookie::CookieJar;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::attachment::{
        AttachmentError, UploadAttachmentInput, download_attachment, upload_attachment,
    },
    infrastructure::{
        attachment_repository::PostgresAttachmentRepository, attachment_store::LocalAttachmentStore,
    },
};

use super::{
    collaboration::{authenticate, authenticate_mutation},
    error::{ApiError, RequestId},
    expense::{ExpenseAttachmentData, format_attachment},
    router::AppState,
};

pub(crate) const MAX_MULTIPART_BYTES: usize = 10 * 1024 * 1024 + 64 * 1024;

#[derive(ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadAttachmentRequest {
    #[schema(value_type = String, format = Binary)]
    pub file: Vec<u8>,
    pub client_attachment_id: String,
}

#[derive(ToSchema)]
#[schema(value_type = String, format = Binary)]
pub struct AttachmentBinary(pub Vec<u8>);

#[derive(Serialize, ToSchema)]
pub struct AttachmentEnvelope {
    pub data: ExpenseAttachmentData,
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/expenses/{expense_id}/attachments",
    operation_id = "uploadExpenseAttachment",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("expense_id" = String, Path, description = "Expense UUID"),
        ("x-csrf-token" = String, Header, description = "当前 Session 的 CSRF token")
    ),
    request_body(content = UploadAttachmentRequest, content_type = "multipart/form-data"),
    responses(
        (status = 201, description = "附件已上传", body = AttachmentEnvelope),
        (status = 200, description = "幂等重放", body = AttachmentEnvelope),
        (status = 400, description = "multipart 字段无效", body = super::error::ErrorEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无权上传", body = super::error::ErrorEnvelope),
        (status = 404, description = "Expense 不存在", body = super::error::ErrorEnvelope),
        (status = 409, description = "附件数量已满", body = super::error::ErrorEnvelope),
        (status = 422, description = "图片不符合安全策略", body = super::error::ErrorEnvelope),
        (status = 500, description = "附件服务不可用", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn upload(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, expense_id)): Path<(String, String)>,
    jar: CookieJar,
    headers: HeaderMap,
    request: Request,
) -> Result<(StatusCode, axum::Json<AttachmentEnvelope>), ApiError> {
    // 先完成 Session/CSRF，再读取 multipart body，避免未授权请求消耗图片解码资源。
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let expense_id = parse_uuid(&expense_id, request_id.clone())?;
    let mut multipart = Multipart::from_request(request, &state)
        .await
        .map_err(|_| ApiError::invalid_attachment(request_id.clone()))?;
    let mut file = None;
    let mut client_attachment_id = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| map_multipart_error(error, request_id.clone()))?
    {
        match field.name() {
            Some("file") if file.is_none() => {
                let declared_mime = field
                    .content_type()
                    .map(str::to_owned)
                    .ok_or_else(|| ApiError::invalid_attachment(request_id.clone()))?;
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|error| map_multipart_error(error, request_id.clone()))?
                    .to_vec();
                file = Some((declared_mime, bytes));
            }
            Some("clientAttachmentId") if client_attachment_id.is_none() => {
                client_attachment_id = Some(
                    field
                        .text()
                        .await
                        .map_err(|error| map_multipart_error(error, request_id.clone()))?,
                );
            }
            _ => return Err(ApiError::invalid_attachment(request_id)),
        }
    }
    let (declared_mime, bytes) =
        file.ok_or_else(|| ApiError::invalid_attachment(request_id.clone()))?;
    let client_attachment_id = client_attachment_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok())
        .ok_or_else(|| ApiError::invalid_attachment(request_id.clone()))?;
    let store = LocalAttachmentStore::new(&state.uploads_dir)
        .map_err(|_| ApiError::internal(request_id.clone()))?;
    let repository = PostgresAttachmentRepository::new(state.pool, store);
    let result = upload_attachment(
        &repository,
        UploadAttachmentInput {
            activity_id,
            expense_id,
            actor_user_id: actor.user_id,
            client_attachment_id,
            declared_mime,
            bytes,
        },
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    let status = if result.idempotent_replay {
        StatusCode::OK
    } else {
        StatusCode::CREATED
    };
    Ok((
        status,
        axum::Json(AttachmentEnvelope {
            data: format_attachment(result.attachment),
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/expenses/{expense_id}/attachments/{attachment_id}",
    operation_id = "downloadExpenseAttachment",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("expense_id" = String, Path, description = "Expense UUID"),
        ("attachment_id" = String, Path, description = "附件 UUID")
    ),
    responses(
        (status = 200, description = "私有 WebP 附件", body = AttachmentBinary,
            content_type = "image/webp",
            headers(
                ("Cache-Control" = String, description = "private, no-store"),
                ("Content-Type" = String, description = "image/webp"),
                ("Content-Disposition" = String, description = "内联稳定文件名"),
                ("X-Content-Type-Options" = String, description = "nosniff")
            )),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 404, description = "附件不存在或不可访问", body = super::error::ErrorEnvelope),
        (status = 500, description = "附件存储不可用", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn download(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, expense_id, attachment_id)): Path<(String, String, String)>,
    jar: CookieJar,
) -> Result<Response, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let expense_id = parse_uuid(&expense_id, request_id.clone())?;
    let attachment_id = parse_uuid(&attachment_id, request_id.clone())?;
    let store = LocalAttachmentStore::new(&state.uploads_dir)
        .map_err(|_| ApiError::internal(request_id.clone()))?;
    let repository = PostgresAttachmentRepository::new(state.pool, store);
    let downloaded = download_attachment(
        &repository,
        activity_id,
        expense_id,
        attachment_id,
        actor.user_id,
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    let mut response = Body::from(downloaded.bytes).into_response();
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("image/webp"));
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("private, no-store"));
    response.headers_mut().insert(
        CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "inline; filename=\"{}.webp\"",
            downloaded.attachment_id
        ))
        .expect("UUID 文件名始终是合法 HeaderValue"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

fn parse_uuid(value: &str, request_id: RequestId) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| ApiError::not_found(request_id))
}

fn map_multipart_error(
    error: axum::extract::multipart::MultipartError,
    request_id: RequestId,
) -> ApiError {
    let status = error.status();
    drop(error);
    if status == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::attachment_too_large(request_id)
    } else {
        ApiError::invalid_attachment(request_id)
    }
}

fn map_error(error: AttachmentError, request_id: RequestId) -> ApiError {
    match error {
        AttachmentError::TooLarge => ApiError::attachment_too_large(request_id),
        AttachmentError::TypeNotAllowed => ApiError::attachment_type_not_allowed(request_id),
        AttachmentError::MimeMismatch => ApiError::attachment_mime_mismatch(request_id),
        AttachmentError::ImageInvalid => ApiError::attachment_image_invalid(request_id),
        AttachmentError::LimitReached => ApiError::attachment_limit_reached(request_id),
        AttachmentError::Forbidden => ApiError::operation_forbidden(request_id),
        AttachmentError::NotFound => ApiError::not_found(request_id),
        AttachmentError::MissingFile
        | AttachmentError::StorageUnavailable
        | AttachmentError::Unavailable => ApiError::internal(request_id),
    }
}
