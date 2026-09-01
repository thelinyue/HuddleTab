use axum::{
    body::Body,
    http::{
        Request, StatusCode,
        header::{CONTENT_TYPE, COOKIE, ORIGIN},
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

async fn seed_authenticated_actor() -> (PgPool, axum::Router, SessionToken, CsrfToken, Uuid) {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
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

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 创建场景同时验证 Owner member、版本和 Audit 的同事务副作用，保持一个数据库事务验收场景。
#[allow(clippy::too_many_lines)]
async fn create_activity_atomically_creates_its_owner_member() {
    let (pool, app, session, csrf, user_id) = seed_authenticated_actor().await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/activities")
                .header(CONTENT_TYPE, "application/json")
                .header(
                    COOKIE,
                    format!("huddletab_session={}", session.expose_for_cookie()),
                )
                .header(ORIGIN, "http://localhost:5660")
                .header("sec-fetch-site", "same-origin")
                .header("x-csrf-token", csrf.expose_for_header())
                .body(Body::from(
                    r#"{"name":"Tokyo Trip","location":" Tokyo ","baseCurrency":"jpy","startDate":"2026-09-01","endDate":"2026-09-03"}"#,
                ))
                .expect("请求应可构造"),
        )
        .await
        .expect("router 应响应");

    assert_eq!(response.status(), StatusCode::CREATED);
    let body = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let json: Value = serde_json::from_slice(&body).expect("响应应为 JSON");
    let activity_id = Uuid::parse_str(
        json["data"]["activityId"]
            .as_str()
            .expect("应返回 activityId"),
    )
    .expect("activityId 应为 UUID");
    let owner_member_id = Uuid::parse_str(
        json["data"]["ownerMemberId"]
            .as_str()
            .expect("应返回 ownerMemberId"),
    )
    .expect("ownerMemberId 应为 UUID");
    assert_eq!(json["data"]["baseCurrency"], "JPY");
    assert_eq!(json["data"]["location"], "Tokyo");
    assert_eq!(json["data"]["startDate"], "2026-09-01");
    assert_eq!(json["data"]["endDate"], "2026-09-03");
    assert_eq!(json["data"]["version"], "1");
    assert_eq!(json["data"]["revision"], "1");
    assert_eq!(json["data"]["hasAccountingRecords"], false);
    assert_eq!(json["data"]["fieldPermissions"]["name"], true);
    assert_eq!(json["data"]["fieldPermissions"]["location"], true);
    assert_eq!(json["data"]["fieldPermissions"]["baseCurrency"], true);
    assert_eq!(json["data"]["fieldPermissions"]["startDate"], true);
    assert_eq!(json["data"]["fieldPermissions"]["endDate"], true);
    assert_eq!(
        json["data"]["allowedLifecycleActions"],
        serde_json::json!(["END"])
    );
    assert_eq!(json["data"]["canDelete"], true);
    assert_eq!(json["data"]["canRestore"], false);

    let stored = sqlx::query_as::<
        _,
        (
            Uuid,
            Uuid,
            String,
            String,
            Option<String>,
            String,
            Option<String>,
        ),
    >(
        "SELECT a.owner_member_id, m.user_id, m.role, m.display_name, a.location, \
         a.start_date::text, a.end_date::text \
         FROM activities a JOIN activity_members m \
         ON m.activity_id = a.id AND m.id = a.owner_member_id WHERE a.id = $1",
    )
    .bind(activity_id)
    .fetch_one(&pool)
    .await
    .expect("活动与 OWNER member 应同时持久化");
    assert_eq!(
        stored,
        (
            owner_member_id,
            user_id,
            "OWNER".into(),
            "Alice".into(),
            Some("Tokyo".into()),
            "2026-09-01".into(),
            Some("2026-09-03".into()),
        )
    );
    let audit = sqlx::query_as::<_, (String, String, Uuid, Uuid, Uuid, i64)>(
        "SELECT action, resource_type, resource_id, actor_user_id, actor_member_id, \
         activity_revision FROM activity_audit_logs WHERE activity_id = $1",
    )
    .bind(activity_id)
    .fetch_one(&pool)
    .await
    .expect("活动创建应写入初始 Audit");
    assert_eq!(
        audit,
        (
            "ACTIVITY_CREATED".into(),
            "ACTIVITY".into(),
            activity_id,
            user_id,
            owner_member_id,
            1,
        ),
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn owner_update_is_versioned_and_noop_has_no_side_effects() {
    let (pool, app, session, csrf, _) = seed_authenticated_actor().await;
    let created = create_activity(app.clone(), &session, &csrf).await;
    let activity_id = created["activityId"].as_str().expect("应返回 activityId");

    let (status, updated) = json_response(
        app.clone(),
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &format!("/api/activities/{activity_id}"),
            r#"{"version":"1","name":"  Tokyo 2026  ","location":"  Yokohama  ","startDate":"2026-09-02","endDate":null}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["data"]["name"], "Tokyo 2026");
    assert_eq!(updated["data"]["location"], "Yokohama");
    assert_eq!(updated["data"]["startDate"], "2026-09-02");
    assert!(updated["data"]["endDate"].is_null());
    assert_eq!(updated["data"]["version"], "2");
    assert_eq!(updated["data"]["revision"], "2");
    assert_eq!(updated["warnings"], serde_json::json!([]));

    let (status, unchanged) = json_response(
        app,
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &format!("/api/activities/{activity_id}"),
            r#"{"version":"2","location":"Yokohama"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unchanged["data"]["version"], "2");
    assert_eq!(unchanged["data"]["revision"], "2");

    let audit_actions = sqlx::query_scalar::<_, String>(
        "SELECT action FROM activity_audit_logs WHERE activity_id = $1 ORDER BY created_at, id",
    )
    .bind(Uuid::parse_str(activity_id).expect("activityId 应为 UUID"))
    .fetch_all(&pool)
    .await
    .expect("应读取活动 Audit");
    assert_eq!(
        audit_actions,
        vec!["ACTIVITY_CREATED".to_owned(), "ACTIVITY_UPDATED".to_owned()]
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn invite_mode_update_advances_once_and_noop_has_no_side_effects() {
    let (pool, app, session, csrf, _) = seed_authenticated_actor().await;
    let created = create_activity(app.clone(), &session, &csrf).await;
    let activity_id = created["activityId"].as_str().expect("应返回 activityId");
    assert_eq!(created["inviteMode"], "DIRECT_JOIN");
    assert_eq!(created["fieldPermissions"]["inviteMode"], true);

    let (status, updated) = json_response(
        app.clone(),
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &format!("/api/activities/{activity_id}"),
            r#"{"version":"1","inviteMode":"REQUIRE_APPROVAL"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["data"]["inviteMode"], "REQUIRE_APPROVAL");
    assert_eq!(updated["data"]["version"], "2");
    assert_eq!(updated["data"]["revision"], "2");

    let (status, unchanged) = json_response(
        app,
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &format!("/api/activities/{activity_id}"),
            r#"{"version":"2","inviteMode":"REQUIRE_APPROVAL"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unchanged["data"]["version"], "2");
    assert_eq!(unchanged["data"]["revision"], "2");

    let activity_id = Uuid::parse_str(activity_id).expect("activityId 应为 UUID");
    let stored = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT invite_mode, version, revision,
         (SELECT count(*) FROM activity_audit_logs WHERE activity_id = $1)
         FROM activities WHERE id = $1",
    )
    .bind(activity_id)
    .fetch_one(&pool)
    .await
    .expect("应读取邀请模式副作用");
    assert_eq!(stored, ("REQUIRE_APPROVAL".to_owned(), 2, 2, 2));
    let details: Value = sqlx::query_scalar(
        "SELECT details FROM activity_audit_logs
         WHERE activity_id = $1 AND action = 'ACTIVITY_UPDATED'",
    )
    .bind(activity_id)
    .fetch_one(&pool)
    .await
    .expect("邀请模式变化应写入 Audit 详情");
    assert_eq!(details["inviteMode"]["before"], "DIRECT_JOIN");
    assert_eq!(details["inviteMode"]["after"], "REQUIRE_APPROVAL");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 生命周期、删除与恢复共享同一活动版本链，单场景才能验证状态和乐观锁连续性。
#[allow(clippy::too_many_lines)]
async fn lifecycle_delete_and_restore_follow_the_frozen_state_machine() {
    let (pool, app, session, csrf, _) = seed_authenticated_actor().await;
    let created = create_activity(app.clone(), &session, &csrf).await;
    let activity_id = created["activityId"].as_str().expect("应返回 activityId");

    let actions = [
        ("END", "1", "ENDED", "2"),
        ("ARCHIVE", "2", "ARCHIVED", "3"),
    ];
    for (action, version, expected_status, expected_version) in actions {
        let (status, body) = json_response(
            app.clone(),
            authenticated_request(
                &session,
                &csrf,
                "POST",
                &format!("/api/activities/{activity_id}/lifecycle"),
                &format!(r#"{{"action":"{action}","version":"{version}"}}"#),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["data"]["status"], expected_status);
        assert_eq!(body["data"]["version"], expected_version);
        assert_eq!(body["data"]["revision"], expected_version);
    }

    let (status, body) = json_response(
        app.clone(),
        authenticated_request(
            &session,
            &csrf,
            "POST",
            &format!("/api/activities/{activity_id}/lifecycle"),
            r#"{"action":"ARCHIVE","version":"3"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "INVALID_ACTIVITY_TRANSITION");

    let (status, deleted) = json_response(
        app.clone(),
        authenticated_request(
            &session,
            &csrf,
            "DELETE",
            &format!("/api/activities/{activity_id}"),
            r#"{"version":"3"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(deleted["data"]["status"], "ARCHIVED");
    assert_eq!(deleted["data"]["version"], "4");
    assert_eq!(deleted["data"]["revision"], "4");
    assert!(deleted["data"]["deletedAt"].is_string());
    assert!(deleted["data"]["purgeAfter"].is_string());

    let (_, current) = json_response(
        app.clone(),
        authenticated_request(&session, &csrf, "GET", "/api/activities", ""),
    )
    .await;
    assert_eq!(current["data"], serde_json::json!([]));
    let (_, recycle) = json_response(
        app.clone(),
        authenticated_request(&session, &csrf, "GET", "/api/activities?view=deleted", ""),
    )
    .await;
    assert_eq!(recycle["data"].as_array().expect("应返回列表").len(), 1);

    let (status, restored) = json_response(
        app.clone(),
        authenticated_request(
            &session,
            &csrf,
            "POST",
            &format!("/api/activities/{activity_id}/restore"),
            r#"{"version":"4"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(restored["data"]["status"], "ARCHIVED");
    assert_eq!(restored["data"]["version"], "5");
    assert_eq!(restored["data"]["revision"], "5");
    assert!(restored["data"]["deletedAt"].is_null());

    for (action, version, expected_status, expected_version) in [
        ("UNARCHIVE", "5", "ENDED", "6"),
        ("REOPEN", "6", "ACTIVE", "7"),
    ] {
        let (status, body) = json_response(
            app.clone(),
            authenticated_request(
                &session,
                &csrf,
                "POST",
                &format!("/api/activities/{activity_id}/lifecycle"),
                &format!(r#"{{"action":"{action}","version":"{version}"}}"#),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["data"]["status"], expected_status);
        assert_eq!(body["data"]["version"], expected_version);
        assert_eq!(body["data"]["revision"], expected_version);
    }

    let actions = sqlx::query_scalar::<_, String>(
        "SELECT action FROM activity_audit_logs WHERE activity_id = $1 ORDER BY activity_revision",
    )
    .bind(Uuid::parse_str(activity_id).expect("activityId 应为 UUID"))
    .fetch_all(&pool)
    .await
    .expect("应读取生命周期 Audit");
    assert_eq!(
        actions,
        vec![
            "ACTIVITY_CREATED",
            "ACTIVITY_ENDED",
            "ACTIVITY_ARCHIVED",
            "ACTIVITY_DELETED",
            "ACTIVITY_RESTORED",
            "ACTIVITY_UNARCHIVED",
            "ACTIVITY_REOPENED",
        ]
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn expired_restore_returns_the_stable_restore_window_error() {
    let (pool, app, session, csrf, _) = seed_authenticated_actor().await;
    let created = create_activity(app.clone(), &session, &csrf).await;
    let activity_id = created["activityId"].as_str().expect("应返回 activityId");
    sqlx::query(
        "UPDATE activities SET deleted_at = now() - interval '31 days', \
         purge_after = now() - interval '1 day' WHERE id = $1",
    )
    .bind(Uuid::parse_str(activity_id).expect("activityId 应为 UUID"))
    .execute(&pool)
    .await
    .expect("应写入过期删除状态");

    let (status, body) = json_response(
        app,
        authenticated_request(
            &session,
            &csrf,
            "POST",
            &format!("/api/activities/{activity_id}/restore"),
            r#"{"version":"1"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "RESTORE_WINDOW_EXPIRED");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn ended_activity_rejects_field_updates_without_side_effects() {
    let (pool, app, session, csrf, _) = seed_authenticated_actor().await;
    let created = create_activity(app.clone(), &session, &csrf).await;
    let activity_id = created["activityId"].as_str().expect("应返回 activityId");
    let (status, _) = json_response(
        app.clone(),
        authenticated_request(
            &session,
            &csrf,
            "POST",
            &format!("/api/activities/{activity_id}/lifecycle"),
            r#"{"action":"END","version":"1"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = json_response(
        app,
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &format!("/api/activities/{activity_id}"),
            r#"{"version":"2","name":"Cannot update"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "ACTIVITY_FIELD_LOCKED");
    let state = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT name, version, revision, \
         (SELECT count(*) FROM activity_audit_logs WHERE activity_id = $1) \
         FROM activities WHERE id = $1",
    )
    .bind(Uuid::parse_str(activity_id).expect("activityId 应为 UUID"))
    .fetch_one(&pool)
    .await
    .expect("应读取活动副作用");
    assert_eq!(state, ("Tokyo Trip".to_owned(), 2, 2, 2));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn stale_activity_version_returns_stable_conflict_without_extra_audit() {
    let (pool, app, session, csrf, _) = seed_authenticated_actor().await;
    let created = create_activity(app.clone(), &session, &csrf).await;
    let activity_id = created["activityId"].as_str().expect("应返回 activityId");
    let uri = format!("/api/activities/{activity_id}");
    let (status, _) = json_response(
        app.clone(),
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &uri,
            r#"{"version":"1","location":"Osaka"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = json_response(
        app,
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &uri,
            r#"{"version":"1","location":"Kyoto"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "VERSION_CONFLICT");
    let state = sqlx::query_as::<_, (Option<String>, i64, i64, i64)>(
        "SELECT location, version, revision, \
         (SELECT count(*) FROM activity_audit_logs WHERE activity_id = $1) \
         FROM activities WHERE id = $1",
    )
    .bind(Uuid::parse_str(activity_id).expect("activityId 应为 UUID"))
    .fetch_one(&pool)
    .await
    .expect("应读取活动副作用");
    assert_eq!(state, (Some("Osaka".to_owned()), 2, 2, 2));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn member_management_is_forbidden_while_external_activity_is_not_found() {
    let (pool, app, session, csrf, _) = seed_authenticated_actor().await;
    let created = create_activity(app.clone(), &session, &csrf).await;
    let activity_id = Uuid::parse_str(created["activityId"].as_str().expect("应返回 activityId"))
        .expect("activityId 应为 UUID");
    let now = OffsetDateTime::now_utc();
    let member_user_id = Uuid::new_v4();
    let outsider_user_id = Uuid::new_v4();
    for (user_id, username) in [(member_user_id, "bob"), (outsider_user_id, "carol")] {
        sqlx::query("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ($1, $2, 'unused', $2, $3, $3)")
            .bind(user_id).bind(username).bind(now).execute(&pool).await.expect("应插入测试用户");
    }
    sqlx::query("INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) VALUES ($1, $2, $3, 'Bob', 'MEMBER', $4)")
        .bind(Uuid::new_v4()).bind(activity_id).bind(member_user_id).bind(now).execute(&pool).await.expect("应插入 Member");
    let member_session = SessionToken::generate();
    let outsider_session = SessionToken::generate();
    for (user_id, token) in [
        (member_user_id, &member_session),
        (outsider_user_id, &outsider_session),
    ] {
        let hash = token.sha256_hash();
        sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)")
            .bind(Uuid::new_v4()).bind(user_id).bind(hash.as_slice()).bind(now).bind(now + Duration::days(30)).bind(now + Duration::days(90)).execute(&pool).await.expect("应插入测试 Session");
    }
    let secret = AppSecret::from_bytes([9; 32]);
    let member_csrf = CsrfToken::mint(&secret, CsrfContext::Session(&member_session.sha256_hash()));
    let outsider_csrf = CsrfToken::mint(
        &secret,
        CsrfContext::Session(&outsider_session.sha256_hash()),
    );
    let uri = format!("/api/activities/{activity_id}");
    for (token, token_csrf, expected_status) in [
        (&member_session, &member_csrf, StatusCode::FORBIDDEN),
        (&outsider_session, &outsider_csrf, StatusCode::NOT_FOUND),
    ] {
        let (status, _) = json_response(
            app.clone(),
            authenticated_request(
                token,
                token_csrf,
                "PUT",
                &uri,
                r#"{"version":"1","location":"Osaka"}"#,
            ),
        )
        .await;
        assert_eq!(status, expected_status);
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn historical_soft_deleted_expense_locks_base_currency_and_late_start_warns_once() {
    let (pool, app, session, csrf, user_id) = seed_authenticated_actor().await;
    let created = create_activity(app.clone(), &session, &csrf).await;
    let activity_id = Uuid::parse_str(created["activityId"].as_str().expect("应返回 activityId"))
        .expect("activityId 应为 UUID");
    let expense_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query("INSERT INTO expenses (id, activity_id, created_by_user_id, client_mutation_id, title, category, occurred_at, original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, deleted_at, created_at, updated_at) VALUES ($1, $2, $3, $4, '历史账单', 'OTHER', '2026-08-31T12:00:00Z', 'JPY', 100, 'JPY', 100, 'IDENTITY', 1, 'EXACT', $5, $5, $5)")
        .bind(expense_id).bind(activity_id).bind(user_id).bind(Uuid::new_v4()).bind(now).execute(&pool).await.expect("应插入软删除历史 Expense");
    let uri = format!("/api/activities/{activity_id}");
    let (status, body) = json_response(
        app.clone(),
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &uri,
            r#"{"version":"1","baseCurrency":"USD"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "BASE_CURRENCY_LOCKED");
    let (status, body) = json_response(
        app,
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &uri,
            r#"{"version":"1","startDate":"2026-09-02"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["version"], "2");
    assert_eq!(body["data"]["revision"], "2");
    assert_eq!(
        body["warnings"],
        serde_json::json!(["EXPENSE_BEFORE_ACTIVITY_START"])
    );
    let audit_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM activity_audit_logs WHERE activity_id = $1",
    )
    .bind(activity_id)
    .fetch_one(&pool)
    .await
    .expect("应读取 Audit");
    assert_eq!(audit_count, 2);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn historical_void_settlement_locks_base_currency() {
    let (pool, app, session, csrf, user_id) = seed_authenticated_actor().await;
    let created = create_activity(app.clone(), &session, &csrf).await;
    let activity_id = Uuid::parse_str(created["activityId"].as_str().expect("应返回 activityId"))
        .expect("activityId 应为 UUID");
    let owner_member_id = Uuid::parse_str(
        created["ownerMemberId"]
            .as_str()
            .expect("应返回 ownerMemberId"),
    )
    .expect("ownerMemberId 应为 UUID");
    let guest_member_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query("INSERT INTO activity_members (id, activity_id, display_name, role, joined_at) VALUES ($1, $2, 'Guest', 'MEMBER', $3)")
        .bind(guest_member_id).bind(activity_id).bind(now).execute(&pool).await.expect("应插入 Guest");
    sqlx::query("INSERT INTO settlements (id, activity_id, created_by_user_id, client_mutation_id, payer_member_id, receiver_member_id, currency, amount_minor, status, voided_at, voided_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 'JPY', 100, 'VOID', $7, $3, $7, $7)")
        .bind(Uuid::new_v4()).bind(activity_id).bind(user_id).bind(Uuid::new_v4()).bind(owner_member_id).bind(guest_member_id).bind(now).execute(&pool).await.expect("应插入 VOID Settlement");
    let (status, body) = json_response(
        app,
        authenticated_request(
            &session,
            &csrf,
            "PUT",
            &format!("/api/activities/{activity_id}"),
            r#"{"version":"1","baseCurrency":"USD"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "BASE_CURRENCY_LOCKED");
}
