use axum::{
    body::Body,
    http::{
        Request, StatusCode,
        header::{CONTENT_TYPE, COOKIE, ORIGIN, SET_COOKIE},
    },
};
use http_body_util::BodyExt as _;
use huddletab_server::{
    application::{
        bootstrap_user::{BootstrapUserInput, bootstrap_first_user},
        ports::PasswordHasher,
    },
    domain::identity::Password,
    http::router::{AppState, router_with_state},
    infrastructure::{
        app_secret::AppSecret,
        clock::SystemClock,
        csrf::{CsrfContext, CsrfToken},
        database::connect_and_migrate,
        password::Argon2PasswordHasher,
        session::SessionToken,
    },
};
use serde_json::Value;
use sqlx::{PgPool, postgres::PgPoolOptions};
use time::{Duration, OffsetDateTime};
use tokio::sync::Mutex;
use tower::ServiceExt as _;
use uuid::Uuid;

const TEST_DATABASE_URL_ENV: &str = "TEST_DATABASE_URL";
static DATABASE_TEST_LOCK: Mutex<()> = Mutex::const_new(());

async fn seed_authenticated_actor() -> (PgPool, axum::Router, SessionToken, CsrfToken, Uuid) {
    let database_url = std::env::var(TEST_DATABASE_URL_ENV).expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'alice', 'unused', 'Alice', $2, $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&pool)
    .await
    .expect("应插入测试用户");
    let session = SessionToken::generate();
    let session_hash = session.sha256_hash();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
         idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(session_hash.as_slice())
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(&pool)
    .await
    .expect("应插入测试 Session");
    let secret = AppSecret::from_bytes([9; 32]);
    let csrf = CsrfToken::mint(&secret, CsrfContext::Session(&session_hash));
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    (pool, app, session, csrf, user_id)
}

fn authenticated_request(
    session: &SessionToken,
    csrf: &CsrfToken,
    method: &str,
    uri: &str,
    body: &str,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .header(
            COOKIE,
            format!("huddletab_session={}", session.expose_for_cookie()),
        )
        .header(ORIGIN, "http://localhost:5660")
        .header("sec-fetch-site", "same-origin")
        .header("x-csrf-token", csrf.expose_for_header())
        .body(Body::from(body.to_owned()))
        .expect("请求应可构造")
}

async fn json_response(app: axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.oneshot(request).await.expect("router 应响应");
    let status = response.status();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let json = serde_json::from_slice(&body).expect("响应应为 JSON");
    (status, json)
}

