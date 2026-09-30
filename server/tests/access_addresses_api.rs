use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt as _;
use huddletab_server::{
    http::router::{AppState, router_with_state},
    infrastructure::{
        access_addresses::{import_legacy, load},
        app_secret::AppSecret,
        csrf::{CsrfContext, CsrfToken},
        database::connect_and_migrate,
        session::SessionToken,
    },
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt as _;
use uuid::Uuid;

/// 每个测试有独立 schema，不修改已有业务测试使用的 public，也不依赖真实用户数据。
struct Fixture {
    root: PgPool,
    schema: String,
    url: String,
    pool: PgPool,
    app: Router,
    session: SessionToken,
    csrf: CsrfToken,
    user_id: Uuid,
}

impl Fixture {
    async fn new() -> Self {
        let base = std::env::var("TEST_DATABASE_URL").expect("需要可丢弃测试库");
        let root = PgPool::connect(&base).await.unwrap();
        let schema = format!("access_test_{}", Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE SCHEMA {schema}"))
            .execute(&root)
            .await
            .unwrap();
        let sep = if base.contains('?') { '&' } else { '?' };
        let url = format!("{base}{sep}options[search_path]={schema}");
        let pool = connect_and_migrate(&url).await.unwrap();
        let user_id = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ($1, 'access-admin', 'unused', 'Admin', NOW(), NOW())")
            .bind(user_id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO system_roles (user_id, role, granted_at) VALUES ($1, 'SYSTEM_ADMIN', NOW())").bind(user_id).execute(&pool).await.unwrap();
        let session = SessionToken::generate();
        sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, NOW(), NOW(), NOW() + INTERVAL '30 days', NOW() + INTERVAL '90 days')")
            .bind(Uuid::new_v4()).bind(user_id).bind(session.sha256_hash().as_slice()).execute(&pool).await.unwrap();
        let secret = AppSecret::from_bytes([31; 32]);
        let csrf = CsrfToken::mint(&secret, CsrfContext::Session(&session.sha256_hash()));
        let app = router_with_state(None, AppState::new(pool.clone(), secret));
        Self {
            root,
            schema,
            url,
            pool,
            app,
            session,
            csrf,
            user_id,
        }
    }

    #[allow(clippy::needless_pass_by_value)]
    fn request(
        &self,
        origin: &str,
        method: &str,
        path: &str,
        body: Value,
        authenticated: bool,
    ) -> Request<Body> {
        let url = url::Url::parse(origin).unwrap();
        let mut request = Request::builder()
            .uri(format!("{origin}{path}"))
            .method(method)
            .header(
                "host",
                &url[url::Position::BeforeHost..url::Position::AfterPort],
            )
            .header("content-type", "application/json");
        if authenticated {
            request = request
                .header(
                    "cookie",
                    format!("huddletab_session={}", self.session.expose_for_cookie()),
                )
                .header("origin", origin)
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", self.csrf.expose_for_header());
        }
        request.body(Body::from(body.to_string())).unwrap()
    }

    async fn send(&self, request: Request<Body>) -> (StatusCode, Value) {
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&body).unwrap_or(Value::Null))
    }

    async fn cleanup(self) {
        self.pool.close().await;
        sqlx::query(&format!("DROP SCHEMA {} CASCADE", self.schema))
            .execute(&self.root)
            .await
            .unwrap();
        self.root.close().await;
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
#[allow(clippy::too_many_lines)]
async fn addresses_are_live_shared_and_cannot_lock_out_current_admin() {
    let f = Fixture::new().await;
    let old = "http://192.168.1.20:5660";
    let new = "https://example.test";
    let endpoint = "/api/admin/access-addresses";
    let (status, settings) = f
        .send(f.request(old, "GET", endpoint, Value::Null, true))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(settings["data"]["origins"], json!([]));
    assert_eq!(
        f.send(f.request(old, "POST", "/mcp", json!({}), false))
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    let version = settings["data"]["version"].as_i64().unwrap();
    let save = |origins: Value, version| json!({"origins": origins, "version": version});
    assert_eq!(
        f.send(f.request(old, "PUT", endpoint, save(json!([new]), version), true))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut no_csrf = f.request(old, "PUT", endpoint, save(json!([old]), version), true);
    no_csrf.headers_mut().remove("x-csrf-token");
    assert_eq!(f.send(no_csrf).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        f.send(f.request(old, "PUT", endpoint, save(json!([old]), version), false))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );

    let (status, saved) = f
        .send(f.request(
            old,
            "PUT",
            endpoint,
            save(json!([old, "https://EXAMPLE.test:443/", new]), version),
            true,
        ))
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["data"]["origins"], json!([old, new]));
    let version2 = saved["data"]["version"].as_i64().unwrap();
    assert_eq!(
        f.send(f.request(new, "GET", endpoint, Value::Null, true))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        f.send(f.request(
            "http://other.test",
            "GET",
            "/api/auth/csrf",
            Value::Null,
            false
        ))
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let mut cross = f.request(
        old,
        "PUT",
        endpoint,
        save(json!([old, new]), version2),
        true,
    );
    cross.headers_mut().insert("origin", new.parse().unwrap());
    assert_eq!(
        f.send(cross).await.0,
        StatusCode::FORBIDDEN,
        "已配置的另一地址也不是同源"
    );
    assert_eq!(
        f.send(f.request(new, "PUT", endpoint, save(json!([old, new]), version), true))
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        f.send(f.request(new, "PUT", endpoint, save(json!([]), version2), true))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(load(&f.pool).await.unwrap().version, version2);

    for origin in [old, new] {
        let response = f
            .app
            .clone()
            .oneshot(f.request(origin, "GET", "/api/auth/csrf", Value::Null, false))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response.headers()["set-cookie"].to_str().unwrap();
        assert_eq!(cookie.contains("Secure"), origin.starts_with("https:"));
    }

    let (status, token) = f
        .send(f.request(
            new,
            "POST",
            "/api/me/mcp-tokens",
            json!({"name":"test", "scope":"READ"}),
            true,
        ))
        .await;
    assert!(status.is_success(), "{token}");
    let bearer = format!("Bearer {}", token["data"]["secret"].as_str().unwrap());
    let initialize = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"access-test","version":"1"}}});
    for origin in [old, new] {
        let mut request = f.request(origin, "POST", "/mcp", initialize.clone(), false);
        request
            .headers_mut()
            .insert("authorization", bearer.parse().unwrap());
        request.headers_mut().insert(
            "accept",
            "application/json, text/event-stream".parse().unwrap(),
        );
        let (status, result) = f.send(request).await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert!(result.get("result").is_some(), "{result}");
    }

    // 从新入口移除旧入口，同一个 Router 的下一次请求即被拒绝。
    let (status, _) = f
        .send(f.request(new, "PUT", endpoint, save(json!([new]), version2), true))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        f.send(f.request(old, "GET", endpoint, Value::Null, true))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        f.send(f.request(old, "POST", "/mcp", initialize, false))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let static_dir = tempfile::tempdir().unwrap();
    std::fs::write(static_dir.path().join("index.html"), "HuddleTab").unwrap();
    let static_app = router_with_state(
        Some(static_dir.path().to_path_buf()),
        AppState::new(f.pool.clone(), AppSecret::from_bytes([31; 32])),
    );
    assert_eq!(
        static_app
            .clone()
            .oneshot(f.request(old, "GET", "/login", Value::Null, false))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN,
        "已撤销入口不能继续读取网页"
    );
    assert_eq!(
        static_app
            .oneshot(f.request(new, "GET", "/login", Value::Null, false))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        f.send(f.request(old, "GET", "/api/health", Value::Null, false))
            .await
            .0,
        StatusCode::OK
    );

    sqlx::query("DELETE FROM system_roles WHERE user_id = $1")
        .bind(f.user_id)
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        f.send(f.request(new, "GET", endpoint, Value::Null, true))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        f.send(f.request(new, "PUT", endpoint, save(json!([new]), version2 + 1), true))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    f.cleanup().await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn legacy_import_is_atomic_once_and_survives_reconnecting() {
    let f = Fixture::new().await;
    import_legacy(&f.pool, None).await.unwrap();
    assert!(load(&f.pool).await.unwrap().origins.is_none());
    assert!(
        import_legacy(&f.pool, Some("https://example.test/path"))
            .await
            .is_err()
    );
    assert!(load(&f.pool).await.unwrap().origins.is_none());
    let (first, second) = tokio::join!(
        import_legacy(&f.pool, Some("HTTPS://Example.test:443/")),
        import_legacy(&f.pool, Some("https://example.test"))
    );
    first.unwrap();
    second.unwrap();
    let settings = load(&f.pool).await.unwrap();
    assert_eq!(
        settings.origins,
        Some(vec!["https://example.test".to_owned()])
    );
    assert_eq!(settings.version, 2);
    import_legacy(&f.pool, Some("invalid old value"))
        .await
        .unwrap();
    let reconnected = connect_and_migrate(&f.url).await.unwrap();
    assert_eq!(load(&reconnected).await.unwrap().origins, settings.origins);
    reconnected.close().await;
    f.cleanup().await;
}
