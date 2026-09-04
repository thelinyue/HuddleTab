use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use axum_extra::extract::cookie::{Cookie, CookieJar};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::{
        auth::{CurrentSession, CurrentSessionError, current_session},
        collaboration::{
            CollaborationError, CreateGuestBindingInvitationInput, CreateInvitationInput,
            Invitation, JoinInput, JoinRequestView, create_guest as add_guest,
            create_guest_binding_invitation as issue_guest_binding_invitation,
            create_invitation as issue_invitation, decide_join_request as decide_request,
            get_join_request as load_join_request, join_invitation as accept_invitation,
            list_invitations as load_invitations, list_join_requests as load_join_requests,
            preview_invitation as load_invitation_preview, revoke_invitation as cancel_invitation,
        },
    },
    infrastructure::{
        auth_repository::PostgresAuthRepository, clock::SystemClock,
        collaboration_repository::PostgresCollaborationRepository,
        invitation_token::SecureInvitationTokenCodec, session::SessionToken,
    },
};

use super::{
    auth::validate_session_csrf,
    error::{ApiError, RequestId},
    rate_limit::{ClientIp, RateLimitCategory},
    router::AppState,
};

const SESSION_COOKIE: &str = "huddletab_session";

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateGuestRequest {
    pub display_name: String,
}