async fn create_activity(app: axum::Router, session: &SessionToken, csrf: &CsrfToken) -> Value {
    let (status, json) = json_response(
        app,
        authenticated_request(
            session,
            csrf,
            "POST",
            "/api/activities",
            r#"{"name":"Tokyo Trip","location":"Tokyo","baseCurrency":"jpy","startDate":"2026-09-01","endDate":"2026-09-03"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["data"].clone()
}

async fn assert_password_rotation(pool: &PgPool, user_id: Uuid, rotated: &SessionToken) {
    let active_hashes = sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT token_hash FROM sessions WHERE user_id = $1 AND revoked_at IS NULL",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .expect("应读取活跃 Session");
    assert_eq!(active_hashes, vec![rotated.sha256_hash().to_vec()]);
    let revoked_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sessions WHERE user_id = $1 AND revoked_at IS NOT NULL",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .expect("应统计撤销 Session");
    assert_eq!(revoked_count, 2);
    let password_hash =
        sqlx::query_scalar::<_, String>("SELECT password_hash FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(pool)
            .await
            .expect("应读取新密码摘要");
    let verification = Argon2PasswordHasher
        .verify(
            &Password::parse("new password value").expect("新密码应合法"),
            &password_hash,
        )
        .expect("新密码摘要应可验证");
    assert!(verification.valid);
}

#[tokio::test]
async fn csrf_endpoint_sets_a_bound_pre_auth_cookie() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://unused:unused@127.0.0.1/unused")
        .expect("测试应创建 lazy pool");
    let app = router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([7; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/csrf")
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get(SET_COOKIE)
        .expect("应设置 pre-auth Cookie")
        .to_str()
        .expect("Cookie 应为 ASCII");
    assert!(cookie.starts_with("huddletab_pre_auth="));
    assert!(cookie.contains("HttpOnly"));
    assert!(cookie.contains("SameSite=Lax"));
    assert!(cookie.contains("Path=/"));

    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let json: Value = serde_json::from_slice(&body).expect("响应应为 JSON");
    let token = json["data"]["token"].as_str().expect("应返回 CSRF token");
    assert_eq!(token.split('.').count(), 2);
}

#[tokio::test]
async fn update_profile_requires_authentication_and_session_csrf_before_database_access() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://unused:unused@127.0.0.1/unused")
        .expect("测试应创建 lazy pool");
    let app = router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([7; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );

    let (status, body) = json_response(
        app.clone(),
        Request::builder()
            .method("PATCH")
            .uri("/api/me/profile")
            .header(CONTENT_TYPE, "application/json")
            .header(ORIGIN, "http://localhost:5660")
            .header("sec-fetch-site", "same-origin")
            .body(Body::from(r#"{"displayName":"新昵称"}"#))
            .expect("请求应可构造"),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"]["code"], "UNAUTHENTICATED");

    let session = SessionToken::generate();
    let (status, body) = json_response(
        app,
        Request::builder()
            .method("PATCH")
            .uri("/api/me/profile")
            .header(CONTENT_TYPE, "application/json")
            .header(
                COOKIE,
                format!("huddletab_session={}", session.expose_for_cookie()),
            )
            .header(ORIGIN, "http://localhost:5660")
            .header("sec-fetch-site", "same-origin")
            .body(Body::from(r#"{"displayName":"新昵称"}"#))
            .expect("请求应可构造"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"]["code"], "CSRF_INVALID");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn csrf_endpoint_binds_to_a_valid_database_session_cookie() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = std::env::var(TEST_DATABASE_URL_ENV).expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'alice', 'unused', 'Alice', $2, $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&pool)
    .await
    .expect("应插入测试用户");
    let secret = AppSecret::from_bytes([7; 32]);
    let token = SessionToken::generate();
    let token_hash = token.sha256_hash();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
         idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(token_hash.as_slice())
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(&pool)
    .await
    .expect("应插入测试 Session");
    let app = router_with_state(
        None,
        AppState::new(pool, secret.clone(), "http://localhost:5660".to_owned()),
    );

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/csrf")
                .header(
                    COOKIE,
                    format!("huddletab_session={}", token.expose_for_cookie()),
                )
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(
        response.headers().get(SET_COOKIE).is_none(),
        "已有 Session 时不应再创建 pre-auth Cookie",
    );
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let json: Value = serde_json::from_slice(&body).expect("响应应为 JSON");
    let csrf = CsrfToken::parse(json["data"]["token"].as_str().expect("应返回 CSRF token"))
        .expect("应返回规范 CSRF token");
    assert!(csrf.verify(&secret, CsrfContext::Session(&token_hash)));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 单一浏览器式流程必须连续验证旧 Cookie 失效、pre-auth 绑定和新 Session 签发，拆分会丢失真实回归链路。
#[allow(clippy::too_many_lines)]
async fn revoked_session_cookie_can_establish_pre_auth_and_log_in_again() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = std::env::var(TEST_DATABASE_URL_ENV).expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");
    let created = bootstrap_first_user(
        &pool,
        &Argon2PasswordHasher,
        &SystemClock,
        BootstrapUserInput {
            username: "alice".to_owned(),
            password: "correct horse battery staple".to_owned(),
            display_name: "Alice".to_owned(),
        },
    )
    .await
    .expect("应创建登录用户");
    let revoked_session = SessionToken::generate();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
         idle_expires_at, absolute_expires_at, revoked_at) \
         VALUES ($1, $2, $3, $4, $4, $5, $6, $4)",
    )
    .bind(Uuid::new_v4())
    .bind(created.id)
    .bind(revoked_session.sha256_hash().as_slice())
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(&pool)
    .await
    .expect("应插入已撤销 Session");
    let app = router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([7; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );

    let csrf_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/csrf")
                .header(
                    COOKIE,
                    format!("huddletab_session={}", revoked_session.expose_for_cookie()),
                )
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(csrf_response.status(), StatusCode::OK);
    let set_cookies = csrf_response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .map(|value| value.to_str().expect("Cookie 应为 ASCII"))
        .collect::<Vec<_>>();
    let expired_session = set_cookies
        .iter()
        .find(|cookie| cookie.starts_with("huddletab_session="))
        .expect("失效 Session Cookie 应被过期");
    assert!(expired_session.contains("Max-Age=0"));
    let pre_auth_cookie = set_cookies
        .iter()
        .find(|cookie| cookie.starts_with("huddletab_pre_auth="))
        .expect("应签发 pre-auth Cookie")
        .split(';')
        .next()
        .expect("应包含 Cookie pair")
        .to_owned();
    let csrf_body = csrf_response
        .into_body()
        .collect()
        .await
        .expect("应读取 CSRF 响应")
        .to_bytes();
    let csrf_json: Value = serde_json::from_slice(&csrf_body).expect("CSRF 响应应为 JSON");
    let csrf_token = csrf_json["data"]["token"]
        .as_str()
        .expect("应返回 pre-auth CSRF token");

    let login_response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(CONTENT_TYPE, "application/json")
                .header(COOKIE, pre_auth_cookie)
                .header(ORIGIN, "http://localhost:5660")
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", csrf_token)
                .body(Body::from(
                    r#"{"username":"alice","password":"correct horse battery staple"}"#,
                ))
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(login_response.status(), StatusCode::OK);
    assert!(
        login_response
            .headers()
            .get_all(SET_COOKIE)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .any(|cookie| cookie.starts_with("huddletab_session=")),
        "重新登录应签发新的 Session Cookie",
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn login_creates_a_hashed_database_session_and_cookie() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = std::env::var(TEST_DATABASE_URL_ENV).expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");
    bootstrap_first_user(
        &pool,
        &Argon2PasswordHasher,
        &SystemClock,
        BootstrapUserInput {
            username: "alice".to_owned(),
            password: "correct horse battery staple".to_owned(),
            display_name: "Alice".to_owned(),
        },
    )
    .await
    .expect("应创建登录用户");

    let app = router_with_state(
        None,
        AppState::new(
            pool.clone(),
            AppSecret::from_bytes([7; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );
    let csrf_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/csrf")
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");
    let pre_auth_cookie = csrf_response
        .headers()
        .get(SET_COOKIE)
        .expect("应设置 pre-auth Cookie")
        .to_str()
        .expect("Cookie 应为 ASCII")
        .split(';')
        .next()
        .expect("应包含 Cookie pair")
        .to_owned();
    let csrf_body = csrf_response
        .into_body()
        .collect()
        .await
        .expect("应读取 CSRF 响应")
        .to_bytes();
    let csrf_json: Value = serde_json::from_slice(&csrf_body).expect("CSRF 响应应为 JSON");
    let csrf_token = csrf_json["data"]["token"]
        .as_str()
        .expect("应返回 CSRF token");

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(CONTENT_TYPE, "application/json")
                .header(COOKIE, pre_auth_cookie)
                .header(ORIGIN, "http://localhost:5660")
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", csrf_token)
                .body(Body::from(
                    r#"{"username":"alice","password":"correct horse battery staple"}"#,
                ))
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(response.status(), StatusCode::OK);
    let session_cookie = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.starts_with("huddletab_session="))
        .expect("登录应设置 Session Cookie");
    assert!(session_cookie.contains("HttpOnly"));
    assert!(session_cookie.contains("SameSite=Lax"));
    assert!(session_cookie.contains("Max-Age=7776000"));
    let encoded_token = session_cookie
        .split(';')
        .next()
        .expect("应包含 Cookie pair")
        .strip_prefix("huddletab_session=")
        .expect("应包含 Session Cookie 名");
    let token = SessionToken::parse(encoded_token).expect("Cookie 应包含规范 Session token");
    let stored_hash = sqlx::query_scalar::<_, Vec<u8>>("SELECT token_hash FROM sessions")
        .fetch_one(&pool)
        .await
        .expect("Session hash 应持久化");
    assert_eq!(stored_hash, token.sha256_hash());
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn session_endpoint_authenticates_the_cookie_hash() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = std::env::var(TEST_DATABASE_URL_ENV).expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'alice', 'unused', 'Alice', $2, $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&pool)
    .await
    .expect("应插入测试用户");
    let token = SessionToken::generate();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
         idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(token.sha256_hash().as_slice())
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(&pool)
    .await
    .expect("应插入测试 Session");

    let app = router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([7; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/auth/session")
                .header(
                    COOKIE,
                    format!("huddletab_session={}", token.expose_for_cookie()),
                )
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(response.status(), StatusCode::OK);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let json: Value = serde_json::from_slice(&body).expect("响应应为 JSON");
    assert_eq!(json["data"]["userId"], user_id.to_string());
    assert_eq!(json["data"]["username"], "alice");
    assert_eq!(json["data"]["displayName"], "Alice");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn logout_revokes_the_session_and_expires_its_cookie() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = std::env::var(TEST_DATABASE_URL_ENV).expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");
    let user_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'alice', 'unused', 'Alice', $2, $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&pool)
    .await
    .expect("应插入测试用户");
    let session_token = SessionToken::generate();
    let session_hash = session_token.sha256_hash();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
         idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
    )
    .bind(session_id)
    .bind(user_id)
    .bind(session_hash.as_slice())
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(&pool)
    .await
    .expect("应插入测试 Session");
    let secret = AppSecret::from_bytes([7; 32]);
    let csrf = CsrfToken::mint(&secret, CsrfContext::Session(&session_hash));
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/logout")
                .header(
                    COOKIE,
                    format!("huddletab_session={}", session_token.expose_for_cookie()),
                )
                .header(ORIGIN, "http://localhost:5660")
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", csrf.expose_for_header())
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.starts_with("huddletab_session="))
        .expect("注销应过期 Session Cookie");
    assert!(cookie.contains("Max-Age=0"));
    let revoked =
        sqlx::query_scalar::<_, bool>("SELECT revoked_at IS NOT NULL FROM sessions WHERE id = $1")
            .bind(session_id)
            .fetch_one(&pool)
            .await
            .expect("应读取 Session 撤销状态");
    assert!(revoked);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn password_change_rotates_current_and_revokes_other_sessions() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let database_url = std::env::var(TEST_DATABASE_URL_ENV).expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试用户");
    let created = bootstrap_first_user(
        &pool,
        &Argon2PasswordHasher,
        &SystemClock,
        BootstrapUserInput {
            username: "alice".to_owned(),
            password: "old password value".to_owned(),
            display_name: "Alice".to_owned(),
        },
    )
    .await
    .expect("应创建测试用户");
    let now = OffsetDateTime::now_utc();
    let current_token = SessionToken::generate();
    let current_hash = current_token.sha256_hash();
    for token_hash in [current_hash, SessionToken::generate().sha256_hash()] {
        sqlx::query(
            "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
             idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
        )
        .bind(Uuid::new_v4())
        .bind(created.id)
        .bind(token_hash.as_slice())
        .bind(now)
        .bind(now + Duration::days(30))
        .bind(now + Duration::days(90))
        .execute(&pool)
        .await
        .expect("应插入测试 Session");
    }
    let secret = AppSecret::from_bytes([7; 32]);
    let csrf = CsrfToken::mint(&secret, CsrfContext::Session(&current_hash));
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/me/password")
                .header(CONTENT_TYPE, "application/json")
                .header(
                    COOKIE,
                    format!("huddletab_session={}", current_token.expose_for_cookie()),
                )
                .header(ORIGIN, "http://localhost:5660")
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", csrf.expose_for_header())
                .body(Body::from(
                    r#"{"currentPassword":"old password value","newPassword":"new password value"}"#,
                ))
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.starts_with("huddletab_session="))
        .expect("改密应轮换 Session Cookie");
    assert!(cookie.contains("Max-Age=7776000"));
    let rotated = SessionToken::parse(
        cookie
            .split(';')
            .next()
            .expect("应包含 Cookie pair")
            .strip_prefix("huddletab_session=")
            .expect("应包含 Session Cookie 名"),
    )
    .expect("应返回规范 Session token");
    assert_ne!(
        rotated.expose_for_cookie(),
        current_token.expose_for_cookie()
    );

    assert_password_rotation(&pool, created.id, &rotated).await;
}

#[tokio::test]
async fn login_without_csrf_is_rejected_before_reading_credentials() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://unused:unused@127.0.0.1/unused")
        .expect("测试应创建 lazy pool");
    let app = router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([7; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/login")
                .header(CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"username":"alice","password":"valid password"}"#,
                ))
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let json: Value = serde_json::from_slice(&body).expect("响应应为 JSON");
    assert_eq!(json["error"]["code"], "CSRF_INVALID");
}

#[tokio::test]
async fn auth_requests_return_a_standard_429_after_the_shared_ip_limit() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://unused:unused@127.0.0.1/unused")
        .expect("测试应创建 lazy pool");
    let app = router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([7; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );
    let csrf_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/csrf")
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");
    let pre_auth_cookie = csrf_response
        .headers()
        .get(SET_COOKIE)
        .expect("应设置 pre-auth Cookie")
        .to_str()
        .expect("Cookie 应为 ASCII")
        .split(';')
        .next()
        .expect("应包含 Cookie pair")
        .to_owned();
    let csrf_body = csrf_response
        .into_body()
        .collect()
        .await
        .expect("应读取 CSRF 响应")
        .to_bytes();
    let csrf_json: Value = serde_json::from_slice(&csrf_body).expect("CSRF 响应应为 JSON");
    let csrf_token = csrf_json["data"]["token"]
        .as_str()
        .expect("应返回 CSRF token")
        .to_owned();

    let mut last_response = None;
    for request_index in 0..11 {
        let (uri, body) = if request_index < 9 {
            (
                "/api/auth/login",
                r#"{"username":"alice","password":"valid password"}"#,
            )
        } else {
            (
                "/api/auth/register",
                r#"{"username":"bob","password":"valid password","displayName":"Bob","invitationToken":"unused"}"#,
            )
        };
        last_response = Some(
            app.clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(uri)
                        .header(CONTENT_TYPE, "application/json")
                        .header(COOKIE, &pre_auth_cookie)
                        .header(ORIGIN, "http://localhost:5660")
                        .header("sec-fetch-site", "same-origin")
                        .header("x-csrf-token", &csrf_token)
                        .body(Body::from(body))
                        .expect("请求应可构造"),
                )
                .await
                .expect("router 应响应"),
        );
    }

    let response = last_response.expect("应发送第 11 个请求");
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        response.headers().get("retry-after"),
        Some(&"60".parse().unwrap())
    );
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let json: Value = serde_json::from_slice(&body).expect("响应应为 JSON");
    assert_eq!(json["error"]["code"], "RATE_LIMITED");
    assert_eq!(json["error"]["message"], "请求过于频繁，请稍后再试。");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 连续场景验证昵称接口的 CSRF 边界，以及用户、多个活动成员和 revision 的同事务收敛。
#[allow(clippy::too_many_lines)]
async fn update_profile_syncs_bound_members_and_advances_each_activity_once() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let (pool, app, session, csrf, user_id) = seed_authenticated_actor().await;
    let first_activity = create_activity(app.clone(), &session, &csrf).await;
    let second_activity = create_activity(app.clone(), &session, &csrf).await;
    let first_activity_id = Uuid::parse_str(
        first_activity["activityId"]
            .as_str()
            .expect("应返回第一个活动 ID"),
    )
    .expect("活动 ID 应为 UUID");
    let second_activity_id = Uuid::parse_str(
        second_activity["activityId"]
            .as_str()
            .expect("应返回第二个活动 ID"),
    )
    .expect("活动 ID 应为 UUID");
    let guest_member_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, display_name, role, joined_at) \
         VALUES ($1, $2, '临时成员', 'MEMBER', NOW())",
    )
    .bind(guest_member_id)
    .bind(first_activity_id)
    .execute(&pool)
    .await
    .expect("应插入临时成员");

    let missing_csrf_request = Request::builder()
        .method("PATCH")
        .uri("/api/me/profile")
        .header(CONTENT_TYPE, "application/json")
        .header(
            COOKIE,
            format!("huddletab_session={}", session.expose_for_cookie()),
        )
        .header(ORIGIN, "http://localhost:5660")
        .header("sec-fetch-site", "same-origin")
        .body(Body::from(r#"{"displayName":"新昵称"}"#))
        .expect("请求应可构造");
    let missing_csrf_response = app
        .clone()
        .oneshot(missing_csrf_request)
        .await
        .expect("router 应响应");
    assert_eq!(missing_csrf_response.status(), StatusCode::FORBIDDEN);

    let overlong_body = format!(r#"{{"displayName":"{}"}}"#, "a".repeat(81));
    let (status, body) = json_response(
        app.clone(),
        authenticated_request(&session, &csrf, "PATCH", "/api/me/profile", &overlong_body),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"]["code"], "INVALID_PROFILE_INPUT");

    sqlx::query(
        "UPDATE activity_members SET version = 9223372036854775807 \
         WHERE activity_id = $1 AND user_id = $2",
    )
    .bind(first_activity_id)
    .bind(user_id)
    .execute(&pool)
    .await
    .expect("应准备成员版本溢出的回滚场景");
    let (status, body) = json_response(
        app.clone(),
        authenticated_request(
            &session,
            &csrf,
            "PATCH",
            "/api/me/profile",
            r#"{"displayName":"回滚昵称"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["error"]["code"], "INTERNAL_ERROR");
    let display_name =
        sqlx::query_scalar::<_, String>("SELECT display_name FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("应读取回滚后的用户昵称");
    assert_eq!(display_name, "Alice");
    let unchanged_members = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM activity_members WHERE user_id = $1 AND display_name = 'Alice'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("应读取回滚后的成员昵称");
    assert_eq!(unchanged_members, 2);
    for activity_id in [first_activity_id, second_activity_id] {
        let revision =
            sqlx::query_scalar::<_, i64>("SELECT revision FROM activities WHERE id = $1")
                .bind(activity_id)
                .fetch_one(&pool)
                .await
                .expect("应读取回滚后的活动 revision");
        assert_eq!(revision, 1);
    }
    sqlx::query("UPDATE activity_members SET version = 1 WHERE activity_id = $1 AND user_id = $2")
        .bind(first_activity_id)
        .bind(user_id)
        .execute(&pool)
        .await
        .expect("应恢复成员版本以继续验证成功路径");

    let (status, body) = json_response(
        app,
        authenticated_request(
            &session,
            &csrf,
            "PATCH",
            "/api/me/profile",
            r#"{"displayName":"  新昵称  "}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["displayName"], "新昵称");

    let user_state =
        sqlx::query_as::<_, (String, i64)>("SELECT display_name, version FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .expect("应读取用户昵称");
    assert_eq!(user_state, ("新昵称".to_owned(), 2));

    let bound_state = sqlx::query_as::<_, (i64, i64)>(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE version = 2) \
         FROM activity_members WHERE user_id = $1 AND display_name = '新昵称'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await
    .expect("应读取绑定成员");
    assert_eq!(bound_state, (2, 2));

    let guest_state = sqlx::query_as::<_, (String, i64)>(
        "SELECT display_name, version FROM activity_members WHERE id = $1",
    )
    .bind(guest_member_id)
    .fetch_one(&pool)
    .await
    .expect("应读取临时成员");
    assert_eq!(guest_state, ("临时成员".to_owned(), 1));

    for activity_id in [first_activity_id, second_activity_id] {
        let revision =
            sqlx::query_scalar::<_, i64>("SELECT revision FROM activities WHERE id = $1")
                .bind(activity_id)
                .fetch_one(&pool)
                .await
                .expect("应读取活动 revision");
        assert_eq!(revision, 2);
    }
}
