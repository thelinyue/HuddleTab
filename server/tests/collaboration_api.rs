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
use sqlx::{PgPool, postgres::PgPoolOptions};
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
        "INSERT INTO activities (id, name, base_currency, start_date, owner_member_id, \
         created_by_user_id, created_at, updated_at) \
         VALUES ($1, 'Tokyo Trip', 'JPY', '2026-08-30', $2, $3, $4, $4)",
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

#[tokio::test]
async fn anonymous_join_attempts_share_the_invitation_ip_limit_with_previews() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgresql://unused:unused@127.0.0.1/unused")
        .expect("测试应创建 lazy pool");
    let app = router_with_state(
        None,
        AppState::new(
            pool,
            AppSecret::from_bytes([17; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );

    for request_index in 0..30 {
        let request = if request_index % 2 == 0 {
            Request::builder()
                .uri("/api/invitations/unused")
                .body(Body::empty())
                .expect("预览请求应可构造")
        } else {
            Request::builder()
                .method("POST")
                .uri("/api/invitations/unused/join")
                .body(Body::empty())
                .expect("未认证 join 请求应可构造")
        };
        let response = app.clone().oneshot(request).await.expect("router 应响应");
        let expected = if request_index % 2 == 0 {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::FORBIDDEN
        };
        assert_eq!(response.status(), expected);
    }

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/invitations/unused")
                .body(Body::empty())
                .expect("第 31 个邀请请求应可构造"),
        )
        .await
        .expect("router 应响应");
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

async fn register_invited_actor(
    app: &axum::Router,
    secret: &AppSecret,
    invitation_token: &str,
) -> TestActor {
    register_named_invited_actor(app, secret, invitation_token, "bob", "Bob").await
}

async fn register_named_invited_actor(
    app: &axum::Router,
    secret: &AppSecret,
    invitation_token: &str,
    username: &'static str,
    display_name: &'static str,
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
                    r#"{{"username":"{username}","password":"correct horse battery staple","displayName":"{display_name}","invitationToken":"{invitation_token}"}}"#
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
    assert!(session_cookie.contains("Max-Age=7776000"));
    let raw_session = session_cookie
        .split(';')
        .next()
        .and_then(|pair| pair.strip_prefix("huddletab_session="))
        .expect("Session cookie 应包含 token");
    let session = SessionToken::parse(raw_session).expect("注册 Session token 应合法");
    let csrf = CsrfToken::mint(secret, CsrfContext::Session(&session.sha256_hash()));
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取注册响应")
        .to_bytes();
    let json: Value = serde_json::from_slice(&body).expect("注册响应应为 JSON");
    TestActor {
        user_id: Uuid::parse_str(
            json["data"]["userId"]
                .as_str()
                .expect("注册响应应包含 userId"),
        )
        .expect("注册 userId 应为 UUID"),
        display_name,
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

async fn create_link_invitation(
    app: &axum::Router,
    owner: &TestActor,
    activity_id: Uuid,
) -> String {
    let (status, invitation) = json_response(
        app,
        authenticated_request(
            owner,
            "POST",
            format!("/api/activities/{activity_id}/invitations"),
            r#"{"kind":"LINK","targetUsername":null,"maxUses":null}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    invitation["data"]["token"]
        .as_str()
        .expect("创建邀请应返回一次明文 token")
        .to_owned()
}

async fn assert_pending_join_side_effects(
    pool: &PgPool,
    activity_id: Uuid,
    expected_revision: i64,
) {
    let state = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64)>(
        "SELECT a.revision,
         (SELECT count(*) FROM activity_members WHERE activity_id = a.id),
         (SELECT count(*) FROM activity_join_requests WHERE activity_id = a.id),
         (SELECT count(*) FROM notifications WHERE activity_id = a.id),
         (SELECT count(*) FROM activity_audit_logs WHERE activity_id = a.id),
         (SELECT sum(use_count) FROM activity_invites WHERE activity_id = a.id)
         FROM activities a WHERE a.id = $1",
    )
    .bind(activity_id)
    .fetch_one(pool)
    .await
    .expect("应读取 Pending join 副作用");
    assert_eq!(state, (expected_revision, 1, 1, 1, 2, 0));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn guest_binding_invitation_creation_requires_owner_and_active_guest() {
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
    let member = seed_actor(&pool, &secret, "carol", "Carol").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    let formal_member_id = Uuid::new_v4();
    let left_guest_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) \
         VALUES ($1, $2, $3, 'Carol', 'MEMBER', NOW()), \
                ($4, $2, NULL, '已退出临时成员', 'MEMBER', NOW())",
    )
    .bind(formal_member_id)
    .bind(activity_id)
    .bind(member.user_id)
    .bind(left_guest_id)
    .execute(&pool)
    .await
    .expect("应插入测试成员");
    sqlx::query("UPDATE activity_members SET status = 'LEFT', left_at = NOW() WHERE id = $1")
        .bind(left_guest_id)
        .execute(&pool)
        .await
        .expect("应将测试 Guest 设为 LEFT");
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );

    let (guest_status, guest) = json_response(
        &app,
        authenticated_request(
            &owner,
            "POST",
            format!("/api/activities/{activity_id}/members/guests"),
            r#"{"displayName":"原临时昵称"}"#,
        ),
    )
    .await;
    assert_eq!(guest_status, StatusCode::CREATED);
    let guest_member_id = guest["data"]["memberId"]
        .as_str()
        .expect("应返回 Guest member ID");
    let binding_uri =
        format!("/api/activities/{activity_id}/members/{guest_member_id}/binding-invitations");

    let (created_status, created) = json_response(
        &app,
        authenticated_request(
            &owner,
            "POST",
            binding_uri.clone(),
            r#"{"targetUsername":"bob"}"#,
        ),
    )
    .await;
    assert_eq!(created_status, StatusCode::CREATED);
    assert_eq!(created["data"]["purpose"], "GUEST_BINDING");
    assert_eq!(created["data"]["guestMemberId"], guest_member_id);
    assert_eq!(created["data"]["kind"], "DIRECT");
    assert_eq!(created["data"]["targetUsername"], "bob");
    assert_eq!(created["data"]["maxUses"], 1);
    assert_eq!(created["data"]["useCount"], 0);
    assert_eq!(created["data"]["revision"], "3");
    assert!(
        created["data"]["token"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
    );

    let stored = sqlx::query_as::<_, (Option<Uuid>, i64, i64)>(
        "SELECT invite.guest_member_id, activity.revision,
         (SELECT count(*) FROM activity_audit_logs
          WHERE activity_id = activity.id AND action = 'INVITATION_CREATED')
         FROM activity_invites invite
         JOIN activities activity ON activity.id = invite.activity_id
         WHERE invite.id = $1",
    )
    .bind(
        Uuid::parse_str(
            created["data"]["invitationId"]
                .as_str()
                .expect("应返回 invitation ID"),
        )
        .expect("invitation ID 应为 UUID"),
    )
    .fetch_one(&pool)
    .await
    .expect("应读取绑定邀请");
    assert_eq!(
        stored,
        (Some(Uuid::parse_str(guest_member_id).unwrap()), 3, 1)
    );

    let (member_status, _) = json_response(
        &app,
        authenticated_request(
            &member,
            "POST",
            binding_uri.clone(),
            r#"{"targetUsername":"bob"}"#,
        ),
    )
    .await;
    assert_eq!(member_status, StatusCode::FORBIDDEN);

    for invalid_member_id in [Uuid::new_v4(), formal_member_id, left_guest_id] {
        let (status, body) = json_response(
            &app,
            authenticated_request(
                &owner,
                "POST",
                format!(
                    "/api/activities/{activity_id}/members/{invalid_member_id}/binding-invitations"
                ),
                r#"{"targetUsername":"bob"}"#,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"]["code"], "GUEST_NOT_FOUND");
    }

    let (invalid_username_status, _) = json_response(
        &app,
        authenticated_request(
            &owner,
            "POST",
            binding_uri.clone(),
            r#"{"targetUsername":"??"}"#,
        ),
    )
    .await;
    assert_eq!(invalid_username_status, StatusCode::BAD_REQUEST);

    sqlx::query("UPDATE activities SET status = 'ENDED' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应结束活动");
    let (ended_status, _) = json_response(
        &app,
        authenticated_request(&owner, "POST", binding_uri, r#"{"targetUsername":"bob"}"#),
    )
    .await;
    assert_eq!(ended_status, StatusCode::FORBIDDEN);
}

async fn create_binding_guest(app: &axum::Router, owner: &TestActor, activity_id: Uuid) -> Uuid {
    let (status, guest) = json_response(
        app,
        authenticated_request(
            owner,
            "POST",
            format!("/api/activities/{activity_id}/members/guests"),
            r#"{"displayName":"原临时昵称"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    Uuid::parse_str(
        guest["data"]["memberId"]
            .as_str()
            .expect("应返回 Guest member ID"),
    )
    .expect("Guest member ID 应为 UUID")
}

async fn create_binding_token(
    app: &axum::Router,
    owner: &TestActor,
    activity_id: Uuid,
    guest_member_id: Uuid,
    request_body: &'static str,
) -> String {
    let (status, invitation) = json_response(
        app,
        authenticated_request(
            owner,
            "POST",
            format!("/api/activities/{activity_id}/members/{guest_member_id}/binding-invitations"),
            request_body,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    invitation["data"]["token"]
        .as_str()
        .expect("创建绑定邀请应返回 token")
        .to_owned()
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn guest_binding_preserves_identity_bypasses_approval_and_replays_once() {
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
    let (activity_id, owner_member_id) = seed_activity(&pool, &owner).await;
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应开启加入审批");
    let app = router_with_state(
        None,
        AppState::new(
            pool.clone(),
            secret.clone(),
            "http://localhost:5660".to_owned(),
        ),
    );
    let guest_member_id = create_binding_guest(&app, &owner, activity_id).await;
    let now = OffsetDateTime::now_utc();
    let expense_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO expenses (id, activity_id, created_by_user_id, client_mutation_id, title,
         category, occurred_at, original_currency, original_amount_minor, base_currency,
         base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, created_at, updated_at)
         VALUES ($1, $2, $3, $4, '绑定前账单', 'OTHER', $5, 'JPY', 100, 'JPY', 100,
                 'IDENTITY', 1, 'EXACT', $5, $5)",
    )
    .bind(expense_id)
    .bind(activity_id)
    .bind(owner.user_id)
    .bind(Uuid::new_v4())
    .bind(now)
    .execute(&pool)
    .await
    .expect("应插入历史 Expense");
    sqlx::query(
        "INSERT INTO expense_payments (id, activity_id, expense_id, payer_member_id,
         original_currency, original_amount_minor, base_currency, base_amount_minor)
         VALUES ($1, $2, $3, $4, 'JPY', 100, 'JPY', 100)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(expense_id)
    .bind(guest_member_id)
    .execute(&pool)
    .await
    .expect("应插入 Guest 付款事实");
    sqlx::query(
        "INSERT INTO expense_shares (id, activity_id, expense_id, member_id,
         original_currency, original_amount_minor, base_currency, base_amount_minor)
         VALUES ($1, $2, $3, $4, 'JPY', 100, 'JPY', 100)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(expense_id)
    .bind(guest_member_id)
    .execute(&pool)
    .await
    .expect("应插入 Guest 分摊事实");
    sqlx::query(
        "INSERT INTO settlements (id, activity_id, created_by_user_id, client_mutation_id,
         payer_member_id, receiver_member_id, currency, amount_minor, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'JPY', 20, $7, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(owner.user_id)
    .bind(Uuid::new_v4())
    .bind(guest_member_id)
    .bind(owner_member_id)
    .bind(now)
    .execute(&pool)
    .await
    .expect("应插入 Guest Settlement");

    let token = create_binding_token(
        &app,
        &owner,
        activity_id,
        guest_member_id,
        r#"{"targetUsername":"bob"}"#,
    )
    .await;
    let (preview_status, preview) = json_response(
        &app,
        Request::builder()
            .uri(format!("/api/invitations/{token}"))
            .body(Body::empty())
            .expect("预览请求应可构造"),
    )
    .await;
    assert_eq!(preview_status, StatusCode::OK);
    assert_eq!(preview["data"]["purpose"], "GUEST_BINDING");
    assert_eq!(
        preview["data"]["guestMemberId"],
        guest_member_id.to_string()
    );
    assert_eq!(preview["data"]["guestDisplayName"], "原临时昵称");

    let target = register_named_invited_actor(&app, &secret, &token, "bob", "Bob").await;
    for expected_status in ["BOUND", "ALREADY_BOUND"] {
        let (status, bound) = json_response(
            &app,
            authenticated_request(
                &target,
                "POST",
                format!("/api/invitations/{token}/join"),
                "{}",
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(bound["data"]["status"], expected_status);
        assert_eq!(bound["data"]["memberId"], guest_member_id.to_string());
        assert_eq!(bound["data"]["revision"], "4");
    }

    let member = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, i64)>(
        "SELECT id, user_id, display_name, version FROM activity_members WHERE id = $1",
    )
    .bind(guest_member_id)
    .fetch_one(&pool)
    .await
    .expect("原 Guest 应仍存在");
    assert_eq!(
        member,
        (
            guest_member_id,
            Some(target.user_id),
            "原临时昵称".to_owned(),
            2,
        )
    );
    let side_effects = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64)>(
        "SELECT activity.revision,
         (SELECT count(*) FROM activity_join_requests WHERE activity_id = activity.id),
         (SELECT count(*) FROM activity_audit_logs
          WHERE activity_id = activity.id AND action = 'MEMBER_GUEST_BOUND'),
         (SELECT sum(use_count) FROM activity_invites WHERE activity_id = activity.id),
         (SELECT count(*) FROM expense_payments WHERE payer_member_id = $2),
         (SELECT count(*) FROM expense_shares WHERE member_id = $2)
         FROM activities activity WHERE activity.id = $1",
    )
    .bind(activity_id)
    .bind(guest_member_id)
    .fetch_one(&pool)
    .await
    .expect("应读取绑定副作用");
    assert_eq!(side_effects, (4, 0, 1, 1, 1, 1));
    let settlement_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM settlements WHERE payer_member_id = $1 OR receiver_member_id = $1",
    )
    .bind(guest_member_id)
    .fetch_one(&pool)
    .await
    .expect("应读取 Settlement 引用");
    assert_eq!(settlement_count, 1);

    let (activities_status, activities) = json_response(
        &app,
        authenticated_request(&target, "GET", "/api/activities".to_owned(), ""),
    )
    .await;
    assert_eq!(activities_status, StatusCode::OK);
    assert!(activities["data"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|activity| activity["activityId"] == activity_id.to_string())
    }));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn guest_binding_rejects_existing_member_and_wrong_target() {
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
    let existing = seed_actor(&pool, &secret, "bob", "Bob").await;
    let wrong_target = seed_actor(&pool, &secret, "carol", "Carol").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at)
         VALUES ($1, $2, $3, 'Bob', 'MEMBER', NOW())",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(existing.user_id)
    .execute(&pool)
    .await
    .expect("应插入现有成员");
    let app = router_with_state(
        None,
        AppState::new(pool, secret, "http://localhost:5660".to_owned()),
    );
    let guest_member_id = create_binding_guest(&app, &owner, activity_id).await;
    let token = create_binding_token(
        &app,
        &owner,
        activity_id,
        guest_member_id,
        r#"{"targetUsername":"bob"}"#,
    )
    .await;

    let (wrong_status, wrong) = json_response(
        &app,
        authenticated_request(
            &wrong_target,
            "POST",
            format!("/api/invitations/{token}/join"),
            "{}",
        ),
    )
    .await;
    assert_eq!(wrong_status, StatusCode::NOT_FOUND);
    assert_eq!(wrong["error"]["code"], "INVALID_INVITATION");

    let (conflict_status, conflict) = json_response(
        &app,
        authenticated_request(
            &existing,
            "POST",
            format!("/api/invitations/{token}/join"),
            "{}",
        ),
    )
    .await;
    assert_eq!(conflict_status, StatusCode::CONFLICT);
    assert_eq!(conflict["error"]["code"], "GUEST_BINDING_CONFLICT");
    assert_eq!(
        conflict["error"]["message"],
        "你已是该活动成员，无法绑定另一个临时成员。"
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn guest_binding_concurrent_confirmations_have_one_winner() {
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
    let first_target = seed_actor(&pool, &secret, "bob", "Bob").await;
    let second_target = seed_actor(&pool, &secret, "carol", "Carol").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    let guest_member_id = create_binding_guest(&app, &owner, activity_id).await;
    let first_token = create_binding_token(
        &app,
        &owner,
        activity_id,
        guest_member_id,
        r#"{"targetUsername":"bob"}"#,
    )
    .await;
    let second_token = create_binding_token(
        &app,
        &owner,
        activity_id,
        guest_member_id,
        r#"{"targetUsername":"carol"}"#,
    )
    .await;
    let first_request = authenticated_request(
        &first_target,
        "POST",
        format!("/api/invitations/{first_token}/join"),
        "{}",
    );
    let second_request = authenticated_request(
        &second_target,
        "POST",
        format!("/api/invitations/{second_token}/join"),
        "{}",
    );

    let (first, second) = tokio::join!(
        json_response(&app, first_request),
        json_response(&app, second_request)
    );
    let statuses = [first.0, second.0];
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == StatusCode::NOT_FOUND)
            .count(),
        1
    );
    let winner = [&first, &second]
        .into_iter()
        .find(|response| response.0 == StatusCode::OK)
        .expect("应有一个绑定成功");
    assert_eq!(winner.1["data"]["status"], "BOUND");
    assert_eq!(winner.1["data"]["memberId"], guest_member_id.to_string());
    let loser = [&first, &second]
        .into_iter()
        .find(|response| response.0 == StatusCode::NOT_FOUND)
        .expect("应有一个绑定失败");
    assert_eq!(loser.1["error"]["code"], "INVALID_INVITATION");

    let stored = sqlx::query_as::<_, (Option<Uuid>, i64, i64, i64)>(
        "SELECT member.user_id, activity.revision,
         (SELECT count(*) FROM activity_audit_logs
          WHERE activity_id = activity.id AND action = 'MEMBER_GUEST_BOUND'),
         (SELECT sum(use_count) FROM activity_invites WHERE activity_id = activity.id)
         FROM activity_members member
         JOIN activities activity ON activity.id = member.activity_id
         WHERE member.id = $1",
    )
    .bind(guest_member_id)
    .fetch_one(&pool)
    .await
    .expect("应读取竞争结果");
    assert!(stored.0 == Some(first_target.user_id) || stored.0 == Some(second_target.user_id));
    assert_eq!((stored.1, stored.2, stored.3), (5, 1, 1));
}

async fn create_pending_join_request(
    app: &axum::Router,
    owner: &TestActor,
    applicant: &TestActor,
    activity_id: Uuid,
) -> Uuid {
    let token = create_link_invitation(app, owner, activity_id).await;
    let (status, joined) = json_response(
        app,
        authenticated_request(
            applicant,
            "POST",
            format!("/api/invitations/{token}/join"),
            "{}",
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    Uuid::parse_str(
        joined["data"]["requestId"]
            .as_str()
            .expect("Pending 应返回 requestId"),
    )
    .expect("requestId 应为 UUID")
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn join_request_authorization_limits_owner_queue_and_applicant_status() {
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
    let applicant = seed_actor(&pool, &secret, "bob", "Bob").await;
    let member = seed_actor(&pool, &secret, "carol", "Carol").await;
    let outsider = seed_actor(&pool, &secret, "dave", "Dave").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应开启加入审批");
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) \
         VALUES ($1, $2, $3, $4, 'MEMBER', now())",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(member.user_id)
    .bind(member.display_name)
    .execute(&pool)
    .await
    .expect("应插入普通成员");
    let app = router_with_state(
        None,
        AppState::new(pool, secret, "http://localhost:5660".to_owned()),
    );
    let request_id = create_pending_join_request(&app, &owner, &applicant, activity_id).await;

    let (owner_status, queue) = json_response(
        &app,
        authenticated_request(
            &owner,
            "GET",
            format!("/api/activities/{activity_id}/join-requests"),
            "",
        ),
    )
    .await;
    assert_eq!(owner_status, StatusCode::OK);
    assert_eq!(queue["data"].as_array().map(Vec::len), Some(1));
    assert_eq!(queue["data"][0]["requestId"], request_id.to_string());
    assert_eq!(queue["data"][0]["applicantDisplayName"], "Bob");
    assert_eq!(queue["data"][0]["status"], "PENDING");

    let (member_status, _) = json_response(
        &app,
        authenticated_request(
            &member,
            "GET",
            format!("/api/activities/{activity_id}/join-requests"),
            "",
        ),
    )
    .await;
    assert_eq!(member_status, StatusCode::FORBIDDEN);

    let (member_decision_status, _) = json_response(
        &app,
        authenticated_request(
            &member,
            "POST",
            format!("/api/activities/{activity_id}/join-requests/{request_id}"),
            r#"{"decision":"APPROVE"}"#,
        ),
    )
    .await;
    assert_eq!(member_decision_status, StatusCode::FORBIDDEN);

    let (self_status, own_request) = json_response(
        &app,
        authenticated_request(
            &applicant,
            "GET",
            format!("/api/join-requests/{request_id}"),
            "",
        ),
    )
    .await;
    assert_eq!(self_status, StatusCode::OK);
    assert_eq!(own_request["data"]["requestId"], request_id.to_string());
    assert_eq!(own_request["data"]["status"], "PENDING");

    let (other_status, other_body) = json_response(
        &app,
        authenticated_request(
            &outsider,
            "GET",
            format!("/api/join-requests/{request_id}"),
            "",
        ),
    )
    .await;
    assert_eq!(other_status, StatusCode::NOT_FOUND);
    assert_eq!(other_body["error"]["code"], "NOT_FOUND");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn join_decision_approve_is_idempotent_and_opposite_decision_conflicts() {
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
    let applicant = seed_actor(&pool, &secret, "bob", "Bob").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应开启加入审批");
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    let request_id = create_pending_join_request(&app, &owner, &applicant, activity_id).await;
    let decision_uri = format!("/api/activities/{activity_id}/join-requests/{request_id}");

    for _ in 0..2 {
        let (status, decided) = json_response(
            &app,
            authenticated_request(
                &owner,
                "POST",
                decision_uri.clone(),
                r#"{"decision":"APPROVE"}"#,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(decided["data"]["status"], "APPROVED");
        assert_eq!(decided["data"]["revision"], "4");
    }

    let state = sqlx::query_as::<_, (i64, i64, i64, i64, i64, i64)>(
        "SELECT a.revision,
         (SELECT count(*) FROM activity_members m
          WHERE m.activity_id = a.id AND m.user_id = $2 AND m.status = 'ACTIVE'),
         (SELECT sum(use_count) FROM activity_invites WHERE activity_id = a.id),
         (SELECT count(*) FROM notifications
          WHERE activity_id = a.id AND type = 'JOIN_APPROVAL_RESOLVED'),
         (SELECT count(*) FROM activity_audit_logs
          WHERE activity_id = a.id AND action = 'JOIN_REQUEST_APPROVED'),
         (SELECT count(*) FROM activity_join_requests
          WHERE activity_id = a.id AND status = 'APPROVED')
         FROM activities a WHERE a.id = $1",
    )
    .bind(activity_id)
    .bind(applicant.user_id)
    .fetch_one(&pool)
    .await
    .expect("应读取批准副作用");
    assert_eq!(state, (4, 1, 1, 1, 1, 1));

    let (conflict_status, conflict) = json_response(
        &app,
        authenticated_request(&owner, "POST", decision_uri, r#"{"decision":"REJECT"}"#),
    )
    .await;
    assert_eq!(conflict_status, StatusCode::CONFLICT);
    assert_eq!(conflict["error"]["code"], "JOIN_REQUEST_CLOSED");
    assert_eq!(conflict["error"]["message"], "加入申请已经处理。");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn join_decision_concurrent_approve_has_single_side_effect_set() {
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
    let applicant = seed_actor(&pool, &secret, "bob", "Bob").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应开启加入审批");
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    let request_id = create_pending_join_request(&app, &owner, &applicant, activity_id).await;
    let uri = format!("/api/activities/{activity_id}/join-requests/{request_id}");
    let first = authenticated_request(&owner, "POST", uri.clone(), r#"{"decision":"APPROVE"}"#);
    let second = authenticated_request(&owner, "POST", uri, r#"{"decision":"APPROVE"}"#);

    let (first_response, second_response) =
        tokio::join!(json_response(&app, first), json_response(&app, second));
    assert_eq!(first_response.0, StatusCode::OK);
    assert_eq!(second_response.0, StatusCode::OK);
    assert_eq!(first_response.1["data"]["status"], "APPROVED");
    assert_eq!(second_response.1["data"]["status"], "APPROVED");

    let state = sqlx::query_as::<_, (i64, i64, i64, i64, i64)>(
        "SELECT a.revision,
         (SELECT count(*) FROM activity_members m
          WHERE m.activity_id = a.id AND m.user_id = $2 AND m.status = 'ACTIVE'),
         (SELECT sum(use_count) FROM activity_invites WHERE activity_id = a.id),
         (SELECT count(*) FROM notifications
          WHERE activity_id = a.id AND type = 'JOIN_APPROVAL_RESOLVED'),
         (SELECT count(*) FROM activity_audit_logs
          WHERE activity_id = a.id AND action = 'JOIN_REQUEST_APPROVED')
         FROM activities a WHERE a.id = $1",
    )
    .bind(activity_id)
    .bind(applicant.user_id)
    .fetch_one(&pool)
    .await
    .expect("应读取并发批准副作用");
    assert_eq!(state, (4, 1, 1, 1, 1));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn join_decision_rejects_after_activity_ends_without_consuming_invitation() {
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
    let applicant = seed_actor(&pool, &secret, "bob", "Bob").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应开启加入审批");
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    let request_id = create_pending_join_request(&app, &owner, &applicant, activity_id).await;
    sqlx::query("UPDATE activities SET status = 'ENDED' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应结束活动");

    let (queue_status, queue) = json_response(
        &app,
        authenticated_request(
            &owner,
            "GET",
            format!("/api/activities/{activity_id}/join-requests"),
            "",
        ),
    )
    .await;
    assert_eq!(queue_status, StatusCode::OK);
    assert_eq!(queue["data"][0]["requestId"], request_id.to_string());

    let (status, rejected) = json_response(
        &app,
        authenticated_request(
            &owner,
            "POST",
            format!("/api/activities/{activity_id}/join-requests/{request_id}"),
            r#"{"decision":"REJECT"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(rejected["data"]["status"], "REJECTED");
    assert_eq!(rejected["data"]["revision"], "4");
    let state = sqlx::query_as::<_, (i64, i64, i64, i64)>(
        "SELECT
         (SELECT count(*) FROM activity_members
          WHERE activity_id = $1 AND user_id = $2 AND status = 'ACTIVE'),
         (SELECT sum(use_count) FROM activity_invites WHERE activity_id = $1),
         (SELECT count(*) FROM notifications
          WHERE activity_id = $1 AND type = 'JOIN_APPROVAL_RESOLVED'),
         (SELECT count(*) FROM activity_audit_logs
          WHERE activity_id = $1 AND action = 'JOIN_REQUEST_REJECTED')",
    )
    .bind(activity_id)
    .bind(applicant.user_id)
    .fetch_one(&pool)
    .await
    .expect("应读取拒绝副作用");
    assert_eq!(state, (0, 0, 1, 1));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn join_decision_approve_revalidates_activity_and_invitation() {
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
    let applicant = seed_actor(&pool, &secret, "bob", "Bob").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应开启加入审批");
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    let request_id = create_pending_join_request(&app, &owner, &applicant, activity_id).await;
    sqlx::query("UPDATE activities SET status = 'ENDED' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应结束活动");
    let uri = format!("/api/activities/{activity_id}/join-requests/{request_id}");

    let (ended_status, ended) = json_response(
        &app,
        authenticated_request(&owner, "POST", uri.clone(), r#"{"decision":"APPROVE"}"#),
    )
    .await;
    assert_eq!(ended_status, StatusCode::CONFLICT);
    assert_eq!(ended["error"]["code"], "ACTIVITY_NOT_JOINABLE");
    sqlx::query("UPDATE activities SET status = 'ACTIVE' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应恢复活动状态用于邀请校验");
    sqlx::query("UPDATE activity_invites SET revoked_at = now() WHERE activity_id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应撤销邀请");

    let (invite_status, invite) = json_response(
        &app,
        authenticated_request(&owner, "POST", uri, r#"{"decision":"APPROVE"}"#),
    )
    .await;
    assert_eq!(invite_status, StatusCode::CONFLICT);
    assert_eq!(invite["error"]["code"], "INVITATION_INVALID");
    assert_eq!(invite["error"]["message"], "邀请无效或已失效。");
    let state = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT request.status,
         (SELECT count(*) FROM activity_members
          WHERE activity_id = request.activity_id AND user_id = request.applicant_user_id),
         (SELECT sum(use_count) FROM activity_invites
          WHERE activity_id = request.activity_id),
         (SELECT count(*) FROM notifications
          WHERE activity_id = request.activity_id AND type = 'JOIN_APPROVAL_RESOLVED')
         FROM activity_join_requests request WHERE request.id = $1",
    )
    .bind(request_id)
    .fetch_one(&pool)
    .await
    .expect("应读取失败批准后的状态");
    assert_eq!(state, ("PENDING".to_owned(), 0, 0, 0));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn join_decision_existing_active_member_keeps_request_pending() {
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
    let applicant = seed_actor(&pool, &secret, "bob", "Bob").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应开启加入审批");
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    let request_id = create_pending_join_request(&app, &owner, &applicant, activity_id).await;
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at)
         VALUES ($1, $2, $3, $4, 'MEMBER', now())",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(applicant.user_id)
    .bind(applicant.display_name)
    .execute(&pool)
    .await
    .expect("应模拟申请后已成为成员");

    let (status, conflict) = json_response(
        &app,
        authenticated_request(
            &owner,
            "POST",
            format!("/api/activities/{activity_id}/join-requests/{request_id}"),
            r#"{"decision":"APPROVE"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(conflict["error"]["code"], "RESOURCE_CONFLICT");
    let stored = sqlx::query_as::<_, (String, i64, i64)>(
        "SELECT request.status,
         (SELECT sum(use_count) FROM activity_invites WHERE activity_id = request.activity_id),
         (SELECT count(*) FROM notifications
          WHERE activity_id = request.activity_id AND type = 'JOIN_APPROVAL_RESOLVED')
         FROM activity_join_requests request WHERE request.id = $1",
    )
    .bind(request_id)
    .fetch_one(&pool)
    .await
    .expect("应读取成员冲突后的状态");
    assert_eq!(stored, ("PENDING".to_owned(), 0, 0));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn join_request_replay_returns_same_pending_without_consuming_invite() {
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
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应开启加入审批");
    let app = router_with_state(
        None,
        AppState::new(
            pool.clone(),
            secret.clone(),
            "http://localhost:5660".to_owned(),
        ),
    );
    let token = create_link_invitation(&app, &owner, activity_id).await;
    let applicant = register_invited_actor(&app, &secret, &token).await;

    let mut request_ids = Vec::new();
    for _ in 0..2 {
        let (status, joined) = json_response(
            &app,
            authenticated_request(
                &applicant,
                "POST",
                format!("/api/invitations/{token}/join"),
                "{}",
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(joined["data"]["status"], "PENDING_APPROVAL");
        assert!(joined["data"]["memberId"].is_null());
        assert_eq!(joined["data"]["revision"], "3");
        request_ids.push(
            joined["data"]["requestId"]
                .as_str()
                .expect("Pending 应返回 requestId")
                .to_owned(),
        );
    }
    assert_eq!(request_ids[0], request_ids[1]);
    assert_pending_join_side_effects(&pool, activity_id, 3).await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn join_request_concurrent_submissions_create_one_pending() {
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
    let applicant = seed_actor(&pool, &secret, "carol", "Carol").await;
    let (activity_id, _) = seed_activity(&pool, &owner).await;
    sqlx::query("UPDATE activities SET invite_mode = 'REQUIRE_APPROVAL' WHERE id = $1")
        .bind(activity_id)
        .execute(&pool)
        .await
        .expect("应开启加入审批");
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    let token = create_link_invitation(&app, &owner, activity_id).await;
    let first = authenticated_request(
        &applicant,
        "POST",
        format!("/api/invitations/{token}/join"),
        "{}",
    );
    let second = authenticated_request(
        &applicant,
        "POST",
        format!("/api/invitations/{token}/join"),
        "{}",
    );

    let (first_response, second_response) =
        tokio::join!(json_response(&app, first), json_response(&app, second));
    assert_eq!(first_response.0, StatusCode::OK);
    assert_eq!(second_response.0, StatusCode::OK);
    assert_eq!(first_response.1["data"]["status"], "PENDING_APPROVAL");
    assert_eq!(second_response.1["data"]["status"], "PENDING_APPROVAL");
    assert_eq!(
        first_response.1["data"]["requestId"],
        second_response.1["data"]["requestId"]
    );
    assert_pending_join_side_effects(&pool, activity_id, 3).await;
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
    assert_eq!(guest["data"]["revision"], "2");

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
    assert_eq!(invitation["data"]["revision"], "3");
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
    assert_eq!(joined["data"]["revision"], "4");

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
    assert_eq!(revoked["data"]["revision"], "5");

    assert_collaboration_side_effects(&pool, activity_id).await;
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn ended_and_deleted_activities_reject_collaboration_mutations() {
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
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );

    for state_change in [
        "UPDATE activities SET status = 'ENDED' WHERE id = $1",
        "UPDATE activities SET status = 'ACTIVE', deleted_at = now(), \
         purge_after = now() + interval '30 days' WHERE id = $1",
    ] {
        sqlx::query(state_change)
            .bind(activity_id)
            .execute(&pool)
            .await
            .expect("应更新活动状态");
        let (guest_status, _) = json_response(
            &app,
            authenticated_request(
                &owner,
                "POST",
                format!("/api/activities/{activity_id}/members/guests"),
                r#"{"displayName":"小林"}"#,
            ),
        )
        .await;
        assert_eq!(guest_status, StatusCode::FORBIDDEN);
        let (invite_status, _) = json_response(
            &app,
            authenticated_request(
                &owner,
                "POST",
                format!("/api/activities/{activity_id}/invitations"),
                r#"{"kind":"LINK","targetUsername":null,"maxUses":null}"#,
            ),
        )
        .await;
        assert_eq!(invite_status, StatusCode::FORBIDDEN);
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn deleted_activity_rejects_invitation_registration_and_join() {
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

    let mut tokens = Vec::new();
    for _ in 0..2 {
        let (status, invitation) = json_response(
            &app,
            authenticated_request(
                &owner,
                "POST",
                format!("/api/activities/{activity_id}/invitations"),
                r#"{"kind":"LINK","targetUsername":null,"maxUses":null}"#,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        tokens.push(
            invitation["data"]["token"]
                .as_str()
                .expect("应返回邀请 token")
                .to_owned(),
        );
    }
    let joining_user = register_invited_actor(&app, &secret, &tokens[1]).await;

    sqlx::query(
        "UPDATE activities SET deleted_at = now(), purge_after = now() + interval '30 days' \
         WHERE id = $1",
    )
    .bind(activity_id)
    .execute(&pool)
    .await
    .expect("应软删除活动");

    let pre_auth = SessionToken::generate();
    let csrf = CsrfToken::mint(&secret, CsrfContext::PreAuth(pre_auth.expose_for_cookie()));
    let (status, registration) = json_response(
        &app,
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
                r#"{{"username":"carol","password":"correct horse battery staple","displayName":"Carol","invitationToken":"{}"}}"#,
                tokens[0]
            )))
            .expect("注册请求应可构造"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(registration["error"]["code"], "INVALID_INVITATION");

    let (status, joined) = json_response(
        &app,
        authenticated_request(
            &joining_user,
            "POST",
            format!("/api/invitations/{}/join", tokens[1]),
            "{}",
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(joined["error"]["code"], "INVALID_INVITATION");
}
