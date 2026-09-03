use axum::{Extension, Json, extract::State, http::HeaderMap};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::{
        auth::{CurrentSessionError, current_session},
        system_admin::{
            RegistrationPolicy, SystemAdminError, get_registration_policy, list_users,
            reset_password, set_registration_policy, set_system_admin, set_user_disabled,
        },
    },
    infrastructure::{
        auth_repository::PostgresAuthRepository, clock::SystemClock,
        password::Argon2PasswordHasher, session::SessionToken,
        system_admin_repository::PostgresSystemAdminRepository,
    },
};

use super::{
    auth::validate_session_csrf,
    error::{ApiError, RequestId},
    rate_limit::RateLimitCategory,
    router::AppState,
};

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserData {
    pub id: String,
    pub username: String,
    pub display_name: String,
    pub disabled: bool,
    pub is_system_admin: bool,
}

#[derive(Serialize, ToSchema)]
pub struct AdminUserListEnvelope {
    pub data: Vec<AdminUserData>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserStatusRequest {
    pub disabled: bool,
}

#[derive(Deserialize, ToSchema)]
pub struct UserRoleRequest {
    pub granted: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminPasswordResetRequest {
    pub new_password: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdminMutationData {
    pub user_id: String,
    pub changed: bool,
}

#[derive(Serialize, ToSchema)]
pub struct AdminMutationEnvelope {
    pub data: AdminMutationData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationPolicyData {
    #[schema(value_type = RegistrationPolicyValue)]
    pub policy: String,
    pub version: i64,
}

#[derive(Serialize, ToSchema)]
pub struct RegistrationPolicyEnvelope {
    pub data: RegistrationPolicyData,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationPolicyRequest {
    #[schema(value_type = RegistrationPolicyValue)]
    pub policy: String,
    pub version: i64,
}

/// 注册策略在 HTTP contract 中的稳定枚举；handler 仍以字符串接收未知值并返回统一 422 envelope。
#[derive(Clone, Copy, Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RegistrationPolicyValue {
    InviteOnly,
    Open,
}

/// 所有管理 handler 都先验证 Session 与平台角色，再执行具体事务；Activity 角色不会被当作平台权限。
async fn require_admin(
    state: &AppState,
    jar: &CookieJar,
    headers: &HeaderMap,
    request_id: RequestId,
    csrf: bool,
) -> Result<Uuid, ApiError> {
    let token = if csrf {
        validate_session_csrf(state, jar, headers, request_id.clone())?
    } else {
        let raw = jar
            .get("huddletab_session")
            .map(axum_extra::extract::cookie::Cookie::value)
            .ok_or_else(|| ApiError::unauthenticated(request_id.clone()))?;
        SessionToken::parse(raw).map_err(|_| ApiError::unauthenticated(request_id.clone()))?
    };
    let auth = PostgresAuthRepository::new(state.pool.clone());
    let session =
        current_session(&auth, &SystemClock, &token)
            .await
            .map_err(|error| match error {
                CurrentSessionError::Unauthenticated => {
                    ApiError::unauthenticated(request_id.clone())
                }
                CurrentSessionError::Unavailable => ApiError::internal(request_id.clone()),
            })?;
    if !session.is_system_admin {
        return Err(ApiError::system_admin_required(request_id));
    }
    Ok(session.user_id)
}

fn map_error(error: SystemAdminError, request_id: RequestId) -> ApiError {
    match error {
        SystemAdminError::UserNotFound => ApiError::user_not_found(request_id),
        SystemAdminError::LastActiveAdmin => ApiError::last_active_admin(request_id),
        SystemAdminError::VersionConflict => ApiError::admin_version_conflict(request_id),
        SystemAdminError::InvalidPassword => ApiError::invalid_admin_input(request_id),
        SystemAdminError::Unavailable => ApiError::internal(request_id),
    }
}

fn parse_user_id(value: &str, request_id: RequestId) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| ApiError::user_not_found(request_id))
}

fn check_sensitive_limit(
    state: &AppState,
    actor: Uuid,
    request_id: RequestId,
) -> Result<(), ApiError> {
    state
        .rate_limiter
        .check(RateLimitCategory::SensitiveAuthenticated, actor.to_string())
        .map_err(|limited| ApiError::rate_limited(request_id, limited.retry_after()))
}

#[utoipa::path(
    get,
    path = "/api/admin/users",
    responses(
        (status = 200, description = "平台用户列表", body = AdminUserListEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "需要系统管理员", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn users(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<Json<AdminUserListEnvelope>, ApiError> {
    require_admin(&state, &jar, &headers, request_id.clone(), false).await?;
    let repository = PostgresSystemAdminRepository::new(state.pool);
    let rows = list_users(&repository)
        .await
        .map_err(|error| map_error(error, request_id.clone()))?;
    Ok(Json(AdminUserListEnvelope {
        data: rows
            .into_iter()
            .map(|user| AdminUserData {
                id: user.id.to_string(),
                username: user.username,
                display_name: user.display_name,
                disabled: user.disabled,
                is_system_admin: user.is_system_admin,
            })
            .collect(),
    }))
}

#[utoipa::path(
    patch,
    path = "/api/admin/users/{user_id}/status",
    params(("user_id" = String, Path, description = "用户 UUID")),
    request_body = UserStatusRequest,
    responses((status = 200, body = AdminMutationEnvelope), (status = 401, body = super::error::ErrorEnvelope), (status = 403, body = super::error::ErrorEnvelope), (status = 404, body = super::error::ErrorEnvelope), (status = 409, body = super::error::ErrorEnvelope), (status = 429, body = super::error::ErrorEnvelope))
)]
pub(crate) async fn update_status(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    axum::extract::Path(user_id): axum::extract::Path<String>,
    Json(request): Json<UserStatusRequest>,
) -> Result<Json<AdminMutationEnvelope>, ApiError> {
    let actor = require_admin(&state, &jar, &headers, request_id.clone(), true).await?;
    check_sensitive_limit(&state, actor, request_id.clone())?;
    let target = parse_user_id(&user_id, request_id.clone())?;
    let repository = PostgresSystemAdminRepository::new(state.pool);
    set_user_disabled(
        &repository,
        target,
        request.disabled,
        OffsetDateTime::now_utc(),
    )
    .await
    .map_err(|error| map_error(error, request_id.clone()))?;
    Ok(Json(AdminMutationEnvelope {
        data: AdminMutationData {
            user_id,
            changed: true,
        },
    }))
}

#[utoipa::path(
    patch,
    path = "/api/admin/users/{user_id}/system-admin",
    params(("user_id" = String, Path, description = "用户 UUID")),
    request_body = UserRoleRequest,
    responses((status = 200, body = AdminMutationEnvelope), (status = 401, body = super::error::ErrorEnvelope), (status = 403, body = super::error::ErrorEnvelope), (status = 404, body = super::error::ErrorEnvelope), (status = 409, body = super::error::ErrorEnvelope), (status = 429, body = super::error::ErrorEnvelope))
)]
pub(crate) async fn update_role(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    axum::extract::Path(user_id): axum::extract::Path<String>,
    Json(request): Json<UserRoleRequest>,
) -> Result<Json<AdminMutationEnvelope>, ApiError> {
    let actor = require_admin(&state, &jar, &headers, request_id.clone(), true).await?;
    check_sensitive_limit(&state, actor, request_id.clone())?;
    let target = parse_user_id(&user_id, request_id.clone())?;
    let repository = PostgresSystemAdminRepository::new(state.pool);
    set_system_admin(
        &repository,
        target,
        request.granted,
        actor,
        OffsetDateTime::now_utc(),
    )
    .await
    .map_err(|error| map_error(error, request_id.clone()))?;
    Ok(Json(AdminMutationEnvelope {
        data: AdminMutationData {
            user_id,
            changed: true,
        },
    }))
}

#[utoipa::path(
    put,
    path = "/api/admin/users/{user_id}/password",
    params(("user_id" = String, Path, description = "用户 UUID")),
    request_body = AdminPasswordResetRequest,
    responses((status = 200, body = AdminMutationEnvelope), (status = 401, body = super::error::ErrorEnvelope), (status = 403, body = super::error::ErrorEnvelope), (status = 404, body = super::error::ErrorEnvelope), (status = 422, body = super::error::ErrorEnvelope), (status = 429, body = super::error::ErrorEnvelope))
)]
pub(crate) async fn reset_user_password(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    axum::extract::Path(user_id): axum::extract::Path<String>,
    Json(request): Json<AdminPasswordResetRequest>,
) -> Result<Json<AdminMutationEnvelope>, ApiError> {
    let actor = require_admin(&state, &jar, &headers, request_id.clone(), true).await?;
    check_sensitive_limit(&state, actor, request_id.clone())?;
    let target = parse_user_id(&user_id, request_id.clone())?;
    let repository = PostgresSystemAdminRepository::new(state.pool);
    reset_password(
        &repository,
        &Argon2PasswordHasher,
        target,
        &request.new_password,
        OffsetDateTime::now_utc(),
    )
    .await
    .map_err(|error| map_error(error, request_id.clone()))?;
    Ok(Json(AdminMutationEnvelope {
        data: AdminMutationData {
            user_id,
            changed: true,
        },
    }))
}

