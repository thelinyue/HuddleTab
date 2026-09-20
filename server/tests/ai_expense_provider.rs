//! AI Provider 的本地确定性协议链路测试。
//!
//! 测试使用 loopback 随机端口上的最小 OpenAI-compatible Stub，经过真实管理员设置、
//! Session/CSRF、Activity 权限、Provider HTTP、assistant content 解析和成员标准化；
//! Stub 不连接外网，也不会打印请求头、Prompt 或图片 data URL。

use std::{collections::HashSet, io::Cursor, sync::Arc};

use axum::{
    Router,
    body::{Body, Bytes},
    extract::State,
    http::{
        HeaderMap, Request, StatusCode,
        header::{AUTHORIZATION, CONTENT_TYPE, COOKIE, ORIGIN, RETRY_AFTER},
    },
    response::{IntoResponse, Response},
    routing::post,
};
use http_body_util::BodyExt as _;
use huddletab_server::{
    http::router::{AppState, router_with_state},
    infrastructure::{
        app_secret::AppSecret,
        csrf::{CsrfContext, CsrfToken},
        database::connect_and_migrate,
        session::SessionToken,
    },
};
use image::{DynamicImage, ImageFormat};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::{
    net::TcpListener,
    sync::{Mutex, oneshot},
    task::JoinHandle,
};
use tower::ServiceExt as _;
use uuid::Uuid;

const TEST_DATABASE_URL_ENV: &str = "TEST_DATABASE_URL";
const BASE_ORIGIN: &str = "http://localhost:5660";
const TEST_API_KEY: &str = "local-stub-key";

#[derive(Clone, Copy)]
enum StubMode {
    Success,
    InvalidJson,
    TooManyRequests,
}

struct StubCall {
    authorization_present: bool,
    body: Value,
}

#[derive(Clone)]
struct StubState {
    calls: Arc<Mutex<Vec<StubCall>>>,
    mode: Arc<Mutex<StubMode>>,
}

struct StubServer {
    state: StubState,
    base_url: String,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl Drop for StubServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn stub_handler(State(state): State<StubState>, headers: HeaderMap, body: Bytes) -> Response {
    let parsed: Value = serde_json::from_slice(&body).expect("Provider 请求应为 JSON");
    state.calls.lock().await.push(StubCall {
        authorization_present: headers.contains_key(AUTHORIZATION),
        body: parsed.clone(),
    });
    match *state.mode.lock().await {
        StubMode::Success => {
            let is_image = parsed
                .pointer("/messages/1/content")
                .and_then(Value::as_array)
                .is_some();
            let content = if is_image {
                json!({
                    "title": "本地 Stub 小票",
                    "amount": {"value": "8.00", "currency": "CNY"},
                    "payers": [{"name": "小王", "memberId": "00000000-0000-0000-0000-000000000099"}],
                    "merchant": "合成测试商家"
                })
            } else {
                json!({
                    "title": "本地 Stub 晚餐",
                    "amount": {"value": "12.34", "currency": "CNY"},
                    "payers": [{"name": "我", "amount": {"value": "12.34", "currency": "CNY"}, "memberId": "00000000-0000-0000-0000-000000000099"}],
                    "split": {"mode": "EQUAL", "participants": [{"name": "我"}, {"name": "小王", "member_id": "00000000-0000-0000-0000-000000000099"}]}
                })
            };
            (
                StatusCode::OK,
                [(CONTENT_TYPE, "application/json")],
                JsonEnvelope(json!({
                    "choices": [{"message": {"role": "assistant", "content": content.to_string()}}]
                })),
            )
                .into_response()
        }
        StubMode::InvalidJson => (
            StatusCode::OK,
            [(CONTENT_TYPE, "application/json")],
            "invalid-json-from-stub",
        )
            .into_response(),
        StubMode::TooManyRequests => (
            StatusCode::TOO_MANY_REQUESTS,
            [(RETRY_AFTER, "7")],
            "stub provider body must not leak",
        )
            .into_response(),
    }
}

struct JsonEnvelope(Value);

impl IntoResponse for JsonEnvelope {
    fn into_response(self) -> Response {
        (
            StatusCode::OK,
            [(CONTENT_TYPE, "application/json")],
            self.0.to_string(),
        )
            .into_response()
    }
}

async fn start_stub() -> StubServer {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .expect("应绑定 loopback 随机端口");
    let port = listener.local_addr().expect("应读取 Stub 地址").port();
    let state = StubState {
        calls: Arc::new(Mutex::new(Vec::new())),
        mode: Arc::new(Mutex::new(StubMode::Success)),
    };
    let app = Router::new()
        .route("/v1/chat/completions", post(stub_handler))
        .with_state(state.clone());
    let (shutdown, signal) = oneshot::channel();
    let task = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = signal.await;
            })
            .await
            .expect("Stub 服务应正常退出");
    });
    StubServer {
        state,
        base_url: format!("http://127.0.0.1:{port}/v1"),
        shutdown: Some(shutdown),
        task,
    }
}

