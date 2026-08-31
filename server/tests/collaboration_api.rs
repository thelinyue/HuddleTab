use axum::{
    body::Body,
    http::{
        Request, StatusCode,
        header::{CONTENT_TYPE, COOKIE, ORIGIN, SET_COOKIE},
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
use serde_json::Value;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use tower::ServiceExt as _;
use uuid::Uuid;

struct TestActor {
    user_id: Uuid,
    display_name: &'static str,
    session: SessionToken,
    csrf: CsrfToken,
}

async fn seed_actor(
    pool: &PgPool,
    secret: &AppSecret,
    username: &'static str,
    display_name: &'static str,
) -> TestActor {
    let user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, $2, 'unused', $3, $4, $4)",
    )
    .bind(user_id)
    .bind(username)
    .bind(display_name)
    .bind(now)
    .execute(pool)
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
    .execute(pool)
    .await
    .expect("应插入测试 Session");
    let csrf = CsrfToken::mint(secret, CsrfContext::Session(&session_hash));
    TestActor {
        user_id,
        display_name,
        session,
        csrf,
    }
}

async fn seed_activity(pool: &PgPool, owner: &TestActor) -> (Uuid, Uuid) {
    let activity_id = Uuid::new_v4();
    let owner_member_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let mut transaction = pool.begin().await.expect("应开启事务");
    sqlx::query(
        "INSERT INTO activities (id, name, base_currency, owner_member_id, \
         created_by_user_id, created_at, updated_at) VALUES ($1, 'Tokyo Trip', 'JPY', $2, $3, $4, $4)",
    )
    .bind(activity_id)
    .bind(owner_member_id)
    .bind(owner.user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动");
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) \
         VALUES ($1, $2, $3, $4, 'OWNER', $5)",
    )
    .bind(owner_member_id)
    .bind(activity_id)
    .bind(owner.user_id)
    .bind(owner.display_name)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入 Owner member");
    transaction.commit().await.expect("应提交活动事务");
    (activity_id, owner_member_id)
}

fn authenticated_request(
    actor: &TestActor,
    method: &str,
    uri: String,
    body: &'static str,
) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .header(
            COOKIE,
            format!("huddletab_session={}", actor.session.expose_for_cookie()),
        )
        .header(ORIGIN, "http://localhost:5660")
        .header("sec-fetch-site", "same-origin")
        .header("x-csrf-token", actor.csrf.expose_for_header())
        .body(Body::from(body))
        .expect("请求应可构造")
}

