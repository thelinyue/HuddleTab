use axum::{
    Router,
    body::Body,
    extract::ConnectInfo,
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
use serde_json::{Map, Value};
use sqlx::PgPool;
use std::net::SocketAddr;
use time::{Duration, OffsetDateTime};
use tokio::sync::Mutex;
use tower::ServiceExt as _;
use uuid::Uuid;

const TEST_DATABASE_URL_ENV: &str = "TEST_DATABASE_URL";
const BASE_ORIGIN: &str = "http://localhost:5660";
static DATABASE_TEST_LOCK: Mutex<()> = Mutex::const_new(());

struct AuthContext {
    cookie: String,
    csrf: String,
}

async fn test_pool() -> PgPool {
    let database_url = std::env::var(TEST_DATABASE_URL_ENV).expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空可丢弃测试库中的用户");
    pool
}

async fn bootstrap_user(pool: &PgPool) -> Uuid {
    bootstrap_first_user(
        pool,
        &Argon2PasswordHasher,
        &SystemClock,
        BootstrapUserInput {
            username: "alice".to_owned(),
            password: "correct horse battery staple".to_owned(),
        },
    )
    .await
    .expect("应创建测试首位用户")
    .id
}

async fn insert_user(pool: &PgPool, username: &str, password: &str) -> Uuid {
    let user_id = Uuid::new_v4();
    let password = Password::parse(password).expect("测试密码应合法");
    let password_hash = Argon2PasswordHasher
        .hash(&password)
        .expect("应散列测试密码");
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $5)",
    )
    .bind(user_id)
    .bind(username)
    .bind(password_hash)
    .bind(username)
    .bind(now)
    .execute(pool)
    .await
    .expect("应插入第二个测试用户");
    user_id
}

async fn session_context(pool: &PgPool, secret: &AppSecret, user_id: Uuid) -> AuthContext {
    let token = SessionToken::generate();
    let token_hash = token.sha256_hash();
    let now = OffsetDateTime::now_utc();
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
    .execute(pool)
    .await
    .expect("应插入测试 Session");
    let csrf = CsrfToken::mint(secret, CsrfContext::Session(&token_hash));

    AuthContext {
        cookie: format!("huddletab_session={}", token.expose_for_cookie()),
        csrf: csrf.expose_for_header().to_owned(),
    }
}

fn app(pool: PgPool, secret: AppSecret) -> Router {
    router_with_state(None, AppState::new(pool, secret, BASE_ORIGIN.to_owned()))
}

fn mutation_request(method: &str, uri: &str, body: Body, context: &AuthContext) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .header(COOKIE, &context.cookie)
        .header(ORIGIN, BASE_ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("x-csrf-token", &context.csrf)
        .body(body)
        .expect("请求应可构造")
}

fn with_peer_ip(mut request: Request<Body>, value: &str) -> Request<Body> {
    let address = value.parse::<SocketAddr>().expect("测试对端地址应合法");
    request.extensions_mut().insert(ConnectInfo(address));
    request
}

async fn response_json(response: axum::response::Response) -> Value {
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取 JSON 响应")
        .to_bytes();
    serde_json::from_slice(&body).expect("响应应为 JSON")
}

async fn pre_auth_context(app: &Router) -> AuthContext {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/csrf")
                .body(Body::empty())
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");
    let cookie = response
        .headers()
        .get(SET_COOKIE)
        .expect("应设置 pre-auth Cookie")
        .to_str()
        .expect("Cookie 应为 ASCII")
        .split(';')
        .next()
        .expect("应包含 Cookie pair")
        .to_owned();
    let json = response_json(response).await;
    AuthContext {
        cookie,
        csrf: json["data"]["token"]
            .as_str()
            .expect("应返回 CSRF token")
            .to_owned(),
    }
}

