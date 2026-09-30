//! 请求级入口识别与地址限制。只信任连接信息和部署者显式授权的代理头，绝不从 Origin 推断入口。
use super::{
    admin::{check_sensitive_limit, require_admin},
    auth::validate_same_origin_headers,
    error::{ApiError, RequestId},
    router::AppState,
};
use crate::{
    application::access_addresses::{normalize_origin, normalize_origins},
    infrastructure::access_addresses::{self as repository, AccessAddresses},
};
use axum::{
    Extension, Json,
    extract::{Request, State},
    http::{HeaderMap, Uri},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// 同一请求的来源校验、Cookie 和 MCP 使用相同配置快照，避免一次请求内出现不同安全边界。
#[derive(Clone, Debug)]
pub(crate) struct RequestAccess {
    pub origin: String,
    pub settings: AccessAddresses,
}

impl RequestAccess {
    pub fn secure(&self) -> bool {
        self.origin.starts_with("https://")
    }
}

fn single_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a str>, ()> {
    let mut values = headers.get_all(name).iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    let value = value.to_str().map_err(|_| ())?;
    if values.next().is_some() || value.is_empty() || value.contains(',') || value.trim() != value {
        return Err(());
    }
    Ok(Some(value))
}

/// HTTP/2 可使用 URI authority；若同时有 Host，两者必须一致。代理头仅接受单跳覆盖值。
pub(crate) fn request_origin(
    headers: &HeaderMap,
    uri: &Uri,
    trust_proxy: bool,
) -> Result<String, ()> {
    let scheme = uri.scheme_str().unwrap_or("http");
    let host = single_header(headers, "host")?;
    let authority = uri.authority().map(axum::http::uri::Authority::as_str);
    let direct_host = host.or(authority).ok_or(())?;
    direct_host
        .parse::<axum::http::uri::Authority>()
        .map_err(|_| ())?;
    let direct = normalize_origin(&format!("{scheme}://{direct_host}")).map_err(|_| ())?;
    if let (Some(host), Some(authority)) = (host, authority) {
        let other = normalize_origin(&format!("{scheme}://{authority}")).map_err(|_| ())?;
        if normalize_origin(&format!("{scheme}://{host}")).map_err(|_| ())? != other {
            return Err(());
        }
    }
    if !trust_proxy {
        return Ok(direct);
    }
    let forwarded_host = single_header(headers, "x-forwarded-host")?.unwrap_or(direct_host);
    forwarded_host
        .parse::<axum::http::uri::Authority>()
        .map_err(|_| ())?;
    let forwarded_scheme = single_header(headers, "x-forwarded-proto")?.unwrap_or(scheme);
    if !matches!(forwarded_scheme, "http" | "https") {
        return Err(());
    }
    normalize_origin(&format!("{forwarded_scheme}://{forwarded_host}")).map_err(|_| ())
}

pub(crate) async fn enforce(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    if request.uri().path() == "/api/health" {
        return next.run(request).await;
    }
    let request_id = request
        .extensions()
        .get::<RequestId>()
        .expect("外层已分配请求 ID")
        .clone();
    let Ok(origin) = request_origin(request.headers(), request.uri(), state.trust_proxy) else {
        return ApiError::invalid_access_address(
            "无法识别访问地址，请检查 Host 与可信代理配置。",
            request_id,
        )
        .into_response();
    };
    // 提前拒绝明确的跨源请求；没有这些可选头时，业务写入仍必须通过绑定 Cookie 的 CSRF token。
    let mut source_headers = request.headers().clone();
    if request.method().is_safe() {
        source_headers.remove("sec-fetch-site");
    }
    if !validate_same_origin_headers(&source_headers, &origin) {
        return ApiError::forbidden(request_id).into_response();
    }
    let settings = match repository::load(&state.pool).await {
        Ok(settings) => settings,
        Err(error) => {
            tracing::error!(%error, "读取访问地址失败，已拒绝请求");
            return ApiError::internal(request_id).into_response();
        }
    };
    let is_mcp = request.uri().path() == "/mcp" || request.uri().path().starts_with("/mcp/");
    if settings
        .origins
        .as_ref()
        .is_some_and(|origins| !origins.contains(&origin))
        || (is_mcp && settings.origins.is_none())
    {
        return ApiError::access_address_forbidden(request_id).into_response();
    }
    request
        .extensions_mut()
        .insert(RequestAccess { origin, settings });
    next.run(request).await
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccessAddressesData {
    pub origins: Vec<String>,
    pub version: i64,
    pub current_origin: String,
}

#[derive(Serialize, ToSchema)]
pub struct AccessAddressesEnvelope {
    pub data: AccessAddressesData,
}

#[derive(Deserialize, ToSchema)]
pub struct AccessAddressesRequest {
    pub origins: Vec<String>,
    pub version: i64,
}

#[utoipa::path(get, path = "/api/admin/access-addresses", responses((status = 200, body = AccessAddressesEnvelope), (status = 401, body = super::error::ErrorEnvelope), (status = 403, body = super::error::ErrorEnvelope)))]
pub(crate) async fn get(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Extension(access): Extension<RequestAccess>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<Json<AccessAddressesEnvelope>, ApiError> {
    require_admin(&state, &jar, &headers, request_id, false).await?;
    Ok(Json(AccessAddressesEnvelope {
        data: AccessAddressesData {
            origins: access.settings.origins.unwrap_or_default(),
            version: access.settings.version,
            current_origin: access.origin,
        },
    }))
}

#[utoipa::path(put, path = "/api/admin/access-addresses", request_body = AccessAddressesRequest, responses((status = 200, body = AccessAddressesEnvelope), (status = 401, body = super::error::ErrorEnvelope), (status = 403, body = super::error::ErrorEnvelope), (status = 409, body = super::error::ErrorEnvelope), (status = 422, body = super::error::ErrorEnvelope), (status = 429, body = super::error::ErrorEnvelope)))]
pub(crate) async fn update(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Extension(access): Extension<RequestAccess>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(input): Json<AccessAddressesRequest>,
) -> Result<Json<AccessAddressesEnvelope>, ApiError> {
    let actor = require_admin(&state, &jar, &headers, request_id.clone(), true).await?;
    check_sensitive_limit(&state, actor, request_id.clone())?;
    let origins = normalize_origins(&input.origins)
        .map_err(|message| ApiError::invalid_access_address(message, request_id.clone()))?;
    if !origins.contains(&access.origin) {
        return Err(ApiError::invalid_access_address(
            "请保留当前访问地址；切换到新地址登录后，才能移除旧地址。",
            request_id,
        ));
    }
    let version = sqlx::query_scalar::<_, i64>("UPDATE system_settings SET access_origins = $1, version = version + 1, updated_at = NOW(), updated_by_user_id = $2 WHERE id = 'singleton' AND version = $3 RETURNING version")
        .bind(&origins).bind(actor).bind(input.version).fetch_optional(&state.pool).await
        .map_err(|error| { tracing::error!(%error, "保存访问地址失败"); ApiError::internal(request_id.clone()) })?
        .ok_or_else(|| ApiError::admin_version_conflict(request_id))?;
    Ok(Json(AccessAddressesEnvelope {
        data: AccessAddressesData {
            origins,
            version,
            current_origin: access.origin,
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[tokio::test]
    #[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
    async fn proxy_requests_use_external_origin_for_cookies_and_mcp() {
        use crate::infrastructure::{
            app_secret::AppSecret, database::connect_and_migrate, mcp_token::McpAccessToken,
        };
        use axum::{body::Body, http::StatusCode};
        use tower::ServiceExt as _;
        let base = std::env::var("TEST_DATABASE_URL").unwrap();
        let root = sqlx::PgPool::connect(&base).await.unwrap();
        let schema = format!("proxy_test_{}", uuid::Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE SCHEMA {schema}"))
            .execute(&root)
            .await
            .unwrap();
        let separator = if base.contains('?') { '&' } else { '?' };
        let pool = connect_and_migrate(&format!("{base}{separator}options[search_path]={schema}"))
            .await
            .unwrap();
        sqlx::query(
            "UPDATE system_settings SET access_origins = ARRAY['https://public.test:8443']",
        )
        .execute(&pool)
        .await
        .unwrap();
        let mut state = AppState::new(pool.clone(), AppSecret::from_bytes([43; 32]));
        state.trust_proxy = true;
        let trusted = super::super::router::router_with_state(None, state.clone());
        state.trust_proxy = false;
        let untrusted = super::super::router::router_with_state(None, state);
        let request = || {
            axum::http::Request::builder()
                .uri("/api/auth/csrf")
                .header("host", "internal:5660")
                .header("x-forwarded-host", "public.test:8443")
                .header("x-forwarded-proto", "https")
                .body(Body::empty())
                .unwrap()
        };
        let response = trusted.clone().oneshot(request()).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert!(
            response.headers()["set-cookie"]
                .to_str()
                .unwrap()
                .contains("Secure")
        );
        assert_eq!(
            untrusted.oneshot(request()).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        let mut duplicate = request();
        duplicate
            .headers_mut()
            .append("x-forwarded-host", "evil.test".parse().unwrap());
        assert_eq!(
            trusted.clone().oneshot(duplicate).await.unwrap().status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let mut cross = request();
        cross
            .headers_mut()
            .insert("origin", "https://evil.test".parse().unwrap());
        assert_eq!(
            trusted.clone().oneshot(cross).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );

        let user_id = uuid::Uuid::new_v4();
        let token = McpAccessToken::generate();
        sqlx::query("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ($1, 'proxy-user', 'unused', 'Proxy', NOW(), NOW())").bind(user_id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO mcp_access_tokens (id, user_id, name, token_prefix, token_hash, scope, created_at) VALUES ($1, $2, 'proxy', $3, $4, 'READ', NOW())")
            .bind(uuid::Uuid::new_v4()).bind(user_id).bind(token.display_prefix()).bind(token.sha256_hash().as_slice()).execute(&pool).await.unwrap();
        let request = axum::http::Request::builder().method("POST").uri("/mcp")
            .header("host", "internal:5660").header("x-forwarded-host", "public.test:8443")
            .header("x-forwarded-proto", "https").header("origin", "https://public.test:8443")
            .header("authorization", format!("Bearer {}", token.expose_once()))
            .header("content-type", "application/json").header("accept", "application/json, text/event-stream")
            .body(Body::from(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"proxy-test","version":"1"}}}"#)).unwrap();
        assert_eq!(
            trusted.oneshot(request).await.unwrap().status(),
            StatusCode::OK
        );
        pool.close().await;
        sqlx::query(&format!("DROP SCHEMA {schema} CASCADE"))
            .execute(&root)
            .await
            .unwrap();
        root.close().await;
    }

    #[test]
    fn request_origin_obeys_proxy_boundary_and_validates_authorities() {
        let uri: Uri = "/api/auth/csrf".parse().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("host", HeaderValue::from_static("[::1]:5660"));
        headers.insert(
            "x-forwarded-host",
            HeaderValue::from_static("Example.com:443"),
        );
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        assert_eq!(
            request_origin(&headers, &uri, false).unwrap(),
            "http://[::1]:5660"
        );
        assert_eq!(
            request_origin(&headers, &uri, true).unwrap(),
            "https://example.com"
        );
        headers.append("x-forwarded-proto", HeaderValue::from_static("http"));
        assert!(request_origin(&headers, &uri, true).is_err());
        assert!(request_origin(&headers, &uri, false).is_ok());
        headers.remove("x-forwarded-proto");
        headers.remove("x-forwarded-host");
        assert_eq!(
            request_origin(&headers, &uri, true).unwrap(),
            "http://[::1]:5660"
        );
        headers.append("host", HeaderValue::from_static("evil.test"));
        assert!(request_origin(&headers, &uri, false).is_err());
    }

    #[test]
    fn rejects_missing_host_invalid_proxy_and_conflicting_authority() {
        let uri: Uri = "/".parse().unwrap();
        let mut headers = HeaderMap::new();
        assert!(request_origin(&headers, &uri, false).is_err());
        headers.insert("host", HeaderValue::from_static("example.com"));
        assert!(request_origin(&headers, &"http://other.test/".parse().unwrap(), false).is_err());
        for value in ["https,http", "ftp", "", " https"] {
            headers.insert("x-forwarded-proto", HeaderValue::from_str(value).unwrap());
            assert!(request_origin(&headers, &uri, true).is_err());
        }
    }
}