async fn json_response(app: &axum::Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.expect("router 应响应");
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

async fn register_invited_actor(
    app: &axum::Router,
    secret: &AppSecret,
    invitation_token: &str,
) -> TestActor {
    let pre_auth = SessionToken::generate();
    let csrf = CsrfToken::mint(secret, CsrfContext::PreAuth(pre_auth.expose_for_cookie()));
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/register")
                .header(CONTENT_TYPE, "application/json")
                .header(
                    COOKIE,
                    format!("huddletab_pre_auth={}", pre_auth.expose_for_cookie()),
                )
                .header(ORIGIN, "http://localhost:5660")
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", csrf.expose_for_header())
                .body(Body::from(format!(
                    r#"{{"username":"bob","password":"correct horse battery staple","displayName":"Bob","invitationToken":"{invitation_token}"}}"#
                )))
                .expect("注册请求应可构造"),
        )
        .await
        .expect("router 应响应");
    assert_eq!(response.status(), StatusCode::CREATED);
    let session_cookie = response
        .headers()
        .get_all(SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .find(|value| value.starts_with("huddletab_session="))
        .expect("注册成功应设置 Session cookie");
    let raw_session = session_cookie
        .split(';')
        .next()
        .and_then(|pair| pair.strip_prefix("huddletab_session="))
        .expect("Session cookie 应包含 token");
    let session = SessionToken::parse(raw_session).expect("注册 Session token 应合法");
    let csrf = CsrfToken::mint(secret, CsrfContext::Session(&session.sha256_hash()));
    TestActor {
        user_id: Uuid::nil(),
        display_name: "Bob",
        session,
        csrf,
    }
}

async fn assert_collaboration_side_effects(pool: &PgPool, activity_id: Uuid) {
    let stored = sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT a.revision, \
         (SELECT count(*) FROM activity_members m WHERE m.activity_id = a.id), \
         (SELECT count(*) FROM activity_audit_logs l WHERE l.activity_id = a.id) \
         FROM activities a WHERE a.id = $1",
    )
    .bind(activity_id)
    .fetch_one(pool)
    .await
    .expect("应读取协作副作用");
    assert_eq!(stored, (5, 3, 4));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 该用例验证完整邀请生命周期，保持顺序展开比拆成隐藏副作用的测试辅助函数更易排查。
#[allow(clippy::too_many_lines)]
async fn owner_can_add_guest_and_invite_a_user_into_the_activity() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let secret = AppSecret::from_bytes([17; 32]);
    let owner = seed_actor(&pool, &secret, "alice", "Alice").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    let app = router_with_state(
        None,
        AppState::new(
            pool.clone(),
            secret.clone(),
            "http://localhost:5660".to_owned(),
        ),
    );

    let (status, guest) = json_response(
        &app,
        authenticated_request(
            &owner,
            "POST",
            format!("/api/activities/{activity_id}/members/guests"),
            r#"{"displayName":"小林"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(guest["data"]["displayName"], "小林");
    assert!(guest["data"]["userId"].is_null());

    let (status, invitation) = json_response(
        &app,
        authenticated_request(
            &owner,
            "POST",
            format!("/api/activities/{activity_id}/invitations"),
            r#"{"kind":"DIRECT","targetUsername":"bob","maxUses":1}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let invitation_id = invitation["data"]["invitationId"]
        .as_str()
        .expect("应返回 invitationId");
    let token = invitation["data"]["token"]
        .as_str()
        .expect("创建时应返回一次明文 token");

    let (status, invitations) = json_response(
        &app,
        authenticated_request(
            &owner,
            "GET",
            format!("/api/activities/{activity_id}/invitations"),
            "",
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(invitations["data"].as_array().map(Vec::len), Some(1));
    assert!(invitations["data"][0].get("token").is_none());

    let (status, preview) = json_response(
        &app,
        Request::builder()
            .uri(format!("/api/invitations/{token}"))
            .body(Body::empty())
            .expect("预览请求应可构造"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(preview["data"]["activityName"], "Tokyo Trip");
    assert_eq!(preview["data"]["activeMemberCount"], 2);

    let joining_user = register_invited_actor(&app, &secret, token).await;

    let (status, joined) = json_response(
        &app,
        authenticated_request(
            &joining_user,
            "POST",
            format!("/api/invitations/{token}/join"),
            "{}",
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(joined["data"]["status"], "JOINED");
    assert_eq!(joined["data"]["activityId"], activity_id.to_string());

    let (status, activities) = json_response(
        &app,
        authenticated_request(&joining_user, "GET", "/api/activities".to_owned(), ""),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(activities["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(activities["data"][0]["activityId"], activity_id.to_string());
    assert_eq!(activities["data"][0]["currentMemberRole"], "MEMBER");

    let (status, activity) = json_response(
        &app,
        authenticated_request(&owner, "GET", format!("/api/activities/{activity_id}"), ""),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(activity["data"]["name"], "Tokyo Trip");
    assert_eq!(activity["data"]["currentMemberRole"], "OWNER");

    let (status, members) = json_response(
        &app,
        authenticated_request(
            &owner,
            "GET",
            format!("/api/activities/{activity_id}/members"),
            "",
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(members["data"].as_array().map(Vec::len), Some(3));
    assert_eq!(members["data"][0]["role"], "OWNER");
    assert!(members["data"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item["displayName"] == "小林" && item["userId"].is_null())
    }));

    let (status, revoked) = json_response(
        &app,
        authenticated_request(
            &owner,
            "DELETE",
            format!("/api/activities/{activity_id}/invitations/{invitation_id}"),
            "",
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(revoked["data"]["revokedAt"].is_string());

    assert_collaboration_side_effects(&pool, activity_id).await;
}