async fn assert_rate_limited(response: axum::response::Response) {
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .expect("429 应包含 Content-Type")
        .to_str()
        .expect("Content-Type 应为 ASCII");
    assert!(content_type.starts_with("application/json"));
    let response_request_id = response
        .headers()
        .get("x-request-id")
        .expect("429 应包含 X-Request-Id")
        .to_str()
        .expect("X-Request-Id 应为 ASCII")
        .to_owned();
    let retry_after = response
        .headers()
        .get("retry-after")
        .expect("429 应包含 Retry-After")
        .to_str()
        .expect("Retry-After 应为整数秒")
        .parse::<u64>()
        .expect("Retry-After 应为整数秒");
    assert!((1..=60).contains(&retry_after));
    let json = response_json(response).await;
    assert_eq!(json["error"]["code"], "RATE_LIMITED");
    assert_eq!(json["error"]["message"], "请求过于频繁，请稍后再试。");
    assert_eq!(json["error"]["fieldErrors"], Value::Object(Map::default()));
    assert_eq!(json["error"]["details"], Value::Object(Map::default()));
    let body_request_id = json["error"]["requestId"]
        .as_str()
        .expect("429 body 应包含 requestId");
    assert!(!body_request_id.is_empty());
    assert_eq!(response_request_id, body_request_id);
}

