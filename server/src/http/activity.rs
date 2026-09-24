use super::formatting::format_time;
use axum::{
    Extension, Json,
    body::Body,
    extract::{FromRequest as _, Multipart, Path, Query, Request, State},
    http::{
        HeaderMap, HeaderValue, StatusCode,
        header::{CACHE_CONTROL, CONTENT_TYPE},
    },
    response::{IntoResponse as _, Response},
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Deserializer, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;

use crate::{
    application::{
        activity::{
            ActivityAuditEntry, ActivityLifecycleInput, ActivityMemberView, ActivityVersionInput,
            ActivityView, CreateActivityError, CreateActivityInput, ReadActivityAuditError,
            ReadActivityError, TransferActivityOwnershipInput, UpdateActivityError,
            UpdateActivityInput, create_activity, delete_activity, get_activity, list_activities,
            list_activity_audit_logs, list_activity_members, transfer_activity_ownership,
            transition_activity, update_activity,
        },
        auth::{CurrentSessionError, current_session},
    },
    domain::activity::{ActivityCapabilities, ActivityStatus},
    infrastructure::{
        activity_repository::{ActivityCoverImage, PostgresActivityRepository},
        attachment_image::{AttachmentImageError, process_fixed_image},
        attachment_store::LocalAttachmentStore,
        auth_repository::PostgresAuthRepository,
        clock::SystemClock,
    },
};

use super::{
    auth::validate_session_csrf,
    collaboration::{authenticate, authenticate_mutation},
    error::{ApiError, RequestId},
    rate_limit::RateLimitCategory,
    router::AppState,
};

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateActivityRequest {
    pub name: String,
    pub location: Option<String>,
    pub base_currency: String,
    pub start_date: String,
    pub end_date: Option<String>,
    /// 未传值的旧客户端默认使用第 12 张“日常通用”封面。
    pub cover_preset: Option<i16>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateActivityRequest {
    pub version: String,
    pub name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub location: Option<Option<String>>,
    pub base_currency: Option<String>,
    pub start_date: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    pub end_date: Option<Option<String>>,
    pub invite_mode: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLifecycleRequest {
    pub action: String,
    pub version: String,
}

#[derive(Deserialize, ToSchema)]
pub struct ActivityVersionRequest {
    pub version: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TransferOwnershipRequest {
    pub new_owner_member_id: String,
    pub version: String,
}

/// 活动列表支持的视图筛选值。
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ActivityListView {
    Current,
}

/// 活动列表视图筛选；未传值时默认读取当前活动。
#[derive(Deserialize)]
pub struct ActivityListQuery {
    pub view: Option<ActivityListView>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCoverPresetRequest {
    pub version: String,
    pub cover_preset: i16,
}

#[derive(ToSchema)]
#[schema(value_type = String, format = Binary)]
pub struct CoverBinary(pub Vec<u8>);

/// 自定义封面上传的 multipart 字段。版本号与文件一起提交，确保图片替换遵守乐观锁。
#[derive(ToSchema)]
pub struct UploadCoverRequest {
    #[schema(value_type = String, format = Binary)]
    pub file: Vec<u8>,
    pub version: String,
}

#[derive(Deserialize)]
pub struct ActivityAuditQuery {
    pub cursor: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct ActivityEnvelope {
    pub data: ActivityData,
}

#[derive(Serialize, ToSchema)]
pub struct ActivityListEnvelope {
    pub data: Vec<ActivityData>,
}

#[derive(Serialize, ToSchema)]
pub struct ActivityUpdateEnvelope {
    pub data: ActivityData,
    pub warnings: Vec<String>,
}

#[derive(Serialize, ToSchema)]
pub struct ActivityMemberListEnvelope {
    pub data: Vec<ActivityMemberData>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAuditChangeData {
    pub field: String,
    pub before_value: Option<String>,
    pub after_value: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAuditExpenseData {
    pub expense_id: String,
    pub title: String,
    pub category: String,
    pub original_currency: String,
    pub original_amount_minor: String,
    pub occurred_at: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAuditData {
    pub audit_id: String,
    pub action: String,
    pub source: Option<String>,
    pub actor_user_id: Option<String>,
    pub actor_member_id: Option<String>,
    pub actor_display_name: String,
    pub actor_avatar_preset: Option<i16>,
    pub actor_avatar_image_id: Option<String>,
    pub revision: String,
    pub changes: Vec<ActivityAuditChangeData>,
    pub expense: Option<ActivityAuditExpenseData>,
    pub created_at: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAuditListEnvelope {
    pub data: Vec<ActivityAuditData>,
    pub next_cursor: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityData {
    pub activity_id: String,
    pub owner_member_id: String,
    pub name: String,
    pub location: Option<String>,
    pub base_currency: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub invite_mode: String,
    pub status: String,
    pub version: String,
    pub revision: String,
    pub current_member_id: String,
    pub current_member_role: String,
    pub has_accounting_records: bool,
    pub cover_preset: Option<i16>,
    pub cover_image_id: Option<String>,
    pub field_permissions: ActivityFieldPermissionsData,
    pub allowed_lifecycle_actions: Vec<String>,
    pub can_delete: bool,
}

/// HTTP 合同逐字段镜像领域权限，客户端只消费服务端结论，不自行重建权限规则。
#[allow(clippy::struct_excessive_bools)]
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFieldPermissionsData {
    pub name: bool,
    pub location: bool,
    pub base_currency: bool,
    pub start_date: bool,
    pub end_date: bool,
    pub invite_mode: bool,
    pub cover: bool,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityMemberData {
    pub member_id: String,
    pub activity_id: String,
    pub user_id: Option<String>,
    pub display_name: String,
    pub avatar_preset: Option<i16>,
    pub avatar_image_id: Option<String>,
    pub role: String,
    pub status: String,
    pub version: String,
}

#[utoipa::path(
    post,
    path = "/api/activities",
    operation_id = "createActivity",
    request_body = CreateActivityRequest,
    responses(
        (status = 201, description = "活动已创建", body = ActivityEnvelope),
        (status = 400, description = "活动输入无效", body = super::error::ErrorEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 校验失败", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn create(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<CreateActivityRequest>,
) -> Result<(StatusCode, Json<ActivityEnvelope>), ApiError> {
    let token = validate_session_csrf(&state, &jar, &headers, request_id.clone())?;
    let auth_repository = PostgresAuthRepository::new(state.pool.clone());
    let actor = current_session(&auth_repository, &SystemClock, &token)
        .await
        .map_err(|error| match error {
            CurrentSessionError::Unauthenticated => ApiError::unauthenticated(request_id.clone()),
            CurrentSessionError::Unavailable => ApiError::internal(request_id.clone()),
        })?;
    let repository = PostgresActivityRepository::new(state.pool);
    let activity = create_activity(
        &repository,
        &SystemClock,
        CreateActivityInput {
            name: request.name,
            location: request.location,
            base_currency: request.base_currency,
            start_date: request.start_date,
            end_date: request.end_date,
            cover_preset: request.cover_preset,
            actor_user_id: actor.user_id,
            actor_display_name: actor.display_name,
        },
    )
    .await
    .map_err(|error| match error {
        CreateActivityError::InvalidName
        | CreateActivityError::InvalidCurrency
        | CreateActivityError::InvalidDetails => ApiError::invalid_activity(request_id.clone()),
        CreateActivityError::Unavailable => ApiError::internal(request_id.clone()),
    })?;

    Ok((
        StatusCode::CREATED,
        Json(ActivityEnvelope {
            data: ActivityData {
                activity_id: activity.activity_id.to_string(),
                owner_member_id: activity.owner_member_id.to_string(),
                name: activity.name,
                location: activity.location,
                base_currency: activity.base_currency,
                start_date: activity.start_date.to_string(),
                end_date: activity.end_date.map(|value| value.to_string()),
                invite_mode: activity.invite_mode,
                status: "ACTIVE".to_owned(),
                version: activity.version.to_string(),
                revision: activity.revision.to_string(),
                current_member_id: activity.owner_member_id.to_string(),
                current_member_role: "OWNER".to_owned(),
                has_accounting_records: false,
                cover_preset: activity.cover_preset,
                cover_image_id: None,
                field_permissions: ActivityFieldPermissionsData {
                    name: true,
                    location: true,
                    base_currency: true,
                    start_date: true,
                    end_date: true,
                    invite_mode: true,
                    cover: true,
                },
                allowed_lifecycle_actions: vec!["END".to_owned()],
                can_delete: true,
            },
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/activities",
    operation_id = "listActivities",
    params(("view" = inline(Option<ActivityListView>), Query, description = "活动视图：current")),
    responses(
        (status = 200, description = "当前用户可访问的活动", body = ActivityListEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    Query(query): Query<ActivityListQuery>,
) -> Result<Json<ActivityListEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let repository = PostgresActivityRepository::new(state.pool);
    let activities = match query.view.unwrap_or(ActivityListView::Current) {
        ActivityListView::Current => list_activities(&repository, actor.user_id).await,
    }
    .map_err(|error| map_read_error(error, request_id))?;
    Ok(Json(ActivityListEnvelope {
        data: activities.into_iter().map(activity_data).collect(),
    }))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}",
    operation_id = "getActivity",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses(
        (status = 200, description = "活动详情", body = ActivityEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 404, description = "活动不存在", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<Json<ActivityEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id =
        uuid::Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let repository = PostgresActivityRepository::new(state.pool);
    let activity = get_activity(&repository, activity_id, actor.user_id)
        .await
        .map_err(|error| map_read_error(error, request_id))?;
    Ok(Json(ActivityEnvelope {
        data: activity_data(activity),
    }))
}

#[utoipa::path(
    put,
    path = "/api/activities/{activity_id}",
    operation_id = "updateActivity",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = UpdateActivityRequest,
    responses(
        (status = 200, description = "活动资料已更新", body = ActivityUpdateEnvelope),
        (status = 400, description = "活动输入无效", body = super::error::ErrorEnvelope),
        (status = 403, description = "无活动管理权限", body = super::error::ErrorEnvelope),
        (status = 404, description = "活动不存在", body = super::error::ErrorEnvelope),
        (status = 409, description = "活动版本或状态冲突", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn update(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<UpdateActivityRequest>,
) -> Result<Json<ActivityUpdateEnvelope>, ApiError> {
    let actor =
        super::collaboration::authenticate_mutation(&state, &jar, &headers, request_id.clone())
            .await?;
    let activity_id =
        uuid::Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let repository = PostgresActivityRepository::new(state.pool);
    let result = update_activity(
        &repository,
        &SystemClock,
        UpdateActivityInput {
            activity_id,
            actor_user_id: actor.user_id,
            version: request.version,
            name: request.name,
            location: request.location,
            base_currency: request.base_currency,
            start_date: request.start_date,
            end_date: request.end_date,
            invite_mode: request.invite_mode,
        },
    )
    .await
    .map_err(|error| map_update_error(error, request_id))?;
    Ok(Json(ActivityUpdateEnvelope {
        data: activity_data(result.activity),
        warnings: result.warnings,
    }))
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/lifecycle",
    operation_id = "transitionActivity",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = ActivityLifecycleRequest,
    responses(
        (status = 200, description = "活动状态已更新", body = ActivityEnvelope),
        (status = 409, description = "活动版本或状态冲突", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn transition(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<ActivityLifecycleRequest>,
) -> Result<Json<ActivityEnvelope>, ApiError> {
    let actor =
        super::collaboration::authenticate_mutation(&state, &jar, &headers, request_id.clone())
            .await?;
    let activity = transition_activity(
        &PostgresActivityRepository::new(state.pool),
        &SystemClock,
        ActivityLifecycleInput {
            activity_id: parse_activity_id(&activity_id, request_id.clone())?,
            actor_user_id: actor.user_id,
            version: request.version,
            action: request.action,
        },
    )
    .await
    .map_err(|error| map_update_error(error, request_id))?;
    Ok(Json(ActivityEnvelope {
        data: activity_data(activity),
    }))
}

#[utoipa::path(
    delete,
    path = "/api/activities/{activity_id}",
    operation_id = "deleteActivity",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = ActivityVersionRequest,
    responses(
        (status = 204, description = "活动已永久删除"),
        (status = 409, description = "活动版本或状态冲突", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn delete(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<ActivityVersionRequest>,
) -> Result<StatusCode, ApiError> {
    let actor =
        super::collaboration::authenticate_mutation(&state, &jar, &headers, request_id.clone())
            .await?;
    let storage_keys = delete_activity(
        &PostgresActivityRepository::new(state.pool.clone()),
        ActivityVersionInput {
            activity_id: parse_activity_id(&activity_id, request_id.clone())?,
            actor_user_id: actor.user_id,
            version: request.version,
        },
    )
    .await
    .map_err(|error| map_update_error(error, request_id))?;
    // 数据库已提交，文件失败不能伪装成活动删除失败；孤立文件任务负责后续重试。
    let store = LocalAttachmentStore::new(&state.uploads_dir);
    for storage_key in storage_keys {
        let removed = match &store {
            Ok(store) => store.remove(&storage_key).await.is_ok(),
            Err(_) => false,
        };
        if !removed {
            tracing::error!(storage_key = %storage_key, "永久删除活动后的图片清理失败，将由孤立文件任务重试");
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/ownership",
    operation_id = "transferActivityOwnership",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("x-csrf-token" = String, Header, description = "当前 Session 的 CSRF token")
    ),
    request_body = TransferOwnershipRequest,
    responses(
        (status = 200, description = "活动所有权已转让", body = ActivityEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无活动管理权限或 CSRF 校验失败", body = super::error::ErrorEnvelope),
        (status = 404, description = "活动不存在", body = super::error::ErrorEnvelope),
        (status = 409, description = "活动版本或状态冲突", body = super::error::ErrorEnvelope),
        (status = 422, description = "目标成员不符合转让条件", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求过于频繁", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn transfer_ownership(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<TransferOwnershipRequest>,
) -> Result<Json<ActivityEnvelope>, ApiError> {
    let actor =
        super::collaboration::authenticate_mutation(&state, &jar, &headers, request_id.clone())
            .await?;
    state
        .rate_limiter
        .check(
            RateLimitCategory::SensitiveAuthenticated,
            actor.user_id.to_string(),
        )
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;
    let activity = transfer_activity_ownership(
        &PostgresActivityRepository::new(state.pool),
        &SystemClock,
        TransferActivityOwnershipInput {
            activity_id: parse_activity_id(&activity_id, request_id.clone())?,
            actor_user_id: actor.user_id,
            new_owner_member_id: request.new_owner_member_id,
            version: request.version,
        },
    )
    .await
    .map_err(|error| map_ownership_error(error, request_id))?;
    Ok(Json(ActivityEnvelope {
        data: activity_data(activity),
    }))
}

/// 保存内置封面；只有 Owner 在 ACTIVE 活动中才能修改，提交后清除旧自定义图片。
#[utoipa::path(
    patch,
    path = "/api/activities/{activity_id}/cover",
    operation_id = "updateActivityCoverPreset",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = UpdateCoverPresetRequest,
    responses((status = 200, description = "封面已更新", body = ActivityEnvelope))
)]
pub(crate) async fn update_cover_preset(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<UpdateCoverPresetRequest>,
) -> Result<Json<ActivityEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let activity_id = parse_activity_id(&activity_id, request_id.clone())?;
    let version = request
        .version
        .parse::<i64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::invalid_activity(request_id.clone()))?;
    if !(1..=12).contains(&request.cover_preset) {
        return Err(ApiError::invalid_activity(request_id));
    }
    let repository = PostgresActivityRepository::new(state.pool.clone());
    let (activity, old_storage_key) = repository
        .set_cover_preset(
            activity_id,
            actor.user_id,
            version,
            request.cover_preset,
            OffsetDateTime::now_utc(),
        )
        .await
        .map_err(|error| {
            map_update_error(map_repository_update_error(error), request_id.clone())
        })?;
    remove_old_cover(&state, old_storage_key).await;
    Ok(Json(ActivityEnvelope {
        data: activity_data(activity),
    }))
}

/// 处理并保存自定义封面。认证与 CSRF 完成后才读取 multipart，避免未授权请求触发解码。
#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/cover",
    operation_id = "uploadActivityCover",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body(content = UploadCoverRequest, content_type = "multipart/form-data"),
    responses((status = 200, description = "封面已更新", body = ActivityEnvelope))
)]
pub(crate) async fn upload_cover(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    request: Request,
) -> Result<Json<ActivityEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let activity_id = parse_activity_id(&activity_id, request_id.clone())?;
    let mut multipart = Multipart::from_request(request, &state)
        .await
        .map_err(|_| ApiError::invalid_attachment(request_id.clone()))?;
    let mut file = None;
    let mut version = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| ApiError::invalid_attachment(request_id.clone()))?
    {
        match field.name() {
            Some("file") if file.is_none() => {
                let mime = field
                    .content_type()
                    .map(str::to_owned)
                    .ok_or_else(|| ApiError::invalid_attachment(request_id.clone()))?;
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| ApiError::invalid_attachment(request_id.clone()))?
                    .to_vec();
                file = Some((mime, bytes));
            }
            Some("version") if version.is_none() => {
                version = Some(
                    field
                        .text()
                        .await
                        .map_err(|_| ApiError::invalid_attachment(request_id.clone()))?,
                );
            }
            _ => return Err(ApiError::invalid_attachment(request_id)),
        }
    }
    let (declared_mime, bytes) =
        file.ok_or_else(|| ApiError::invalid_attachment(request_id.clone()))?;
    let version = version
        .as_deref()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| ApiError::invalid_activity(request_id.clone()))?;
    let processed = process_fixed_image(&bytes, &declared_mime, 1200, 900)
        .map_err(|error| map_cover_image_error(error, request_id.clone()))?;
    let image_id = uuid::Uuid::new_v4();
    let storage_key = format!("covers/{activity_id}/{image_id}.webp");
    let store = LocalAttachmentStore::new(&state.uploads_dir)
        .map_err(|_| ApiError::internal(request_id.clone()))?;
    store
        .write(&storage_key, &processed.bytes)
        .await
        .map_err(|_| ApiError::internal(request_id.clone()))?;
    let repository = PostgresActivityRepository::new(state.pool.clone());
    let result = repository
        .replace_cover_image(
            activity_id,
            actor.user_id,
            version,
            ActivityCoverImage {
                image_id,
                storage_key: storage_key.clone(),
                width: processed.width,
                height: processed.height,
                byte_size: i64::try_from(processed.bytes.len()).unwrap_or(i64::MAX),
            },
            OffsetDateTime::now_utc(),
        )
        .await;
    let (activity, old_storage_key) = match result {
        Ok(result) => result,
        Err(error) => {
            if store.remove(&storage_key).await.is_err() {
                tracing::warn!(storage_key = %storage_key, "删除未提交的活动封面失败，将由孤立图片清理任务回收");
            }
            return Err(map_update_error(
                map_repository_update_error(error),
                request_id,
            ));
        }
    };
    remove_old_cover(&state, old_storage_key).await;
    Ok(Json(ActivityEnvelope {
        data: activity_data(activity),
    }))
}

/// 按不可变 `image_id` 返回当前活动封面，授权通过后才读取私有存储。
#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/cover/{image_id}",
    operation_id = "downloadActivityCover",
    params(("activity_id" = String, Path), ("image_id" = String, Path)),
    responses(
        (status = 200, description = "私有 WebP 封面", body = CoverBinary,
            content_type = "image/webp",
            headers(
                ("Cache-Control" = String, description = "private immutable 缓存"),
                ("Content-Type" = String, description = "image/webp"),
                ("X-Content-Type-Options" = String, description = "nosniff")
            )),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 404, description = "封面不存在或不可访问", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn download_cover(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, image_id)): Path<(String, String)>,
    jar: CookieJar,
) -> Result<Response, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id = parse_activity_id(&activity_id, request_id.clone())?;
    let image_id =
        uuid::Uuid::parse_str(&image_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let repository = PostgresActivityRepository::new(state.pool.clone());
    let image = repository
        .cover_image_for_user(activity_id, actor.user_id, image_id)
        .await
        .map_err(|_| ApiError::not_found(request_id.clone()))?;
    let store = LocalAttachmentStore::new(&state.uploads_dir)
        .map_err(|_| ApiError::internal(request_id.clone()))?;
    let bytes = store
        .read(&image.storage_key)
        .await
        .map_err(|_| ApiError::not_found(request_id.clone()))?;
    let mut response = Body::from(bytes).into_response();
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("image/webp"));
    response.headers_mut().insert(
        CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=31536000, immutable"),
    );
    response.headers_mut().insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    Ok(response)
}

async fn remove_old_cover(state: &AppState, old_storage_key: Option<String>) {
    let Some(storage_key) = old_storage_key else {
        return;
    };
    match LocalAttachmentStore::new(&state.uploads_dir) {
        Ok(store) if store.remove(&storage_key).await.is_ok() => {}
        Ok(_) | Err(_) => {
            tracing::warn!(storage_key = %storage_key, "删除旧活动封面失败，将由孤立图片清理任务回收");
        }
    }
}

fn map_cover_image_error(error: AttachmentImageError, request_id: RequestId) -> ApiError {
    match error {
        AttachmentImageError::TooLarge => ApiError::attachment_too_large(request_id),
        AttachmentImageError::TypeNotAllowed => ApiError::attachment_type_not_allowed(request_id),
        AttachmentImageError::MimeMismatch => ApiError::attachment_mime_mismatch(request_id),
        AttachmentImageError::PixelLimitExceeded | AttachmentImageError::InvalidImage => {
            ApiError::attachment_image_invalid(request_id)
        }
    }
}

fn map_repository_update_error(
    error: crate::application::activity::ActivityRepositoryError,
) -> UpdateActivityError {
    match error {
        crate::application::activity::ActivityRepositoryError::NotFound => {
            UpdateActivityError::NotFound
        }
        crate::application::activity::ActivityRepositoryError::Forbidden => {
            UpdateActivityError::Forbidden
        }
        crate::application::activity::ActivityRepositoryError::VersionConflict => {
            UpdateActivityError::VersionConflict
        }
        crate::application::activity::ActivityRepositoryError::FieldLocked => {
            UpdateActivityError::FieldLocked
        }
        crate::application::activity::ActivityRepositoryError::BaseCurrencyLocked => {
            UpdateActivityError::BaseCurrencyLocked
        }
        crate::application::activity::ActivityRepositoryError::InvalidTransition => {
            UpdateActivityError::InvalidTransition
        }
        crate::application::activity::ActivityRepositoryError::InvalidAuditCursor => {
            UpdateActivityError::InvalidInput
        }
        crate::application::activity::ActivityRepositoryError::Unavailable => {
            UpdateActivityError::Unavailable
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/audit-logs",
    operation_id = "listActivityAuditLogs",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("cursor" = inline(Option<String>), Query, description = "同一活动内的下一页游标")
    ),
    responses(
        (status = 200, description = "活动记录", body = ActivityAuditListEnvelope),
        (status = 400, description = "活动记录分页游标无效", body = super::error::ErrorEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 404, description = "活动不存在", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn list_audit_logs(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    Query(query): Query<ActivityAuditQuery>,
) -> Result<Json<ActivityAuditListEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id = parse_activity_id(&activity_id, request_id.clone())?;
    let cursor = query
        .cursor
        .as_deref()
        .map(uuid::Uuid::parse_str)
        .transpose()
        .map_err(|_| ApiError::invalid_activity_audit_cursor(request_id.clone()))?;
    let page = list_activity_audit_logs(
        &PostgresActivityRepository::new(state.pool),
        activity_id,
        actor.user_id,
        cursor,
    )
    .await
    .map_err(|error| map_audit_read_error(error, request_id))?;
    Ok(Json(ActivityAuditListEnvelope {
        data: page.entries.into_iter().map(activity_audit_data).collect(),
        next_cursor: page.next_cursor.map(|value| value.to_string()),
    }))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/members",
    operation_id = "listActivityMembers",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses(
        (status = 200, description = "活动成员列表", body = ActivityMemberListEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 404, description = "活动不存在", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn list_members(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<Json<ActivityMemberListEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id =
        uuid::Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let repository = PostgresActivityRepository::new(state.pool);
    let members = list_activity_members(&repository, activity_id, actor.user_id)
        .await
        .map_err(|error| map_read_error(error, request_id))?;
    Ok(Json(ActivityMemberListEnvelope {
        data: members.into_iter().map(member_data).collect(),
    }))
}

pub(crate) fn activity_data(activity: ActivityView) -> ActivityData {
    let status = ActivityStatus::parse(&activity.status).expect("数据库约束保证活动状态有效");
    let capabilities = ActivityCapabilities::for_actor(
        activity.current_member_role == "OWNER",
        status,
        activity.has_accounting_records,
    );
    ActivityData {
        activity_id: activity.activity_id.to_string(),
        owner_member_id: activity.owner_member_id.to_string(),
        name: activity.name,
        location: activity.location,
        base_currency: activity.base_currency,
        start_date: activity.start_date.to_string(),
        end_date: activity.end_date.map(|value| value.to_string()),
        invite_mode: activity.invite_mode,
        status: activity.status,
        version: activity.version.to_string(),
        revision: activity.revision.to_string(),
        current_member_id: activity.current_member_id.to_string(),
        current_member_role: activity.current_member_role,
        has_accounting_records: activity.has_accounting_records,
        cover_preset: activity.cover_preset,
        cover_image_id: activity.cover_image_id.map(|value| value.to_string()),
        field_permissions: ActivityFieldPermissionsData {
            name: capabilities.fields.name,
            location: capabilities.fields.location,
            base_currency: capabilities.fields.base_currency,
            start_date: capabilities.fields.start_date,
            end_date: capabilities.fields.end_date,
            invite_mode: capabilities.fields.invite_mode,
            cover: capabilities.fields.cover,
        },
        allowed_lifecycle_actions: capabilities
            .lifecycle_actions
            .into_iter()
            .map(|action| action.as_str().to_owned())
            .collect(),
        can_delete: capabilities.can_delete,
    }
}

pub(crate) fn member_data(member: ActivityMemberView) -> ActivityMemberData {
    ActivityMemberData {
        member_id: member.member_id.to_string(),
        activity_id: member.activity_id.to_string(),
        user_id: member.user_id.map(|value| value.to_string()),
        display_name: member.display_name,
        avatar_preset: member.avatar_preset,
        avatar_image_id: member.avatar_image_id.map(|value| value.to_string()),
        role: member.role,
        status: member.status,
        version: member.version.to_string(),
    }
}

fn activity_audit_data(entry: ActivityAuditEntry) -> ActivityAuditData {
    ActivityAuditData {
        audit_id: entry.id.to_string(),
        action: entry.action,
        source: entry.source,
        actor_user_id: entry.actor_user_id.map(|value| value.to_string()),
        actor_member_id: entry.actor_member_id.map(|value| value.to_string()),
        actor_display_name: entry.actor_display_name,
        actor_avatar_preset: entry.actor_avatar_preset,
        actor_avatar_image_id: entry.actor_avatar_image_id.map(|value| value.to_string()),
        revision: entry.revision.to_string(),
        changes: entry
            .changes
            .into_iter()
            .map(|change| ActivityAuditChangeData {
                field: change.field,
                before_value: change.before_value,
                after_value: change.after_value,
            })
            .collect(),
        expense: entry.expense.map(|expense| ActivityAuditExpenseData {
            expense_id: expense.expense_id.to_string(),
            title: expense.title,
            category: expense.category,
            original_currency: expense.original_currency,
            original_amount_minor: expense.original_amount_minor.to_string(),
            occurred_at: format_time(expense.occurred_at),
        }),
        created_at: format_time(entry.created_at),
    }
}

fn map_read_error(error: ReadActivityError, request_id: RequestId) -> ApiError {
    match error {
        ReadActivityError::NotFound => ApiError::not_found(request_id),
        ReadActivityError::Unavailable => ApiError::internal(request_id),
    }
}

fn map_audit_read_error(error: ReadActivityAuditError, request_id: RequestId) -> ApiError {
    match error {
        ReadActivityAuditError::InvalidCursor => {
            ApiError::invalid_activity_audit_cursor(request_id)
        }
        ReadActivityAuditError::NotFound => ApiError::not_found(request_id),
        ReadActivityAuditError::Unavailable => ApiError::internal(request_id),
    }
}

fn map_update_error(error: UpdateActivityError, request_id: RequestId) -> ApiError {
    match error {
        UpdateActivityError::InvalidInput => ApiError::invalid_activity(request_id),
        UpdateActivityError::NotFound => ApiError::not_found(request_id),
        UpdateActivityError::Forbidden => ApiError::operation_forbidden(request_id),
        UpdateActivityError::VersionConflict => ApiError::activity_version_conflict(request_id),
        UpdateActivityError::FieldLocked => ApiError::activity_field_locked(request_id),
        UpdateActivityError::BaseCurrencyLocked => {
            ApiError::activity_base_currency_locked(request_id)
        }
        UpdateActivityError::InvalidTransition => ApiError::invalid_activity_transition(request_id),
        UpdateActivityError::Unavailable => ApiError::internal(request_id),
    }
}

fn map_ownership_error(error: UpdateActivityError, request_id: RequestId) -> ApiError {
    match error {
        UpdateActivityError::InvalidInput | UpdateActivityError::FieldLocked => {
            ApiError::invalid_ownership_target(request_id)
        }
        other => map_update_error(other, request_id),
    }
}

fn parse_activity_id(value: &str, request_id: RequestId) -> Result<uuid::Uuid, ApiError> {
    uuid::Uuid::parse_str(value).map_err(|_| ApiError::not_found(request_id))
}

// PATCH 字段必须区分“未提交”“显式清空”和“提交值”，因此保留两层 Option。
#[allow(clippy::option_option)]
fn deserialize_optional_field<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}
