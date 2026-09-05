use axum::{
    Extension, Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

use crate::{
    application::{
        activity::{
            ActivityLifecycleInput, ActivityMemberView, ActivityVersionInput, ActivityView,
            CreateActivityError, CreateActivityInput, ReadActivityError,
            TransferActivityOwnershipInput, UpdateActivityError, UpdateActivityInput,
            create_activity, delete_activity, get_activity, list_activities, list_activity_members,
            list_deleted_activities, restore_activity, transfer_activity_ownership,
            transition_activity, update_activity,
        },
        auth::{CurrentSessionError, current_session},
    },
    domain::activity::{ActivityCapabilities, ActivityStatus},
    infrastructure::{
        activity_repository::PostgresActivityRepository, auth_repository::PostgresAuthRepository,
        clock::SystemClock,
    },
};

use super::{
    auth::validate_session_csrf,
    collaboration::authenticate,
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
    Deleted,
}

/// 活动列表视图筛选；未传值时默认读取当前活动。
#[derive(Deserialize)]
pub struct ActivityListQuery {
    pub view: Option<ActivityListView>,
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
    pub deleted_at: Option<String>,
    pub purge_after: Option<String>,
    pub has_accounting_records: bool,
    pub field_permissions: ActivityFieldPermissionsData,
    pub allowed_lifecycle_actions: Vec<String>,
    pub can_delete: bool,
    pub can_restore: bool,
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
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityMemberData {
    pub member_id: String,
    pub activity_id: String,
    pub user_id: Option<String>,
    pub display_name: String,
    pub avatar_preset: Option<i16>,
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
                deleted_at: None,
                purge_after: None,
                has_accounting_records: false,
                field_permissions: ActivityFieldPermissionsData {
                    name: true,
                    location: true,
                    base_currency: true,
                    start_date: true,
                    end_date: true,
                    invite_mode: true,
                },
                allowed_lifecycle_actions: vec!["END".to_owned()],
                can_delete: true,
                can_restore: false,
            },
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/activities",
    operation_id = "listActivities",
    params(("view" = inline(Option<ActivityListView>), Query, description = "活动视图：current 或 deleted")),
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
        ActivityListView::Deleted => {
            list_deleted_activities(&repository, &SystemClock, actor.user_id).await
        }
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
        (status = 200, description = "活动已进入恢复窗口", body = ActivityEnvelope),
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
) -> Result<Json<ActivityEnvelope>, ApiError> {
    let actor =
        super::collaboration::authenticate_mutation(&state, &jar, &headers, request_id.clone())
            .await?;
    let activity = delete_activity(
        &PostgresActivityRepository::new(state.pool),
        &SystemClock,
        ActivityVersionInput {
            activity_id: parse_activity_id(&activity_id, request_id.clone())?,
            actor_user_id: actor.user_id,
            version: request.version,
        },
    )
    .await
    .map_err(|error| map_update_error(error, request_id))?;
    Ok(Json(ActivityEnvelope {
        data: activity_data(activity),
    }))
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/restore",
    operation_id = "restoreActivity",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = ActivityVersionRequest,
    responses(
        (status = 200, description = "活动已恢复", body = ActivityEnvelope),
        (status = 409, description = "活动版本冲突或恢复窗口已过期", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn restore(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<ActivityVersionRequest>,
) -> Result<Json<ActivityEnvelope>, ApiError> {
    let actor =
        super::collaboration::authenticate_mutation(&state, &jar, &headers, request_id.clone())
            .await?;
    let activity = restore_activity(
        &PostgresActivityRepository::new(state.pool),
        &SystemClock,
        ActivityVersionInput {
            activity_id: parse_activity_id(&activity_id, request_id.clone())?,
            actor_user_id: actor.user_id,
            version: request.version,
        },
    )
    .await
    .map_err(|error| map_update_error(error, request_id))?;
    Ok(Json(ActivityEnvelope {
        data: activity_data(activity),
    }))
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
        activity.deleted_at.is_some(),
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
        deleted_at: activity.deleted_at.map(format_time),
        purge_after: activity.purge_after.map(format_time),
        has_accounting_records: activity.has_accounting_records,
        field_permissions: ActivityFieldPermissionsData {
            name: capabilities.fields.name,
            location: capabilities.fields.location,
            base_currency: capabilities.fields.base_currency,
            start_date: capabilities.fields.start_date,
            end_date: capabilities.fields.end_date,
            invite_mode: capabilities.fields.invite_mode,
        },
        allowed_lifecycle_actions: capabilities
            .lifecycle_actions
            .into_iter()
            .map(|action| action.as_str().to_owned())
            .collect(),
        can_delete: capabilities.can_delete,
        can_restore: capabilities.can_restore,
    }
}

fn format_time(value: time::OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .expect("数据库时间始终可格式化")
}

pub(crate) fn member_data(member: ActivityMemberView) -> ActivityMemberData {
    ActivityMemberData {
        member_id: member.member_id.to_string(),
        activity_id: member.activity_id.to_string(),
        user_id: member.user_id.map(|value| value.to_string()),
        display_name: member.display_name,
        avatar_preset: member.avatar_preset,
        role: member.role,
        status: member.status,
        version: member.version.to_string(),
    }
}

fn map_read_error(error: ReadActivityError, request_id: RequestId) -> ApiError {
    match error {
        ReadActivityError::NotFound => ApiError::not_found(request_id),
        ReadActivityError::Unavailable => ApiError::internal(request_id),
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
        UpdateActivityError::RestoreExpired => ApiError::restore_window_expired(request_id),
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