impl StubServer {
    async fn stop(mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        let _ = (&mut self.task).await;
    }

    async fn set_mode(&self, mode: StubMode) {
        *self.state.mode.lock().await = mode;
    }

    async fn calls(&self) -> Vec<StubCall> {
        let mut calls = self.state.calls.lock().await;
        std::mem::take(&mut *calls)
    }
}

struct TestContext {
    pool: PgPool,
    app: axum::Router,
    session: SessionToken,
    csrf: CsrfToken,
    activity_id: Uuid,
    owner_member_id: Uuid,
    other_member_id: Uuid,
}

#[allow(clippy::too_many_lines)]
async fn seed_context() -> TestContext {
    let database_url = std::env::var(TEST_DATABASE_URL_ENV).expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清理测试数据");
    sqlx::query(
        "UPDATE system_settings SET ai_expense_draft_enabled = FALSE, ai_provider_base_url = NULL, \
         ai_provider_models = '[]'::jsonb, ai_provider_default_model = NULL, ai_provider_json_mode = TRUE, ai_provider_timeout_seconds = 30, \
         ai_image_enabled = FALSE, ai_provider_max_image_bytes = 10485760, \
         ai_provider_api_key_envelope = NULL, version = 1, updated_at = now(), updated_by_user_id = NULL",
    )
    .execute(&pool)
    .await
    .expect("应重置 AI 设置");
    sqlx::query("DELETE FROM system_admin_audit_logs")
        .execute(&pool)
        .await
        .expect("应清理系统审计");

    let user_id = Uuid::new_v4();
    let activity_id = Uuid::new_v4();
    let owner_member_id = Uuid::new_v4();
    let other_member_id = Uuid::new_v4();
    let now = time::OffsetDateTime::now_utc();
    let mut transaction = pool.begin().await.expect("应开启测试事务");
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'ai-provider-admin', 'test-hash', '本地测试管理员', $2, $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入测试用户");
    sqlx::query(
        "INSERT INTO system_roles (user_id, role, granted_at) VALUES ($1, 'SYSTEM_ADMIN', $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应授予系统管理员角色");
    sqlx::query(
        "INSERT INTO activities (id, name, base_currency, start_date, owner_member_id, \
         created_by_user_id, created_at, updated_at) VALUES ($1, 'Stub 活动', 'CNY', $2, $3, $4, $5, $5)",
    )
    .bind(activity_id)
    .bind(now.date())
    .bind(owner_member_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入测试活动");
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) \
         VALUES ($1, $2, $3, '本地用户', 'OWNER', $4), ($5, $2, NULL, '小王', 'MEMBER', $4)",
    )
    .bind(owner_member_id)
    .bind(activity_id)
    .bind(user_id)
    .bind(now)
    .bind(other_member_id)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动成员");
    transaction.commit().await.expect("应提交测试基础数据");

    let session = SessionToken::generate();
    let session_hash = session.sha256_hash();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at) \
         VALUES ($1, $2, $3, $4, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(session_hash.as_slice())
    .bind(now)
    .bind(now + time::Duration::days(30))
    .bind(now + time::Duration::days(90))
    .execute(&pool)
    .await
    .expect("应插入测试 Session");

    let secret = AppSecret::from_bytes([41; 32]);
    let csrf = CsrfToken::mint(&secret, CsrfContext::Session(&session_hash));
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, BASE_ORIGIN.to_owned()),
    );
    TestContext {
        pool,
        app,
        session,
        csrf,
        activity_id,
        owner_member_id,
        other_member_id,
    }
}