#[utoipa::path(
    get,
    path = "/api/admin/registration-policy",
    responses((status = 200, body = RegistrationPolicyEnvelope), (status = 401, body = super::error::ErrorEnvelope), (status = 403, body = super::error::ErrorEnvelope))
)]
pub(crate) async fn registration_policy(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<Json<RegistrationPolicyEnvelope>, ApiError> {
    require_admin(&state, &jar, &headers, request_id.clone(), false).await?;
    let repository = PostgresSystemAdminRepository::new(state.pool);
    let view = get_registration_policy(&repository)
        .await
        .map_err(|error| map_error(error, request_id.clone()))?;
    Ok(Json(RegistrationPolicyEnvelope {
        data: RegistrationPolicyData {
            policy: view.policy.as_str().to_owned(),
            version: view.version,
        },
    }))
}

#[utoipa::path(
    put,
    path = "/api/admin/registration-policy",
    request_body = RegistrationPolicyRequest,
    responses((status = 200, body = RegistrationPolicyEnvelope), (status = 401, body = super::error::ErrorEnvelope), (status = 403, body = super::error::ErrorEnvelope), (status = 409, body = super::error::ErrorEnvelope), (status = 422, body = super::error::ErrorEnvelope), (status = 429, body = super::error::ErrorEnvelope))
)]
pub(crate) async fn update_registration_policy(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<RegistrationPolicyRequest>,
) -> Result<Json<RegistrationPolicyEnvelope>, ApiError> {
    let actor = require_admin(&state, &jar, &headers, request_id.clone(), true).await?;
    check_sensitive_limit(&state, actor, request_id.clone())?;
    let policy = match request.policy.as_str() {
        "OPEN" => RegistrationPolicy::Open,
        "INVITE_ONLY" => RegistrationPolicy::InviteOnly,
        _ => return Err(ApiError::invalid_admin_input(request_id)),
    };
    let repository = PostgresSystemAdminRepository::new(state.pool);
    let view = set_registration_policy(
        &repository,
        policy,
        request.version,
        actor,
        OffsetDateTime::now_utc(),
    )
    .await
    .map_err(|error| map_error(error, request_id.clone()))?;
    Ok(Json(RegistrationPolicyEnvelope {
        data: RegistrationPolicyData {
            policy: view.policy.as_str().to_owned(),
            version: view.version,
        },
    }))
}
