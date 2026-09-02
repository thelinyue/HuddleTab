use std::io::Cursor;

use axum::{
    body::Body,
    http::{
        HeaderMap, Request, StatusCode,
        header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE, COOKIE, ORIGIN},
    },
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
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde_json::Value;
use sqlx::PgPool;
use tempfile::TempDir;
use time::{Duration, OffsetDateTime};
use tower::ServiceExt as _;
use uuid::Uuid;

struct Context {
    app: axum::Router,
    _uploads: TempDir,
    activity_id: Uuid,
    expense_id: Uuid,
    session: SessionToken,
    outsider_session: SessionToken,
    csrf: CsrfToken,
}

async fn seed_context() -> Context {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let owner_user_id = Uuid::new_v4();
    let outsider_user_id = Uuid::new_v4();
    let activity_id = Uuid::new_v4();
    let owner_member_id = Uuid::new_v4();
    let expense_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let mut transaction = pool.begin().await.expect("应开启测试事务");
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
         VALUES ($1, 'attachment-api-owner', 'unused', 'Owner', $3, $3),
                ($2, 'attachment-api-outsider', 'unused', 'Outsider', $3, $3)",
    )
    .bind(owner_user_id)
    .bind(outsider_user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入用户");
    sqlx::query(
        "INSERT INTO activities (
            id, name, base_currency, start_date, owner_member_id, created_by_user_id,
            created_at, updated_at
         ) VALUES ($1, '附件 API 活动', 'CNY', '2026-09-02', $2, $3, $4, $4)",
    )
    .bind(activity_id)
    .bind(owner_member_id)
    .bind(owner_user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动");
    sqlx::query(
        "INSERT INTO activity_members (
            id, activity_id, user_id, display_name, role, joined_at
         ) VALUES ($1, $2, $3, 'Owner', 'OWNER', $4)",
    )
    .bind(owner_member_id)
    .bind(activity_id)
    .bind(owner_user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入 Owner");
    sqlx::query(
        "INSERT INTO expenses (
            id, activity_id, created_by_user_id, client_mutation_id, title, category,
            occurred_at, original_currency, original_amount_minor, base_currency,
            base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, '附件 API 账单', 'OTHER', $5, 'CNY', 100, 'CNY',
                   100, 'IDENTITY', 1, 'EXACT', $5, $5)",
    )
    .bind(expense_id)
    .bind(activity_id)
    .bind(owner_user_id)
    .bind(Uuid::new_v4())
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入 Expense");
    transaction.commit().await.expect("应提交基础数据");

    let secret = AppSecret::from_bytes([47; 32]);
    let session = insert_session(&pool, owner_user_id, now).await;
    let outsider_session = insert_session(&pool, outsider_user_id, now).await;
    let csrf = CsrfToken::mint(&secret, CsrfContext::Session(&session.sha256_hash()));
    let uploads = tempfile::tempdir().expect("应创建临时上传目录");
    let state = AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned())
        .with_uploads_dir(uploads.path().to_path_buf());
    Context {
        app: router_with_state(None, state),
        _uploads: uploads,
        activity_id,
        expense_id,
        session,
        outsider_session,
        csrf,
    }
}