fn json_request(
    session: &SessionToken,
    csrf: &CsrfToken,
    method: &str,
    uri: &str,
    body: &Value,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .header(
            COOKIE,
            format!("huddletab_session={}", session.expose_for_cookie()),
        )
        .header(ORIGIN, BASE_ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("x-csrf-token", csrf.expose_for_header())
        .body(Body::from(body.to_string()))
        .expect("JSON 请求应可构造")
}

fn multipart_request(
    session: &SessionToken,
    csrf: &CsrfToken,
    uri: &str,
    image: &[u8],
) -> Request<Body> {
    let boundary = "----huddletab-local-stub";
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"synthetic.png\"\r\nContent-Type: image/png\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(image);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    Request::builder()
        .method("POST")
        .uri(uri)
        .header(
            CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .header(
            COOKIE,
            format!("huddletab_session={}", session.expose_for_cookie()),
        )
        .header(ORIGIN, BASE_ORIGIN)
        .header("sec-fetch-site", "same-origin")
        .header("x-csrf-token", csrf.expose_for_header())
        .body(Body::from(body))
        .expect("multipart 请求应可构造")
}

async fn json_response(response: axum::response::Response) -> (StatusCode, Value) {
    let status = response.status();
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取测试响应")
        .to_bytes();
    let json = serde_json::from_slice(&body).expect("响应应为 JSON");
    (status, json)
}

async fn configure_ai(context: &TestContext, stub_url: &str) -> i64 {
    let response = context
        .app
        .clone()
        .oneshot(json_request(
            &context.session,
            &context.csrf,
            "PUT",
            "/api/admin/ai-expense-draft-settings",
            &json!({
                "enabled": true,
                "baseUrl": stub_url,
                "models": [{"name": "stub-text", "supportsImage": true}, {"name": "stub-image", "supportsImage": true}],
                "defaultModel": "stub-text",
                "jsonMode": true,
                "timeoutSeconds": 2,
                "imageEnabled": true,
                "maxImageBytes": 10_485_760,
                "apiKey": TEST_API_KEY,
                "clearApiKey": false,
                "version": 1
            }),
        ))
        .await
        .expect("管理员设置路由应响应");
    let (status, payload) = json_response(response).await;
    assert_eq!(
        status,
        StatusCode::OK,
        "管理员设置失败: {}",
        payload["error"]["code"]
    );
    assert_eq!(payload["data"]["apiKeyStatus"].as_str(), Some("CONFIGURED"));
    assert!(payload["data"].get("apiKey").is_none());
    payload["data"]["version"]
        .as_i64()
        .expect("设置响应应返回 version")
}

async fn update_default_model(
    context: &TestContext,
    stub_url: &str,
    version: i64,
    default_model: &str,
) -> i64 {
    let response = context
        .app
        .clone()
        .oneshot(json_request(
            &context.session,
            &context.csrf,
            "PUT",
            "/api/admin/ai-expense-draft-settings",
            &json!({
                "enabled": true,
                "baseUrl": stub_url,
                "models": [{"name": "stub-text", "supportsImage": true}, {"name": "stub-image", "supportsImage": true}],
                "defaultModel": default_model,
                "jsonMode": true,
                "timeoutSeconds": 2,
                "imageEnabled": true,
                "maxImageBytes": 10_485_760,
                "clearApiKey": false,
                "version": version
            }),
        ))
        .await
        .expect("管理员设置路由应响应");
    let (status, payload) = json_response(response).await;
    assert_eq!(status, StatusCode::OK);
    payload["data"]["version"]
        .as_i64()
        .expect("设置响应应返回 version")
}

fn synthetic_png() -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(2, 2)
        .write_to(&mut output, ImageFormat::Png)
        .expect("应生成合成 PNG");
    output.into_inner()
}

async fn accounting_counts(pool: &PgPool, activity_id: Uuid) -> (i64, i64, i64, i64) {
    let revision = sqlx::query_scalar::<_, i64>("SELECT revision FROM activities WHERE id = $1")
        .bind(activity_id)
        .fetch_one(pool)
        .await
        .expect("应读取活动 revision");
    let expenses =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM expenses WHERE activity_id = $1")
            .bind(activity_id)
            .fetch_one(pool)
            .await
            .expect("应统计 Expense");
    let attachments = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM expense_attachments a JOIN expenses e ON e.id = a.expense_id WHERE e.activity_id = $1",
    )
    .bind(activity_id)
    .fetch_one(pool)
    .await
    .expect("应统计附件");
    let activity_audit = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM activity_audit_logs WHERE activity_id = $1",
    )
    .bind(activity_id)
    .fetch_one(pool)
    .await
    .expect("应统计 Activity Audit");
    (revision, expenses, attachments, activity_audit)
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
#[allow(clippy::too_many_lines)]
async fn ai_provider_loopback_completes_text_and_image_protocol_chain() {
    let stub = start_stub().await;
    let context = seed_context().await;
    let version = configure_ai(&context, &stub.base_url).await;
    let before = accounting_counts(&context.pool, context.activity_id).await;
    let text_uri = format!(
        "/api/activities/{}/ai/expense-draft/text",
        context.activity_id
    );
    let response = context
        .app
        .clone()
        .oneshot(json_request(
            &context.session,
            &context.csrf,
            "POST",
            &text_uri,
            &json!({"text": "晚餐 12.34 元，我先付，小王参与"}),
        ))
        .await
        .expect("文字草稿路由应响应");
    let (status, payload) = json_response(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(payload["data"]["amount"]["amountMinor"], "1234");
    assert_eq!(payload["data"]["amount"]["currency"], "CNY");
    let member_ids = [context.owner_member_id, context.other_member_id]
        .into_iter()
        .map(|id| id.to_string())
        .collect::<HashSet<_>>();
    let payer_id = payload["data"]["payerSuggestions"][0]["memberId"]
        .as_str()
        .expect("文字结果应返回服务端匹配 memberId");
    assert!(member_ids.contains(payer_id));
    assert_ne!(payer_id, "00000000-0000-0000-0000-000000000099");
    assert!(
        payload["data"]["warnings"]
            .as_array()
            .is_some_and(|warnings| {
                warnings
                    .iter()
                    .any(|warning| warning["code"] == "AI_MEMBER_FIELD_DROPPED")
            })
    );

    let image_uri = format!(
        "/api/activities/{}/ai/expense-draft/image",
        context.activity_id
    );
    let response = context
        .app
        .clone()
        .oneshot(multipart_request(
            &context.session,
            &context.csrf,
            &image_uri,
            &synthetic_png(),
        ))
        .await
        .expect("图片草稿路由应响应");
    let (status, payload) = json_response(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(payload["data"]["amount"]["amountMinor"], "800");
    assert!(
        payload["data"]["payerSuggestions"][0]["memberId"]
            .as_str()
            .is_some()
    );

    let calls = stub.calls().await;
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().all(|call| call.authorization_present));
    assert_eq!(calls[0].body["model"], "stub-text");
    assert_eq!(calls[0].body["response_format"]["type"], "json_object");
    assert_eq!(calls[1].body["model"], "stub-text");
    assert_eq!(calls[1].body["response_format"]["type"], "json_object");
    let image_data_url = calls[1].body["messages"][1]["content"][1]["image_url"]["url"]
        .as_str()
        .expect("图片请求应包含 data URL");
    assert!(image_data_url.starts_with("data:image/webp;base64,"));
    assert!(!image_data_url.contains("http://"));
    assert!(!image_data_url.contains("https://"));

    update_default_model(&context, &stub.base_url, version, "stub-image").await;
    let response = context
        .app
        .clone()
        .oneshot(multipart_request(
            &context.session,
            &context.csrf,
            &image_uri,
            &synthetic_png(),
        ))
        .await
        .expect("图片回退模型路由应响应");
    assert_eq!(json_response(response).await.0, StatusCode::OK);
    let calls = stub.calls().await;
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].body["model"], "stub-image");
    assert_eq!(
        accounting_counts(&context.pool, context.activity_id).await,
        before
    );
    let admin_audit_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM system_admin_audit_logs")
            .fetch_one(&context.pool)
            .await
            .expect("应读取管理员审计数量");
    assert_eq!(admin_audit_count, 2);

    context.pool.close().await;
    stub.stop().await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn ai_provider_loopback_failures_map_without_retry() {
    let stub = start_stub().await;
    let context = seed_context().await;
    configure_ai(&context, &stub.base_url).await;
    let text_uri = format!(
        "/api/activities/{}/ai/expense-draft/text",
        context.activity_id
    );

    stub.set_mode(StubMode::InvalidJson).await;
    let response = context
        .app
        .clone()
        .oneshot(json_request(
            &context.session,
            &context.csrf,
            "POST",
            &text_uri,
            &json!({"text": "失败测试 1 元"}),
        ))
        .await
        .expect("非法响应路由应响应");
    let (status, payload) = json_response(response).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert_eq!(payload["error"]["code"], "AI_INVALID_RESPONSE");

    stub.set_mode(StubMode::TooManyRequests).await;
    let response = context
        .app
        .clone()
        .oneshot(json_request(
            &context.session,
            &context.csrf,
            "POST",
            &text_uri,
            &json!({"text": "失败测试 2 元"}),
        ))
        .await
        .expect("429 路由应响应");
    let (status, payload) = json_response(response).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(payload["error"]["code"], "AI_PROVIDER_UNAVAILABLE");
    assert!(payload.to_string().find("stub provider body").is_none());
    assert_eq!(stub.calls().await.len(), 2);

    context.pool.close().await;
    stub.stop().await;
}
