use axum::{
    Extension, Json,
    extract::State,
    http::{HeaderMap, StatusCode, header::ORIGIN},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use serde::{Deserialize, Serialize};
use time::Duration;
use utoipa::ToSchema;

use crate::{
    application::auth::{
        ChangePasswordError, ChangePasswordInput, CurrentSessionError, LoginError, LoginInput,
        RegisterError, RegisterInput, change_password as change_user_password, current_session,
        login as login_user, logout as logout_user, register as register_user,
    },
    infrastructure::{
        auth_repository::PostgresAuthRepository,
        clock::SystemClock,
        csrf::{CsrfContext, CsrfToken},
        invitation_token::SecureInvitationTokenCodec,
        password::Argon2PasswordHasher,
        registration_repository::PostgresRegistrationRepository,
        session::SessionToken,
    },
};

use super::{
    error::{ApiError, RequestId},
    rate_limit::{ClientIp, RateLimitCategory},
    router::AppState,
};

const PRE_AUTH_COOKIE: &str = "huddletab_pre_auth";
const SESSION_COOKIE: &str = "huddletab_session";
// 浏览器 Cookie 与服务端 absolute deadline 同为 90 天；idle 过期仍由每次 Session 校验独立执行。
const SESSION_COOKIE_MAX_AGE: Duration = Duration::days(90);

#[derive(Serialize, ToSchema)]
pub struct CsrfEnvelope {
    pub data: CsrfData,
}

#[derive(Serialize, ToSchema)]
pub struct CsrfData {
    pub token: String,
}

#[derive(Deserialize, ToSchema)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Serialize, ToSchema)]
pub struct LoginEnvelope {
    pub data: LoginData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LoginData {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub is_system_admin: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
    pub display_name: String,
    pub invitation_token: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct RegisterEnvelope {
    pub data: RegisterData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterData {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub is_system_admin: bool,
}

#[derive(Serialize, ToSchema)]
pub struct SessionEnvelope {
    pub data: SessionData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub is_system_admin: bool,
}

#[derive(Serialize, ToSchema)]
pub struct LogoutEnvelope {
    pub data: LogoutData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LogoutData {
    pub logged_out: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Serialize, ToSchema)]
pub struct ChangePasswordEnvelope {
    pub data: ChangePasswordData,
}

#[derive(Serialize, ToSchema)]
pub struct ChangePasswordData {
    pub changed: bool,
}

/// 为未登录请求创建短期 pre-auth context，并返回只与该 context 匹配的 CSRF token。
#[utoipa::path(
    get,
    path = "/api/auth/csrf",
    responses(
        (status = 200, description = "获取 CSRF token", body = CsrfEnvelope),
        (status = 500, description = "服务内部错误", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn csrf(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
) -> Result<(CookieJar, Json<CsrfEnvelope>), ApiError> {
    let mut jar = jar;
    if let Some(session_cookie) = jar.get(SESSION_COOKIE) {
        if let Ok(session) = SessionToken::parse(session_cookie.value()) {
            let repository = PostgresAuthRepository::new(state.pool.clone());
            match current_session(&repository, &SystemClock, &session).await {
                Ok(_) => {
                    let session_hash = session.sha256_hash();
                    let token =
                        CsrfToken::mint(&state.app_secret, CsrfContext::Session(&session_hash));
                    return Ok((
                        jar,
                        Json(CsrfEnvelope {
                            data: CsrfData {
                                token: token.expose_for_header().to_owned(),
                            },
                        }),
                    ));
                }
                Err(CurrentSessionError::Unauthenticated) => {}
                Err(CurrentSessionError::Unavailable) => {
                    return Err(ApiError::internal(request_id));
                }
            }
        }

        // 语法错误、已撤销或已过期的 Cookie 都必须先失效，否则浏览器会继续请求 Session-bound CSRF。
        let expired_session = Cookie::build((SESSION_COOKIE, ""))
            .path("/")
            .http_only(true)
            .same_site(SameSite::Lax)
            .secure(state.secure_cookies)
            .max_age(Duration::ZERO)
            .build();
        jar = jar.add(expired_session);
    }

    let context = SessionToken::generate();
    let token = CsrfToken::mint(
        &state.app_secret,
        CsrfContext::PreAuth(context.expose_for_cookie()),
    );
    let cookie = Cookie::build((PRE_AUTH_COOKIE, context.expose_for_cookie().to_owned()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(state.secure_cookies)
        .max_age(Duration::minutes(10))
        .build();
    Ok((
        jar.add(cookie),
        Json(CsrfEnvelope {
            data: CsrfData {
                token: token.expose_for_header().to_owned(),
            },
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/api/auth/login",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "登录成功", body = LoginEnvelope),
        (status = 401, description = "凭据错误", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 校验失败", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求频率过高", headers(("Retry-After" = u64, description = "等待秒数")), body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn login(
    State(state): State<AppState>,
    Extension(client_ip): Extension<ClientIp>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<LoginRequest>,
) -> Result<(CookieJar, Json<LoginEnvelope>), ApiError> {
    validate_pre_auth(&state, &jar, &headers, request_id.clone())?;
    state
        .rate_limiter
        .check(RateLimitCategory::Auth, client_ip.as_str())
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;
    let repository = PostgresAuthRepository::new(state.pool.clone());
    let result = login_user(
        &repository,
        &Argon2PasswordHasher,
        &SystemClock,
        LoginInput {
            username: request.username,
            password: request.password,
        },
    )
    .await
    .map_err(|error| match error {
        LoginError::InvalidCredentials => ApiError::unauthorized(request_id.clone()),
        LoginError::Unavailable => ApiError::internal(request_id.clone()),
    })?;

    let session_cookie = Cookie::build((
        SESSION_COOKIE,
        result.session_token.expose_for_cookie().to_owned(),
    ))
    .path("/")
    .http_only(true)
    .same_site(SameSite::Lax)
    .secure(state.secure_cookies)
    .max_age(SESSION_COOKIE_MAX_AGE)
    .build();
    let expired_pre_auth = Cookie::build((PRE_AUTH_COOKIE, ""))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(state.secure_cookies)
        .max_age(Duration::ZERO)
        .build();

    Ok((
        jar.add(session_cookie).add(expired_pre_auth),
        Json(LoginEnvelope {
            data: LoginData {
                user_id: result.user_id.to_string(),
                username: result.username,
                display_name: result.display_name,
                is_system_admin: result.is_system_admin,
            },
        }),
    ))
}

#[utoipa::path(
    post,
    path = "/api/auth/register",
    request_body = RegisterRequest,
    responses(
        (status = 201, description = "创建账号成功", body = RegisterEnvelope),
        (status = 400, description = "注册信息无效", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 校验失败或当前策略需要有效邀请", body = super::error::ErrorEnvelope),
        (status = 409, description = "用户名已存在", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求频率过高", headers(("Retry-After" = u64, description = "等待秒数")), body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn register(
    State(state): State<AppState>,
    Extension(client_ip): Extension<ClientIp>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<RegisterRequest>,
) -> Result<(StatusCode, CookieJar, Json<RegisterEnvelope>), ApiError> {
    validate_pre_auth(&state, &jar, &headers, request_id.clone())?;
    state
        .rate_limiter
        .check(RateLimitCategory::Auth, client_ip.as_str())
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;
    let repository = PostgresRegistrationRepository::new(state.pool);
    let result = register_user(
        &repository,
        &Argon2PasswordHasher,
        &SecureInvitationTokenCodec,
        &SystemClock,
        RegisterInput {
            username: request.username,
            password: request.password,
            display_name: request.display_name,
            invitation_token: request.invitation_token.unwrap_or_default(),
        },
    )
    .await
    .map_err(|error| match error {
        RegisterError::InvalidInput => ApiError::invalid_collaboration_input(request_id.clone()),
        RegisterError::InvalidInvitation => {
            ApiError::registration_invite_required(request_id.clone())
        }
        RegisterError::UsernameTaken => ApiError::username_taken(request_id.clone()),
        RegisterError::Unavailable => ApiError::internal(request_id.clone()),
    })?;
    let session_cookie = Cookie::build((
        SESSION_COOKIE,
        result.session_token.expose_for_cookie().to_owned(),
    ))
    .path("/")
    .http_only(true)
    .same_site(SameSite::Lax)
    .secure(state.secure_cookies)
    .max_age(SESSION_COOKIE_MAX_AGE)
    .build();
    let expired_pre_auth = Cookie::build((PRE_AUTH_COOKIE, ""))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(state.secure_cookies)
        .max_age(Duration::ZERO)
        .build();
    Ok((
        StatusCode::CREATED,
        jar.add(session_cookie).add(expired_pre_auth),
        Json(RegisterEnvelope {
            data: RegisterData {
                user_id: result.user_id.to_string(),
                username: result.username,
                display_name: result.display_name,
                is_system_admin: false,
            },
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/auth/session",
    responses(
        (status = 200, description = "当前 Session", body = SessionEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn session(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
) -> Result<Json<SessionEnvelope>, ApiError> {
    let token = jar
        .get(SESSION_COOKIE)
        .map(Cookie::value)
        .ok_or_else(|| ApiError::unauthenticated(request_id.clone()))?;
    let token =
        SessionToken::parse(token).map_err(|_| ApiError::unauthenticated(request_id.clone()))?;
    let repository = PostgresAuthRepository::new(state.pool);
    let current = current_session(&repository, &SystemClock, &token)
        .await
        .map_err(|error| match error {
            CurrentSessionError::Unauthenticated => ApiError::unauthenticated(request_id.clone()),
            CurrentSessionError::Unavailable => ApiError::internal(request_id.clone()),
        })?;
    Ok(Json(SessionEnvelope {
        data: SessionData {
            user_id: current.user_id.to_string(),
            username: current.username,
            display_name: current.display_name,
            is_system_admin: current.is_system_admin,
        },
    }))
}

#[utoipa::path(
    post,
    path = "/api/auth/logout",
    responses(
        (status = 200, description = "注销成功", body = LogoutEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 校验失败", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn logout(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<(CookieJar, Json<LogoutEnvelope>), ApiError> {
    let token = validate_session_csrf(&state, &jar, &headers, request_id.clone())?;
    let repository = PostgresAuthRepository::new(state.pool);
    logout_user(&repository, &SystemClock, &token)
        .await
        .map_err(|_| ApiError::internal(request_id))?;
    let expired_session = Cookie::build((SESSION_COOKIE, ""))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(state.secure_cookies)
        .max_age(Duration::ZERO)
        .build();
    Ok((
        jar.add(expired_session),
        Json(LogoutEnvelope {
            data: LogoutData { logged_out: true },
        }),
    ))
}

#[utoipa::path(
    put,
    path = "/api/me/password",
    request_body = ChangePasswordRequest,
    responses(
        (status = 200, description = "密码已修改", body = ChangePasswordEnvelope),
        (status = 400, description = "新密码无效", body = super::error::ErrorEnvelope),
        (status = 401, description = "未登录或当前密码错误", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 校验失败", body = super::error::ErrorEnvelope),
        (status = 429, description = "请求频率过高", headers(("Retry-After" = u64, description = "等待秒数")), body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn change_password(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<(CookieJar, Json<ChangePasswordEnvelope>), ApiError> {
    let current_token = validate_session_csrf(&state, &jar, &headers, request_id.clone())?;
    let repository = PostgresAuthRepository::new(state.pool);
    let current_session = current_session(&repository, &SystemClock, &current_token)
        .await
        .map_err(|error| match error {
            CurrentSessionError::Unauthenticated => ApiError::unauthenticated(request_id.clone()),
            CurrentSessionError::Unavailable => ApiError::internal(request_id.clone()),
        })?;
    state
        .rate_limiter
        .check(
            RateLimitCategory::SensitiveAuthenticated,
            current_session.user_id.to_string(),
        )
        .map_err(|limited| ApiError::rate_limited(request_id.clone(), limited.retry_after()))?;
    let result = change_user_password(
        &repository,
        &Argon2PasswordHasher,
        &SystemClock,
        &current_token,
        ChangePasswordInput {
            current_password: request.current_password,
            new_password: request.new_password,
        },
    )
    .await
    .map_err(|error| match error {
        ChangePasswordError::InvalidCurrentPassword => ApiError::unauthorized(request_id.clone()),
        ChangePasswordError::InvalidNewPassword => ApiError::invalid_password(request_id.clone()),
        ChangePasswordError::Unavailable => ApiError::internal(request_id.clone()),
    })?;
    let session_cookie = Cookie::build((
        SESSION_COOKIE,
        result.session_token.expose_for_cookie().to_owned(),
    ))
    .path("/")
    .http_only(true)
    .same_site(SameSite::Lax)
    .secure(state.secure_cookies)
    .max_age(SESSION_COOKIE_MAX_AGE)
    .build();
    Ok((
        jar.add(session_cookie),
        Json(ChangePasswordEnvelope {
            data: ChangePasswordData { changed: true },
        }),
    ))
}

pub(crate) fn validate_pre_auth(
    state: &AppState,
    jar: &CookieJar,
    headers: &HeaderMap,
    request_id: RequestId,
) -> Result<(), ApiError> {
    if !validate_same_origin_headers(headers, &state.base_origin) {
        return Err(ApiError::forbidden(request_id));
    }
    let context = jar
        .get(PRE_AUTH_COOKIE)
        .map(Cookie::value)
        .ok_or_else(|| ApiError::forbidden(request_id.clone()))?;
    SessionToken::parse(context).map_err(|_| ApiError::forbidden(request_id.clone()))?;
    let token = headers
        .get("x-csrf-token")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::forbidden(request_id.clone()))?;
    let token = CsrfToken::parse(token).map_err(|_| ApiError::forbidden(request_id.clone()))?;
    if !token.verify(&state.app_secret, CsrfContext::PreAuth(context)) {
        return Err(ApiError::forbidden(request_id));
    }
    Ok(())
}

pub(crate) fn validate_session_csrf(
    state: &AppState,
    jar: &CookieJar,
    headers: &HeaderMap,
    request_id: RequestId,
) -> Result<SessionToken, ApiError> {
    if !validate_same_origin_headers(headers, &state.base_origin) {
        return Err(ApiError::forbidden(request_id));
    }
    let session = jar
        .get(SESSION_COOKIE)
        .map(Cookie::value)
        .ok_or_else(|| ApiError::unauthenticated(request_id.clone()))?;
    let session =
        SessionToken::parse(session).map_err(|_| ApiError::unauthenticated(request_id.clone()))?;
    let csrf = headers
        .get("x-csrf-token")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::forbidden(request_id.clone()))?;
    let csrf = CsrfToken::parse(csrf).map_err(|_| ApiError::forbidden(request_id.clone()))?;
    if !csrf.verify(
        &state.app_secret,
        CsrfContext::Session(&session.sha256_hash()),
    ) {
        return Err(ApiError::forbidden(request_id));
    }
    Ok(session)
}

/// 浏览器并不保证为同源 `fetch` 发送 `Origin` 或 Fetch Metadata 头。
/// 这两个头如果存在必须严格匹配；缺失时仍必须通过绑定 Cookie 的 HMAC CSRF token，
/// 从而兼容真实浏览器，同时继续拒绝明确的跨站请求、非法值和重复值。
fn validate_same_origin_headers(headers: &HeaderMap, expected_origin: &str) -> bool {
    optional_single_header_matches(headers, ORIGIN, expected_origin)
        && optional_single_header_matches(headers, "sec-fetch-site", "same-origin")
}

fn optional_single_header_matches(
    headers: &HeaderMap,
    name: impl axum::http::header::AsHeaderName,
    expected: &str,
) -> bool {
    let mut values = headers.get_all(name).iter();
    let Some(value) = values.next() else {
        return true;
    };
    values.next().is_none() && value.to_str().ok() == Some(expected)
}

#[cfg(test)]
mod tests {
    use super::validate_same_origin_headers;
    use axum::http::{HeaderMap, HeaderValue, header::ORIGIN};

    #[test]
    fn allows_browser_requests_that_omit_optional_origin_headers() {
        assert!(validate_same_origin_headers(
            &HeaderMap::new(),
            "http://localhost:5660"
        ));
    }

    #[test]
    fn accepts_matching_optional_origin_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(ORIGIN, HeaderValue::from_static("http://localhost:5660"));
        headers.insert("sec-fetch-site", HeaderValue::from_static("same-origin"));
        assert!(validate_same_origin_headers(
            &headers,
            "http://localhost:5660"
        ));
    }

    #[test]
    fn rejects_mismatched_invalid_or_duplicate_origin_headers() {
        let mut mismatched = HeaderMap::new();
        mismatched.insert(ORIGIN, HeaderValue::from_static("https://attacker.invalid"));
        assert!(!validate_same_origin_headers(
            &mismatched,
            "http://localhost:5660"
        ));

        let mut invalid_fetch_site = HeaderMap::new();
        invalid_fetch_site.insert("sec-fetch-site", HeaderValue::from_static("cross-site"));
        assert!(!validate_same_origin_headers(
            &invalid_fetch_site,
            "http://localhost:5660"
        ));

        let mut duplicate = HeaderMap::new();
        duplicate.append(ORIGIN, HeaderValue::from_static("http://localhost:5660"));
        duplicate.append(ORIGIN, HeaderValue::from_static("http://localhost:5660"));
        assert!(!validate_same_origin_headers(
            &duplicate,
            "http://localhost:5660"
        ));

        let mut invalid = HeaderMap::new();
        invalid.insert(
            ORIGIN,
            HeaderValue::from_bytes(b"\xff").expect("HTTP 头可以保留非 UTF-8 字节"),
        );
        assert!(!validate_same_origin_headers(
            &invalid,
            "http://localhost:5660"
        ));
    }
}