#[derive(Serialize, ToSchema)]
pub struct GuestEnvelope {
    pub data: GuestData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GuestData {
    pub member_id: String,
    pub activity_id: String,
    pub user_id: Option<String>,
    pub display_name: String,
    pub role: &'static str,
    pub status: &'static str,
    pub version: String,
    pub revision: String,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvitationRequest {
    pub kind: String,
    pub target_username: Option<String>,
    pub max_uses: Option<i32>,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateGuestBindingInvitationRequest {
    pub target_username: String,
}

#[derive(Serialize, ToSchema)]
pub struct CreatedInvitationEnvelope {
    pub data: CreatedInvitationData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedInvitationData {
    pub invitation_id: String,
    pub activity_id: String,
    pub kind: &'static str,
    pub purpose: &'static str,
    pub target_username: Option<String>,
    pub guest_member_id: Option<String>,
    pub token: String,
    pub expires_at: String,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub version: String,
    pub revision: String,
}

#[derive(Serialize, ToSchema)]
pub struct InvitationListEnvelope {
    pub data: Vec<InvitationData>,
}

#[derive(Serialize, ToSchema)]
pub struct InvitationEnvelope {
    pub data: InvitationData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InvitationData {
    pub invitation_id: String,
    pub activity_id: String,
    pub kind: &'static str,
    pub purpose: &'static str,
    pub target_username: Option<String>,
    pub guest_member_id: Option<String>,
    pub expires_at: String,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub revoked_at: Option<String>,
    pub version: String,
    pub revision: String,
}

#[derive(Serialize, ToSchema)]
pub struct InvitationPreviewEnvelope {
    pub data: InvitationPreviewData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InvitationPreviewData {
    pub activity_id: String,
    pub activity_name: String,
    pub active_member_count: i64,
    pub kind: &'static str,
    pub purpose: &'static str,
    pub guest_member_id: Option<String>,
    pub guest_display_name: Option<String>,
    pub expires_at: String,
}

#[derive(Serialize, ToSchema)]
pub struct JoinInvitationEnvelope {
    pub data: JoinInvitationData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinInvitationData {
    pub status: &'static str,
    pub activity_id: String,
    pub member_id: Option<String>,
    pub request_id: Option<String>,
    pub revision: String,
}

#[derive(Serialize, ToSchema)]
pub struct JoinRequestListEnvelope {
    pub data: Vec<JoinRequestData>,
}

#[derive(Serialize, ToSchema)]
pub struct JoinRequestEnvelope {
    pub data: JoinRequestData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinRequestData {
    pub request_id: String,
    pub activity_id: String,
    pub applicant_user_id: String,
    pub applicant_display_name: String,
    pub status: &'static str,
    pub decided_at: Option<String>,
    pub created_at: String,
    pub revision: String,
}

#[derive(Deserialize, ToSchema)]
pub struct DecideJoinRequestRequest {
    pub decision: String,
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/members/guests",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = CreateGuestRequest,
    responses(
        (status = 201, description = "Guest 已创建", body = GuestEnvelope),
        (status = 400, description = "成员信息无效", body = super::error::ErrorEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无权限", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn create_guest(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<CreateGuestRequest>,
) -> Result<(StatusCode, Json<GuestEnvelope>), ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let guest = add_guest(
        &repository,
        &SystemClock,
        activity_id,
        actor.user_id,
        request.display_name,
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok((
        StatusCode::CREATED,
        Json(GuestEnvelope {
            data: GuestData {
                member_id: guest.id.to_string(),
                activity_id: guest.activity_id.to_string(),
                user_id: None,
                display_name: guest.display_name,
                role: "MEMBER",
                status: "ACTIVE",
                version: guest.version.to_string(),
                revision: guest.revision.to_string(),
            },
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/members/{member_id}/binding-invitations",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("member_id" = String, Path, description = "Guest 成员 UUID"),
        ("x-csrf-token" = String, Header, description = "当前 Session 的 CSRF token")
    ),
    request_body = CreateGuestBindingInvitationRequest,
    responses(
        (status = 201, description = "Guest Binding 邀请已创建", body = CreatedInvitationEnvelope),
        (status = 400, description = "目标用户名无效", body = super::error::ErrorEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无权限", body = super::error::ErrorEnvelope),
        (status = 404, description = "Guest 不存在或已绑定", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求频率过高", headers(("Retry-After" = u64, description = "等待秒数")), body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn create_guest_binding_invitation(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, member_id)): Path<(String, String)>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<CreateGuestBindingInvitationRequest>,
) -> Result<(StatusCode, Json<CreatedInvitationEnvelope>), ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    state
        .rate_limiter
        .check(
            RateLimitCategory::SensitiveAuthenticated,
            actor.user_id.to_string(),
        )
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let guest_member_id = parse_uuid(&member_id, request_id.clone())?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let created = issue_guest_binding_invitation(
        &repository,
        &SecureInvitationTokenCodec,
        &SystemClock,
        CreateGuestBindingInvitationInput {
            activity_id,
            guest_member_id,
            actor_user_id: actor.user_id,
            target_username: request.target_username,
        },
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    let invitation = created.invitation;
    Ok((
        StatusCode::CREATED,
        Json(CreatedInvitationEnvelope {
            data: CreatedInvitationData {
                invitation_id: invitation.id.to_string(),
                activity_id: invitation.activity_id.to_string(),
                kind: invitation.kind.as_str(),
                purpose: invitation.purpose().as_str(),
                target_username: invitation.target_username,
                guest_member_id: invitation.guest_member_id.map(|value| value.to_string()),
                token: created.token.expose_once().to_owned(),
                expires_at: invitation.expires_at.to_string(),
                max_uses: invitation.max_uses,
                use_count: invitation.use_count,
                version: invitation.version.to_string(),
                revision: invitation.revision.to_string(),
            },
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/invitations",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    request_body = CreateInvitationRequest,
    responses(
        (status = 201, description = "邀请已创建", body = CreatedInvitationEnvelope),
        (status = 400, description = "邀请信息无效", body = super::error::ErrorEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无权限", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求频率过高", headers(("Retry-After" = u64, description = "等待秒数")), body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn create_invitation(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<CreateInvitationRequest>,
) -> Result<(StatusCode, Json<CreatedInvitationEnvelope>), ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    state
        .rate_limiter
        .check(
            RateLimitCategory::SensitiveAuthenticated,
            actor.user_id.to_string(),
        )
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let created = issue_invitation(
        &repository,
        &SecureInvitationTokenCodec,
        &SystemClock,
        CreateInvitationInput {
            activity_id,
            actor_user_id: actor.user_id,
            kind: request.kind,
            target_username: request.target_username,
            max_uses: request.max_uses,
        },
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    let invitation = created.invitation;
    Ok((
        StatusCode::CREATED,
        Json(CreatedInvitationEnvelope {
            data: CreatedInvitationData {
                invitation_id: invitation.id.to_string(),
                activity_id: invitation.activity_id.to_string(),
                kind: invitation.kind.as_str(),
                purpose: invitation.purpose().as_str(),
                target_username: invitation.target_username,
                guest_member_id: invitation.guest_member_id.map(|value| value.to_string()),
                token: created.token.expose_once().to_owned(),
                expires_at: invitation.expires_at.to_string(),
                max_uses: invitation.max_uses,
                use_count: invitation.use_count,
                version: invitation.version.to_string(),
                revision: invitation.revision.to_string(),
            },
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/invitations",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses(
        (status = 200, description = "邀请列表", body = InvitationListEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无权限", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn list_invitations(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<Json<InvitationListEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let invitations = load_invitations(&repository, activity_id, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(InvitationListEnvelope {
        data: invitations.into_iter().map(invitation_data).collect(),
    }))
}

#[utoipa::path(
    delete,
    path = "/api/activities/{activity_id}/invitations/{invitation_id}",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("invitation_id" = String, Path, description = "邀请 UUID")
    ),
    responses(
        (status = 200, description = "邀请已撤销", body = InvitationEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无权限", body = super::error::ErrorEnvelope),
        (status = 404, description = "邀请不存在", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求频率过高", headers(("Retry-After" = u64, description = "等待秒数")), body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn revoke_invitation(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, invitation_id)): Path<(String, String)>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<Json<InvitationEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    state
        .rate_limiter
        .check(
            RateLimitCategory::SensitiveAuthenticated,
            actor.user_id.to_string(),
        )
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let invitation_id = parse_uuid(&invitation_id, request_id.clone())?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let invitation = cancel_invitation(
        &repository,
        &SystemClock,
        activity_id,
        invitation_id,
        actor.user_id,
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok(Json(InvitationEnvelope {
        data: invitation_data(invitation),
    }))
}

#[utoipa::path(
    get,
    path = "/api/invitations/{token}",
    params(("token" = String, Path, description = "邀请明文 token")),
    responses(
        (status = 200, description = "邀请公开预览", body = InvitationPreviewEnvelope),
        (status = 404, description = "邀请无效", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求频率过高", headers(("Retry-After" = u64, description = "等待秒数")), body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn preview_invitation(
    State(state): State<AppState>,
    Extension(client_ip): Extension<ClientIp>,
    Extension(request_id): Extension<RequestId>,
    Path(token): Path<String>,
) -> Result<Json<InvitationPreviewEnvelope>, ApiError> {
    state
        .rate_limiter
        .check(RateLimitCategory::AnonymousInvite, client_ip.as_str())
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let preview = load_invitation_preview(
        &repository,
        &SecureInvitationTokenCodec,
        &SystemClock,
        &token,
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok(Json(InvitationPreviewEnvelope {
        data: InvitationPreviewData {
            activity_id: preview.activity_id.to_string(),
            activity_name: preview.activity_name,
            active_member_count: preview.active_member_count,
            kind: preview.kind.as_str(),
            purpose: if preview.guest_member_id.is_some() {
                "GUEST_BINDING"
            } else {
                "JOIN"
            },
            guest_member_id: preview.guest_member_id.map(|value| value.to_string()),
            guest_display_name: preview.guest_display_name,
            expires_at: preview.expires_at.to_string(),
        },
    }))
}

#[utoipa::path(
    post,
    path = "/api/invitations/{token}/join",
    params(("token" = String, Path, description = "邀请明文 token")),
    responses(
        (status = 200, description = "已加入活动", body = JoinInvitationEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 404, description = "邀请无效", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求频率过高", headers(("Retry-After" = u64, description = "等待秒数")), body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn join_invitation(
    State(state): State<AppState>,
    Extension(client_ip): Extension<ClientIp>,
    Extension(request_id): Extension<RequestId>,
    Path(token): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<Json<JoinInvitationEnvelope>, ApiError> {
    state
        .rate_limiter
        .check(RateLimitCategory::AnonymousInvite, client_ip.as_str())
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let joined = accept_invitation(
        &repository,
        &SecureInvitationTokenCodec,
        &SystemClock,
        JoinInput {
            raw_token: token,
            user_id: actor.user_id,
            username: actor.username,
            display_name: actor.display_name,
        },
    )
    .await
    .map_err(|error| map_error(error, request_id))?;
    Ok(Json(JoinInvitationEnvelope {
        data: JoinInvitationData {
            status: joined.status.as_str(),
            activity_id: joined.activity_id.to_string(),
            member_id: joined.member_id.map(|value| value.to_string()),
            request_id: joined.request_id.map(|value| value.to_string()),
            revision: joined.revision.to_string(),
        },
    }))
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/join-requests",
    params(("activity_id" = String, Path, description = "活动 UUID")),
    responses(
        (status = 200, description = "Owner 待审批队列", body = JoinRequestListEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无权限", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn list_join_requests(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
) -> Result<Json<JoinRequestListEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let requests = load_join_requests(&repository, activity_id, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(JoinRequestListEnvelope {
        data: requests.into_iter().map(join_request_data).collect(),
    }))
}

#[utoipa::path(
    get,
    path = "/api/join-requests/{join_request_id}",
    params(("join_request_id" = String, Path, description = "加入申请 UUID")),
    responses(
        (status = 200, description = "申请人自己的加入申请", body = JoinRequestEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 404, description = "申请不存在", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn get_join_request(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(join_request_id): Path<String>,
    jar: CookieJar,
) -> Result<Json<JoinRequestEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let join_request_id = parse_uuid(&join_request_id, request_id.clone())?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let request = load_join_request(&repository, join_request_id, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id))?;
    Ok(Json(JoinRequestEnvelope {
        data: join_request_data(request),
    }))
}

#[utoipa::path(
    post,
    path = "/api/activities/{activity_id}/join-requests/{join_request_id}",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("join_request_id" = String, Path, description = "加入申请 UUID"),
        ("x-csrf-token" = String, Header, description = "当前 Session 的 CSRF token")
    ),
    request_body = DecideJoinRequestRequest,
    responses(
        (status = 200, description = "审批结果", body = JoinRequestEnvelope),
        (status = 400, description = "决策值无效", body = super::error::ErrorEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "无权限或 CSRF 无效", body = super::error::ErrorEnvelope),
        (status = 404, description = "申请不存在", body = super::error::ErrorEnvelope),
        (status = 409, description = "申请已关闭或审批前置条件失效", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn decide_join_request(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path((activity_id, join_request_id)): Path<(String, String)>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<DecideJoinRequestRequest>,
) -> Result<Json<JoinRequestEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let activity_id = parse_uuid(&activity_id, request_id.clone())?;
    let join_request_id = parse_uuid(&join_request_id, request_id.clone())?;
    let repository = PostgresCollaborationRepository::new(state.pool);
    let decided = decide_request(
        &repository,
        &SystemClock,
        activity_id,
        join_request_id,
        actor.user_id,
        &request.decision,
    )
    .await
    .map_err(|error| map_decision_error(error, request_id))?;
    Ok(Json(JoinRequestEnvelope {
        data: join_request_data(decided),
    }))
}

pub(crate) async fn authenticate_mutation(
    state: &AppState,
    jar: &CookieJar,
    headers: &HeaderMap,
    request_id: RequestId,
) -> Result<CurrentSession, ApiError> {
    let token = validate_session_csrf(state, jar, headers, request_id.clone())?;
    load_current_session(state, &token, request_id).await
}

pub(crate) async fn authenticate(
    state: &AppState,
    jar: &CookieJar,
    request_id: RequestId,
) -> Result<CurrentSession, ApiError> {
    let token = jar
        .get(SESSION_COOKIE)
        .map(Cookie::value)
        .ok_or_else(|| ApiError::unauthenticated(request_id.clone()))?;
    let token =
        SessionToken::parse(token).map_err(|_| ApiError::unauthenticated(request_id.clone()))?;
    load_current_session(state, &token, request_id).await
}

async fn load_current_session(
    state: &AppState,
    token: &SessionToken,
    request_id: RequestId,
) -> Result<CurrentSession, ApiError> {
    let repository = PostgresAuthRepository::new(state.pool.clone());
    current_session(&repository, &SystemClock, token)
        .await
        .map_err(|error| match error {
            CurrentSessionError::Unauthenticated => ApiError::unauthenticated(request_id.clone()),
            CurrentSessionError::Unavailable => ApiError::internal(request_id),
        })
}

fn invitation_data(invitation: Invitation) -> InvitationData {
    InvitationData {
        invitation_id: invitation.id.to_string(),
        activity_id: invitation.activity_id.to_string(),
        kind: invitation.kind.as_str(),
        purpose: invitation.purpose().as_str(),
        target_username: invitation.target_username,
        guest_member_id: invitation.guest_member_id.map(|value| value.to_string()),
        expires_at: invitation.expires_at.to_string(),
        max_uses: invitation.max_uses,
        use_count: invitation.use_count,
        revoked_at: invitation.revoked_at.map(|value| value.to_string()),
        version: invitation.version.to_string(),
        revision: invitation.revision.to_string(),
    }
}

fn join_request_data(request: JoinRequestView) -> JoinRequestData {
    JoinRequestData {
        request_id: request.id.to_string(),
        activity_id: request.activity_id.to_string(),
        applicant_user_id: request.applicant_user_id.to_string(),
        applicant_display_name: request.applicant_display_name,
        status: request.status.as_str(),
        decided_at: request.decided_at.map(|value| value.to_string()),
        created_at: request.created_at.to_string(),
        revision: request.revision.to_string(),
    }
}

fn parse_uuid(value: &str, request_id: RequestId) -> Result<Uuid, ApiError> {
    Uuid::parse_str(value).map_err(|_| ApiError::not_found(request_id))
}

fn map_error(error: CollaborationError, request_id: RequestId) -> ApiError {
    match error {
        CollaborationError::InvalidInput => ApiError::invalid_collaboration_input(request_id),
        CollaborationError::InvalidInvitation => ApiError::invalid_invitation(request_id),
        CollaborationError::Forbidden => ApiError::operation_forbidden(request_id),
        CollaborationError::NotFound => ApiError::not_found(request_id),
        CollaborationError::GuestNotFound => ApiError::guest_not_found(request_id),
        CollaborationError::GuestBindingConflict => ApiError::guest_binding_conflict(request_id),
        CollaborationError::Conflict => ApiError::conflict(request_id),
        CollaborationError::JoinRequestClosed => ApiError::join_request_closed(request_id),
        CollaborationError::ActivityNotJoinable => ApiError::activity_not_joinable(request_id),
        CollaborationError::Unavailable => ApiError::internal(request_id),
    }
}

fn map_decision_error(error: CollaborationError, request_id: RequestId) -> ApiError {
    match error {
        CollaborationError::InvalidInvitation => {
            ApiError::join_request_invitation_invalid(request_id)
        }
        other => map_error(other, request_id),
    }
}
