use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    application::{
        activity::{
            ActivityMemberView, ActivityView, CreateActivityError, CreateActivityInput,
            ReadActivityError, create_activity, get_activity, list_activities,
            list_activity_members,
        },
        auth::{CurrentSessionError, current_session},
    },
    infrastructure::{
        activity_repository::PostgresActivityRepository, auth_repository::PostgresAuthRepository,
        clock::SystemClock,
    },
};

use super::{
    auth::validate_session_csrf,
    collaboration::authenticate,
    error::{ApiError, RequestId},
    router::AppState,
};

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateActivityRequest {
    pub name: String,
    pub base_currency: String,
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
pub struct ActivityMemberListEnvelope {
    pub data: Vec<ActivityMemberData>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityData {
    pub activity_id: String,
    pub owner_member_id: String,
    pub name: String,
    pub base_currency: String,
    pub status: String,
    pub version: String,
    pub revision: String,
    pub current_member_id: String,
    pub current_member_role: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivityMemberData {
    pub member_id: String,
    pub activity_id: String,
    pub user_id: Option<String>,
    pub display_name: String,
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
            base_currency: request.base_currency,
            actor_user_id: actor.user_id,
            actor_display_name: actor.display_name,
        },
    )
    .await
    .map_err(|error| match error {
        CreateActivityError::InvalidName | CreateActivityError::InvalidCurrency => {
            ApiError::invalid_activity(request_id.clone())
        }
        CreateActivityError::Unavailable => ApiError::internal(request_id.clone()),
    })?;

    Ok((
        StatusCode::CREATED,
        Json(ActivityEnvelope {
            data: ActivityData {
                activity_id: activity.activity_id.to_string(),
                owner_member_id: activity.owner_member_id.to_string(),
                name: activity.name,
                base_currency: activity.base_currency,
                status: "ACTIVE".to_owned(),
                version: activity.version.to_string(),
                revision: activity.revision.to_string(),
                current_member_id: activity.owner_member_id.to_string(),
                current_member_role: "OWNER".to_owned(),
            },
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/activities",
    operation_id = "listActivities",
    responses(
        (status = 200, description = "当前用户可访问的活动", body = ActivityListEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
) -> Result<Json<ActivityListEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let repository = PostgresActivityRepository::new(state.pool);
    let activities = list_activities(&repository, actor.user_id)
        .await
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

fn activity_data(activity: ActivityView) -> ActivityData {
    ActivityData {
        activity_id: activity.activity_id.to_string(),
        owner_member_id: activity.owner_member_id.to_string(),
        name: activity.name,
        base_currency: activity.base_currency,
        status: activity.status,
        version: activity.version.to_string(),
        revision: activity.revision.to_string(),
        current_member_id: activity.current_member_id.to_string(),
        current_member_role: activity.current_member_role,
    }
}

fn member_data(member: ActivityMemberView) -> ActivityMemberData {
    ActivityMemberData {
        member_id: member.member_id.to_string(),
        activity_id: member.activity_id.to_string(),
        user_id: member.user_id.map(|value| value.to_string()),
        display_name: member.display_name,
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