async fn insert_session(pool: &PgPool, user_id: Uuid, now: OffsetDateTime) -> SessionToken {
    let session = SessionToken::generate();
    let hash = session.sha256_hash();
    sqlx::query(
        "INSERT INTO sessions (
            id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at
         ) VALUES ($1, $2, $3, $4, $4, $5, $6)",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(hash.as_slice())
    .bind(now)
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(pool)
    .await
    .expect("应插入 Session");
    session
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn multipart_upload_replay_and_private_download_use_json_contract() {
    let context = seed_context().await;
    let client_attachment_id = Uuid::new_v4();
    let (content_type, body) =
        multipart(Some(&client_attachment_id.to_string()), Some(png_1_by_1()));
    let (status, _, bytes) = raw_response(
        &context,
        upload_request(&context, &content_type, body.clone(), true),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let created: Value = serde_json::from_slice(&bytes).expect("上传响应应为 JSON");
    assert_eq!(created["data"]["mimeType"], "image/webp");
    assert!(created["data"]["byteSize"].is_string());
    assert!(created.to_string().find("storage").is_none());
    let attachment_id = created["data"]["id"].as_str().expect("响应应含附件 ID");

    let (status, _, replay_bytes) = raw_response(
        &context,
        upload_request(&context, &content_type, body, true),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let replay: Value = serde_json::from_slice(&replay_bytes).expect("重放响应应为 JSON");
    assert_eq!(replay["data"]["id"], attachment_id);

    let download_uri = format!(
        "/api/activities/{}/expenses/{}/attachments/{attachment_id}",
        context.activity_id, context.expense_id
    );
    let (status, headers, bytes) = raw_response(
        &context,
        Request::builder()
            .uri(&download_uri)
            .header(COOKIE, session_cookie(&context.session))
            .body(Body::empty())
            .expect("下载请求应可构造"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[CONTENT_TYPE], "image/webp");
    assert_eq!(headers[CACHE_CONTROL], "private, no-store");
    assert_eq!(headers["x-content-type-options"], "nosniff");
    assert_eq!(
        headers[CONTENT_DISPOSITION],
        format!("inline; filename=\"{attachment_id}.webp\"")
    );
    assert_eq!(&bytes[..4], b"RIFF");

    let (status, _, private_body) = raw_response(
        &context,
        Request::builder()
            .uri(download_uri)
            .header(COOKIE, session_cookie(&context.outsider_session))
            .body(Body::empty())
            .expect("下载请求应可构造"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let private_error: Value = serde_json::from_slice(&private_body).expect("私有 404 应为 JSON");
    assert_eq!(private_error["error"]["code"], "NOT_FOUND");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn csrf_precedes_body_parsing_and_multipart_errors_stay_json() {
    let context = seed_context().await;
    let oversized = vec![b'x'; 10 * 1024 * 1024 + 64 * 1024 + 1];
    let (status, _, bytes) = raw_response(
        &context,
        upload_request(
            &context,
            "multipart/form-data; boundary=limit",
            oversized.clone(),
            false,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let csrf_error: Value = serde_json::from_slice(&bytes).expect("CSRF 错误应为 JSON");
    assert_eq!(csrf_error["error"]["code"], "CSRF_INVALID");

    let (status, _, bytes) = raw_response(
        &context,
        upload_request(
            &context,
            "multipart/form-data; boundary=limit",
            oversized,
            true,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let size_error: Value = serde_json::from_slice(&bytes).expect("超限错误应为 JSON");
    assert_eq!(size_error["error"]["code"], "ATTACHMENT_TOO_LARGE");

    for (client_id, file) in [
        ("not-a-uuid".to_owned(), Some(png_1_by_1())),
        (Uuid::new_v4().to_string(), None),
    ] {
        let (content_type, body) = multipart(Some(&client_id), file);
        let (status, _, bytes) = raw_response(
            &context,
            upload_request(&context, &content_type, body, true),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let error: Value = serde_json::from_slice(&bytes).expect("multipart 错误应为 JSON");
        assert_eq!(error["error"]["code"], "INVALID_ATTACHMENT");
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn delete_requires_csrf_and_removes_private_attachment() {
    let context = seed_context().await;
    let client_attachment_id = Uuid::new_v4();
    let (content_type, body) =
        multipart(Some(&client_attachment_id.to_string()), Some(png_1_by_1()));
    let (status, _, bytes) = raw_response(
        &context,
        upload_request(&context, &content_type, body, true),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let created: Value = serde_json::from_slice(&bytes).expect("上传响应应为 JSON");
    let attachment_id = created["data"]["id"].as_str().expect("应返回附件 ID");
    let uri = format!(
        "/api/activities/{}/expenses/{}/attachments/{attachment_id}",
        context.activity_id, context.expense_id
    );

    let (status, _, body) = raw_response(
        &context,
        Request::builder()
            .method("DELETE")
            .uri(&uri)
            .header(COOKIE, session_cookie(&context.session))
            .header(ORIGIN, "http://localhost:5660")
            .header("sec-fetch-site", "same-origin")
            .body(Body::empty())
            .expect("删除请求应可构造"),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let error: Value = serde_json::from_slice(&body).expect("CSRF 错误应为 JSON");
    assert_eq!(error["error"]["code"], "CSRF_INVALID");

    let (status, _, body) = raw_response(
        &context,
        Request::builder()
            .method("DELETE")
            .uri(&uri)
            .header(COOKIE, session_cookie(&context.session))
            .header(ORIGIN, "http://localhost:5660")
            .header("sec-fetch-site", "same-origin")
            .header("x-csrf-token", context.csrf.expose_for_header())
            .body(Body::empty())
            .expect("删除请求应可构造"),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(body.is_empty());

    let (status, _, _) = raw_response(
        &context,
        Request::builder()
            .uri(uri)
            .header(COOKIE, session_cookie(&context.session))
            .body(Body::empty())
            .expect("下载请求应可构造"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

fn upload_request(
    context: &Context,
    content_type: &str,
    body: Vec<u8>,
    include_csrf: bool,
) -> Request<Body> {
    let mut builder = Request::builder()
        .method("POST")
        .uri(format!(
            "/api/activities/{}/expenses/{}/attachments",
            context.activity_id, context.expense_id
        ))
        .header(CONTENT_TYPE, content_type)
        .header(COOKIE, session_cookie(&context.session))
        .header(ORIGIN, "http://localhost:5660")
        .header("sec-fetch-site", "same-origin");
    if include_csrf {
        builder = builder.header("x-csrf-token", context.csrf.expose_for_header());
    }
    builder.body(Body::from(body)).expect("上传请求应可构造")
}

async fn raw_response(
    context: &Context,
    request: Request<Body>,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let response = context
        .app
        .clone()
        .oneshot(request)
        .await
        .expect("Router 应响应");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应 body")
        .to_bytes()
        .to_vec();
    (status, headers, bytes)
}

fn multipart(client_attachment_id: Option<&str>, file: Option<Vec<u8>>) -> (String, Vec<u8>) {
    let boundary = format!("huddletab-{}", Uuid::new_v4());
    let mut body = Vec::new();
    if let Some(client_attachment_id) = client_attachment_id {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"clientAttachmentId\"\r\n\r\n{client_attachment_id}\r\n").as_bytes());
    }
    if let Some(file) = file {
        body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"receipt.png\"\r\nContent-Type: image/png\r\n\r\n").as_bytes());
        body.extend_from_slice(&file);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

fn session_cookie(session: &SessionToken) -> String {
    format!("huddletab_session={}", session.expose_for_cookie())
}

fn png_1_by_1() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(RgbaImage::new(1, 1))
        .write_to(&mut bytes, ImageFormat::Png)
        .expect("测试图片应可编码");
    bytes.into_inner()
}