async fn create_link_invitation(
    app: &Router,
    invitations_uri: &str,
    context: &AuthContext,
) -> Value {
    let response = app
        .clone()
        .oneshot(mutation_request(
            "POST",
            invitations_uri,
            Body::from(r#"{"kind":"LINK"}"#),
            context,
        ))
        .await
        .expect("router 应响应");
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn create_activity(app: &Router, context: &AuthContext, name: &str) -> Value {
    let response = app
        .clone()
        .oneshot(mutation_request(
            "POST",
            "/api/activities",
            Body::from(format!(
                r#"{{"name":"{name}","baseCurrency":"CNY","startDate":"2026-09-01"}}"#
            )),
            context,
        ))
        .await
        .expect("router 应响应");
    assert_eq!(response.status(), StatusCode::CREATED);
    response_json(response).await
}

async fn assert_repeated_mutation_status(
    app: &Router,
    context: &AuthContext,
    method: &str,
    uri: &str,
    body: &str,
    expected_status: StatusCode,
) {
    for _ in 0..11 {
        let response = app
            .clone()
            .oneshot(mutation_request(
                method,
                uri,
                Body::from(body.to_owned()),
                context,
            ))
            .await
            .expect("router 应响应");
        assert_eq!(response.status(), expected_status);
    }
}

async fn assert_repeated_read_status(
    app: &Router,
    context: &AuthContext,
    uri: &str,
    expected_status: StatusCode,
) {
    for _ in 0..11 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(uri)
                    .header(COOKIE, &context.cookie)
                    .body(Body::empty())
                    .expect("请求应可构造"),
            )
            .await
            .expect("router 应响应");
        assert_eq!(response.status(), expected_status);
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn auth_limit_spans_login_and_registration_and_isolates_peer_ips() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let pool = test_pool().await;
    bootstrap_user(&pool).await;
    let app = app(pool, AppSecret::from_bytes([7; 32]));
    let context = pre_auth_context(&app).await;

    for request_index in 0..10 {
        let (uri, body) = if request_index < 5 {
            (
                "/api/auth/login",
                Body::from(r#"{"username":"alice","password":"invalid test password"}"#),
            )
        } else {
            (
                "/api/auth/register",
                Body::from(
                    r#"{"username":"bob","password":"valid test password","displayName":"Bob","invitationToken":"invalid"}"#,
                ),
            )
        };
        let response = app
            .clone()
            .oneshot(with_peer_ip(
                mutation_request("POST", uri, body, &context),
                "198.51.100.10:1024",
            ))
            .await
            .expect("router 应响应");
        assert_ne!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    let response = app
        .clone()
        .oneshot(with_peer_ip(
            mutation_request(
                "POST",
                "/api/auth/login",
                Body::from(r#"{"username":"alice","password":"invalid test password"}"#),
                &context,
            ),
            "198.51.100.10:1024",
        ))
        .await
        .expect("router 应响应");
    assert_rate_limited(response).await;

    let response = app
        .oneshot(with_peer_ip(
            mutation_request(
                "POST",
                "/api/auth/login",
                Body::from(r#"{"username":"alice","password":"invalid test password"}"#),
                &context,
            ),
            "198.51.100.11:1024",
        ))
        .await
        .expect("router 应响应");
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn anonymous_preview_and_join_share_limit_before_authentication() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let pool = test_pool().await;
    let app = app(pool, AppSecret::from_bytes([7; 32]));

    for _ in 0..29 {
        let response = app
            .clone()
            .oneshot(with_peer_ip(
                Request::builder()
                    .uri("/api/invitations/invalid-token")
                    .body(Body::empty())
                    .expect("请求应可构造"),
                "198.51.100.20:1024",
            ))
            .await
            .expect("router 应响应");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    let join_response = app
        .clone()
        .oneshot(with_peer_ip(
            Request::builder()
                .method("POST")
                .uri("/api/invitations/invalid-token/join")
                .header(ORIGIN, BASE_ORIGIN)
                .header("sec-fetch-site", "same-origin")
                .body(Body::empty())
                .expect("请求应可构造"),
            "198.51.100.20:1024",
        ))
        .await
        .expect("router 应响应");
    assert_eq!(join_response.status(), StatusCode::UNAUTHORIZED);

    let response = app
        .clone()
        .oneshot(with_peer_ip(
            Request::builder()
                .uri("/api/invitations/invalid-token")
                .body(Body::empty())
                .expect("请求应可构造"),
            "198.51.100.20:1024",
        ))
        .await
        .expect("router 应响应");
    assert_rate_limited(response).await;

    let response = app
        .oneshot(with_peer_ip(
            Request::builder()
                .uri("/api/invitations/invalid-token")
                .body(Body::empty())
                .expect("请求应可构造"),
            "198.51.100.21:1024",
        ))
        .await
        .expect("router 应响应");
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
#[allow(clippy::too_many_lines)]
async fn sensitive_writes_require_session_and_csrf_before_sharing_user_limit() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let pool = test_pool().await;
    let first_user_id = bootstrap_user(&pool).await;
    let secret = AppSecret::from_bytes([7; 32]);
    let first_context = session_context(&pool, &secret, first_user_id).await;
    let second_user_id = insert_user(&pool, "bob", "second user password").await;
    let second_context = session_context(&pool, &secret, second_user_id).await;
    let app = app(pool.clone(), secret);

    let activity_response = app
        .clone()
        .oneshot(mutation_request(
            "POST",
            "/api/activities",
            Body::from(r#"{"name":"Rate test","baseCurrency":"CNY","startDate":"2026-09-01"}"#),
            &first_context,
        ))
        .await
        .expect("router 应响应");
    assert_eq!(activity_response.status(), StatusCode::CREATED);
    let activity_json = response_json(activity_response).await;
    let activity_id = activity_json["data"]["activityId"]
        .as_str()
        .expect("应返回活动 ID")
        .to_owned();
    let invitations_uri = format!("/api/activities/{activity_id}/invitations");

    let no_session_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&invitations_uri)
                .header(CONTENT_TYPE, "application/json")
                .header(ORIGIN, BASE_ORIGIN)
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", "not-used-without-session")
                .body(Body::from(r#"{"kind":"LINK"}"#))
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");
    assert_eq!(no_session_response.status(), StatusCode::UNAUTHORIZED);

    let no_csrf_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&invitations_uri)
                .header(CONTENT_TYPE, "application/json")
                .header(COOKIE, &first_context.cookie)
                .header(ORIGIN, BASE_ORIGIN)
                .header("sec-fetch-site", "same-origin")
                .body(Body::from(r#"{"kind":"LINK"}"#))
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");
    assert_eq!(no_csrf_response.status(), StatusCode::FORBIDDEN);

    let created_json = create_link_invitation(&app, &invitations_uri, &first_context).await;
    let invitation_id = created_json["data"]["invitationId"]
        .as_str()
        .expect("应返回邀请 ID");
    let revoke_uri = format!("{invitations_uri}/{invitation_id}");

    let revoked_response = app
        .clone()
        .oneshot(mutation_request(
            "DELETE",
            &revoke_uri,
            Body::empty(),
            &first_context,
        ))
        .await
        .expect("router 应响应");
    assert_eq!(revoked_response.status(), StatusCode::OK);

    for _ in 0..8 {
        create_link_invitation(&app, &invitations_uri, &first_context).await;
    }

    let response = app
        .clone()
        .oneshot(mutation_request(
            "PUT",
            "/api/me/password",
            Body::from(
                r#"{"currentPassword":"correct horse battery staple","newPassword":"changed password value"}"#,
            ),
            &first_context,
        ))
        .await
        .expect("router 应响应");
    assert_rate_limited(response).await;

    let response = app
        .oneshot(mutation_request(
            "PUT",
            "/api/me/password",
            Body::from(
                r#"{"currentPassword":"second user password","newPassword":"second changed password"}"#,
            ),
            &second_context,
        ))
        .await
        .expect("router 应响应");
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn ordinary_business_summary_and_csv_routes_remain_unlimited() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let pool = test_pool().await;
    let user_id = bootstrap_user(&pool).await;
    let secret = AppSecret::from_bytes([7; 32]);
    let context = session_context(&pool, &secret, user_id).await;
    let app = app(pool, secret);

    let activity_json = create_activity(&app, &context, "Unlimited routes").await;
    let activity_id = activity_json["data"]["activityId"]
        .as_str()
        .expect("应返回活动 ID");
    let owner_member_id = activity_json["data"]["ownerMemberId"]
        .as_str()
        .expect("应返回 Owner 成员 ID");
    let activity_uri = format!("/api/activities/{activity_id}");
    let members_uri = format!("{activity_uri}/members");
    let guests_uri = format!("{members_uri}/guests");
    let expenses_uri = format!("{activity_uri}/expenses");
    let settlements_uri = format!("{activity_uri}/settlements");

    assert_repeated_mutation_status(
        &app,
        &context,
        "POST",
        "/api/activities",
        r#"{"name":"Unlimited activity","baseCurrency":"CNY","startDate":"2026-09-01"}"#,
        StatusCode::CREATED,
    )
    .await;
    assert_repeated_read_status(&app, &context, "/api/activities", StatusCode::OK).await;

    let guest_response = app
        .clone()
        .oneshot(mutation_request(
            "POST",
            &guests_uri,
            Body::from(r#"{"displayName":"Settlement member"}"#),
            &context,
        ))
        .await
        .expect("router 应响应");
    assert_eq!(guest_response.status(), StatusCode::CREATED);
    let guest_json = response_json(guest_response).await;
    let guest_member_id = guest_json["data"]["memberId"]
        .as_str()
        .expect("应返回 Guest 成员 ID");
    assert_repeated_mutation_status(
        &app,
        &context,
        "POST",
        &guests_uri,
        r#"{"displayName":"Unlimited guest"}"#,
        StatusCode::CREATED,
    )
    .await;
    assert_repeated_read_status(&app, &context, &members_uri, StatusCode::OK).await;

    let invalid_expense = format!(
        r#"{{"clientMutationId":"00000000-0000-0000-0000-000000000001","title":"Unlimited expense","category":"OTHER","occurredAt":"not-a-timestamp","originalCurrency":"CNY","originalAmountMinor":"1","exchangeRateKind":"IDENTITY","exchangeRate":"1","payments":[],"split":{{"mode":"EQUAL","members":["{owner_member_id}"]}}}}"#
    );
    assert_repeated_mutation_status(
        &app,
        &context,
        "POST",
        &expenses_uri,
        &invalid_expense,
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
    assert_repeated_read_status(&app, &context, &expenses_uri, StatusCode::OK).await;

    let invalid_settlement = format!(
        r#"{{"clientMutationId":"00000000-0000-0000-0000-000000000002","payerMemberId":"{owner_member_id}","receiverMemberId":"{guest_member_id}","currency":"CNY","amountMinor":"0"}}"#
    );
    assert_repeated_mutation_status(
        &app,
        &context,
        "POST",
        &settlements_uri,
        &invalid_settlement,
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
    assert_repeated_read_status(&app, &context, &settlements_uri, StatusCode::OK).await;

    for uri in [
        format!("/api/activities/{activity_id}/summary"),
        format!("/api/activities/{activity_id}/export.csv"),
    ] {
        assert_repeated_read_status(&app, &context, &uri, StatusCode::OK).await;
    }
}
