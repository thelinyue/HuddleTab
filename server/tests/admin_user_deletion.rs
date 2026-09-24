#[path = "support/http.rs"]
mod http_support;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_support::{authenticated_request, json_response};
use huddletab_server::{
    application::{
        auth::{AuthRepository, NewRegistration, NewSession, RegistrationRepository},
        system_admin::{SystemAdminError, SystemAdminRepository},
    },
    http::router::{AppState, router_with_state},
    infrastructure::{
        app_secret::AppSecret,
        attachment_cleanup::cleanup_orphan_attachments,
        attachment_store::LocalAttachmentStore,
        auth_repository::PostgresAuthRepository,
        csrf::{CsrfContext, CsrfToken},
        database::connect_and_migrate,
        mcp_token::McpAccessToken,
        registration_repository::PostgresRegistrationRepository,
        session::SessionToken,
        system_admin_repository::PostgresSystemAdminRepository,
    },
};
use sqlx::PgPool;
use tokio::sync::Mutex;
use tower::ServiceExt as _;
use uuid::Uuid;

static TEST_LOCK: Mutex<()> = Mutex::const_new(());

/// 每个场景使用可丢弃库和独立头像目录；构造真实 Session，覆盖 HTTP 授权与数据库级联。
struct Fixture {
    pool: PgPool,
    app: axum::Router,
    admin: Uuid,
    target: Uuid,
    session: SessionToken,
    csrf: CsrfToken,
    target_session: SessionToken,
    uploads: tempfile::TempDir,
}

impl Fixture {
    async fn new() -> Self {
        let pool =
            connect_and_migrate(&std::env::var("TEST_DATABASE_URL").expect("需要可丢弃测试库"))
                .await
                .expect("测试库可迁移");
        sqlx::query("TRUNCATE users CASCADE")
            .execute(&pool)
            .await
            .unwrap();
        let admin = Uuid::new_v4();
        let target = Uuid::new_v4();
        seed_user(&pool, admin, "delete-admin").await;
        seed_user(&pool, target, "delete-target").await;
        grant_admin(&pool, admin).await;
        let session = seed_session(&pool, admin).await;
        let target_session = seed_session(&pool, target).await;
        let secret = AppSecret::from_bytes([19; 32]);
        let csrf = CsrfToken::mint(&secret, CsrfContext::Session(&session.sha256_hash()));
        let uploads = tempfile::tempdir().unwrap();
        let app = router_with_state(
            None,
            AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned())
                .with_uploads_dir(uploads.path().to_path_buf()),
        );
        Self {
            pool,
            app,
            admin,
            target,
            session,
            csrf,
            target_session,
            uploads,
        }
    }

    fn repository(&self) -> PostgresSystemAdminRepository {
        PostgresSystemAdminRepository::new(self.pool.clone())
    }

    fn delete_request(&self, target: Uuid) -> Request<Body> {
        authenticated_request(
            &self.session,
            &self.csrf,
            "DELETE",
            &format!("/api/admin/users/{target}"),
            "",
        )
    }
}

async fn seed_user(pool: &PgPool, id: Uuid, name: &str) {
    sqlx::query("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ($1, $2, 'unused-password-hash', $2, now(), now())")
        .bind(id).bind(name).execute(pool).await.unwrap();
}

async fn seed_session(pool: &PgPool, id: Uuid) -> SessionToken {
    let session = SessionToken::generate();
    sqlx::query("INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, now(), now(), now() + interval '1 day', now() + interval '2 days')")
        .bind(Uuid::new_v4()).bind(id).bind(session.sha256_hash().as_slice()).execute(pool).await.unwrap();
    session
}

async fn grant_admin(pool: &PgPool, id: Uuid) {
    sqlx::query(
        "INSERT INTO system_roles (user_id, role, granted_at) VALUES ($1, 'SYSTEM_ADMIN', now())",
    )
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_activity(pool: &PgPool, creator: Uuid, owner: Uuid) -> (Uuid, Uuid) {
    let activity = Uuid::new_v4();
    let member = Uuid::new_v4();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO activities (id, name, base_currency, owner_member_id, created_by_user_id, start_date, created_at, updated_at) VALUES ($1, '删除测试活动', 'CNY', $2, $3, CURRENT_DATE, now(), now())")
        .bind(activity).bind(member).bind(creator).execute(&mut *tx).await.unwrap();
    sqlx::query("INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) VALUES ($1, $2, $3, '负责人', 'OWNER', now())")
        .bind(member).bind(activity).bind(owner).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    (activity, member)
}

async fn seed_invitation(pool: &PgPool, activity: Uuid, owner: Uuid) -> Uuid {
    let invite = Uuid::new_v4();
    sqlx::query("INSERT INTO activity_invites (id, activity_id, created_by_member_id, token_hash, kind, expires_at, created_at) VALUES ($1, $2, $3, $4, 'LINK', now() + interval '1 day', now())")
        .bind(invite).bind(activity).bind(owner).bind(SessionToken::generate().sha256_hash().as_slice()).execute(pool).await.unwrap();
    invite
}

async fn assert_history_rejected(fixture: &Fixture, target: Uuid) {
    let (status, body) = json_response(fixture.app.clone(), fixture.delete_request(target)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "USER_HAS_BUSINESS_RECORDS");
    assert!(
        sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
            .bind(target)
            .fetch_one(&fixture.pool)
            .await
            .unwrap()
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn deletes_active_and_disabled_empty_accounts_and_cleans_credentials_and_avatar() {
    let _guard = TEST_LOCK.lock().await;
    for disabled in [false, true] {
        let f = Fixture::new().await;
        grant_admin(&f.pool, f.target).await;
        if disabled {
            sqlx::query("UPDATE users SET disabled_at = now() WHERE id = $1")
                .bind(f.target)
                .execute(&f.pool)
                .await
                .unwrap();
        }
        let token = McpAccessToken::generate();
        sqlx::query("INSERT INTO mcp_access_tokens (id, user_id, name, token_prefix, token_hash, scope, created_at) VALUES ($1, $2, '测试', $3, $4, 'READ', now())")
            .bind(Uuid::new_v4()).bind(f.target).bind(token.display_prefix()).bind(token.sha256_hash().as_slice()).execute(&f.pool).await.unwrap();
        sqlx::query(
            "INSERT INTO notification_push_preferences (user_id, updated_at) VALUES ($1, now())",
        )
        .bind(f.target)
        .execute(&f.pool)
        .await
        .unwrap();
        let subscription = Uuid::new_v4();
        sqlx::query("INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at) VALUES ($1, $2, 'https://example.invalid/push', 'key', 'auth', now(), now())")
            .bind(subscription).bind(f.target).execute(&f.pool).await.unwrap();
        let (activity, _) = seed_activity(&f.pool, f.admin, f.admin).await;
        let notification = Uuid::new_v4();
        sqlx::query("INSERT INTO notifications (id, recipient_user_id, type, target_type, target_id, activity_id, created_at) VALUES ($1, $2, 'MEMBER_JOINED', 'ACTIVITY', $3, $3, now())")
            .bind(notification).bind(f.target).bind(activity).execute(&f.pool).await.unwrap();
        sqlx::query("INSERT INTO notification_push_deliveries (id, notification_id, subscription_id, status, attempts, next_attempt_at, created_at, updated_at) VALUES ($1, $2, $3, 'PENDING', 0, now(), now(), now())")
            .bind(Uuid::new_v4()).bind(notification).bind(subscription).execute(&f.pool).await.unwrap();
        let image = Uuid::new_v4();
        let key = format!("avatars/{}/{image}.webp", f.target);
        let path = f.uploads.path().join(&key);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"avatar").unwrap();
        sqlx::query("INSERT INTO user_avatar_images (user_id, image_id, storage_key, width, height, byte_size, created_at, updated_at) VALUES ($1, $2, $3, 512, 512, 6, now(), now())")
            .bind(f.target).bind(image).bind(key).execute(&f.pool).await.unwrap();

        let (status, body) = json_response(f.app.clone(), f.delete_request(f.target)).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["data"]["userId"], f.target.to_string());
        assert_eq!(body["data"]["changed"], true);
        assert!(!path.exists());
        for table in [
            "sessions",
            "system_roles",
            "mcp_access_tokens",
            "notification_push_preferences",
            "push_subscriptions",
            "user_avatar_images",
        ] {
            let count: i64 =
                sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE user_id = $1"))
                    .bind(f.target)
                    .fetch_one(&f.pool)
                    .await
                    .unwrap();
            assert_eq!(count, 0, "{table} 应随账号清理");
        }
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM notifications WHERE recipient_user_id = $1")
                .bind(f.target)
                .fetch_one(&f.pool)
                .await
                .unwrap();
        assert_eq!(count, 0);
        let deliveries: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM notification_push_deliveries")
                .fetch_one(&f.pool)
                .await
                .unwrap();
        assert_eq!(deliveries, 0);
        let auth = PostgresAuthRepository::new(f.pool.clone());
        assert!(
            auth.find_credentials("delete-target")
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            auth.find_session(&f.target_session.sha256_hash())
                .await
                .unwrap()
                .is_none()
        );
        let response = f
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/mcp")
                    .header("Authorization", format!("Bearer {}", token.expose_once()))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn deleted_username_can_register_a_new_identity_without_inheriting_roles() {
    let _guard = TEST_LOCK.lock().await;
    let f = Fixture::new().await;
    grant_admin(&f.pool, f.target).await;
    f.repository().delete_user(f.target).await.unwrap();
    let fresh = Uuid::new_v4();
    sqlx::query("UPDATE system_settings SET registration_policy = 'OPEN'")
        .execute(&f.pool)
        .await
        .unwrap();
    let now = time::OffsetDateTime::now_utc();
    PostgresRegistrationRepository::new(f.pool.clone())
        .register(NewRegistration {
            user_id: fresh,
            username: "delete-target".to_owned(),
            display_name: "全新账号".to_owned(),
            password_hash: "fresh-password-hash".to_owned(),
            invitation_hash: None,
            created_at: now,
            session: NewSession {
                id: Uuid::new_v4(),
                user_id: fresh,
                token_hash: SessionToken::generate().sha256_hash(),
                created_at: now,
                idle_expires_at: now + time::Duration::days(1),
                absolute_expires_at: now + time::Duration::days(2),
                replacement_password_hash: None,
            },
        })
        .await
        .expect("删除后应能通过正式注册仓储复用用户名");
    assert_ne!(fresh, f.target);
    let user = f
        .repository()
        .list_users()
        .await
        .unwrap()
        .into_iter()
        .find(|u| u.id == fresh)
        .unwrap();
    assert!(!user.is_system_admin);
    assert!(matches!(
        f.repository().delete_user(f.target).await,
        Err(SystemAdminError::UserNotFound)
    ));
    sqlx::query("UPDATE system_settings SET registration_policy = 'INVITE_ONLY'")
        .execute(&f.pool)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn avatar_cleanup_failure_keeps_deletion_success_and_orphan_cleanup_can_retry() {
    let _guard = TEST_LOCK.lock().await;
    let f = Fixture::new().await;
    let image = Uuid::new_v4();
    let key = format!("avatars/{}/{image}.webp", f.target);
    let store = LocalAttachmentStore::new(f.uploads.path()).unwrap();
    store.write(&key, b"avatar").await.unwrap();
    sqlx::query("INSERT INTO user_avatar_images (user_id, image_id, storage_key, width, height, byte_size, created_at, updated_at) VALUES ($1, $2, $3, 512, 512, 6, now(), now())")
        .bind(f.target).bind(image).bind(&key).execute(&f.pool).await.unwrap();
    // 普通文件模拟不可用的存储目录，避免依赖 Windows/Linux 不同的权限行为。
    let unavailable = f.uploads.path().join("unavailable");
    std::fs::write(&unavailable, b"not-a-directory").unwrap();
    let app = router_with_state(
        None,
        AppState::new(
            f.pool.clone(),
            AppSecret::from_bytes([19; 32]),
            "http://localhost:5660".to_owned(),
        )
        .with_uploads_dir(unavailable),
    );
    let (status, _) = json_response(app, f.delete_request(f.target)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(f.uploads.path().join(&key).exists());
    let result = cleanup_orphan_attachments(
        &f.pool,
        &store,
        time::OffsetDateTime::now_utc() + time::Duration::days(1),
    )
    .await
    .unwrap();
    assert_eq!(result.deleted, 1);
    assert!(!f.uploads.path().join(key).exists());
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn all_retained_business_history_blocks_deletion() {
    let _guard = TEST_LOCK.lock().await;
    // 各类引用分别建立，避免成员记录掩盖账单、结算或审计检查缺失。
    for kind in [
        "creator",
        "member",
        "left_member",
        "expense",
        "deleted_expense",
        "settlement",
        "void_author",
        "activity_audit",
        "admin_audit",
    ] {
        let f = Fixture::new().await;
        let creator = if kind == "creator" { f.target } else { f.admin };
        let (activity, owner) = seed_activity(&f.pool, creator, f.admin).await;
        match kind {
            "creator" => {
                sqlx::query("UPDATE activities SET status = 'ARCHIVED' WHERE id = $1")
                    .bind(activity)
                    .execute(&f.pool)
                    .await
                    .unwrap();
            }
            "member" | "left_member" => {
                sqlx::query("INSERT INTO activity_members (id, activity_id, user_id, display_name, role, status, joined_at, left_at) VALUES ($1, $2, $3, '历史成员', 'MEMBER', $4, now(), CASE WHEN $4 = 'LEFT' THEN now() ELSE NULL END)")
                    .bind(Uuid::new_v4()).bind(activity).bind(f.target).bind(if kind == "member" { "ACTIVE" } else { "LEFT" }).execute(&f.pool).await.unwrap();
            }
            "expense" | "deleted_expense" => {
                sqlx::query("INSERT INTO expenses (id, activity_id, created_by_user_id, client_mutation_id, title, category, occurred_at, original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, created_at, updated_at, deleted_at) VALUES ($1, $2, $3, $1, '历史账单', 'OTHER', now(), 'CNY', 100, 'CNY', 100, 'IDENTITY', 1, 'EQUAL', now(), now(), CASE WHEN $4 THEN now() ELSE NULL END)")
                    .bind(Uuid::new_v4()).bind(activity).bind(f.target).bind(kind == "deleted_expense").execute(&f.pool).await.unwrap();
            }
            "settlement" | "void_author" => {
                let receiver = Uuid::new_v4();
                sqlx::query("INSERT INTO activity_members (id, activity_id, display_name, role, joined_at) VALUES ($1, $2, '临时成员', 'MEMBER', now())").bind(receiver).bind(activity).execute(&f.pool).await.unwrap();
                sqlx::query("INSERT INTO settlements (id, activity_id, created_by_user_id, client_mutation_id, payer_member_id, receiver_member_id, currency, amount_minor, status, created_at, updated_at, voided_at, voided_by_user_id) VALUES ($1, $2, $3, $1, $4, $5, 'CNY', 100, $6, now(), now(), CASE WHEN $6 = 'VOID' THEN now() ELSE NULL END, $7)")
                    .bind(Uuid::new_v4()).bind(activity).bind(if kind == "settlement" { f.target } else { f.admin }).bind(owner).bind(receiver)
                    .bind(if kind == "settlement" { "ACTIVE" } else { "VOID" }).bind((kind == "void_author").then_some(f.target)).execute(&f.pool).await.unwrap();
            }
            "activity_audit" => {
                sqlx::query("INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, action, resource_type, resource_id, activity_revision, created_at) VALUES ($1, $2, $3, 'TEST', 'ACTIVITY', $2, 1, now())")
                    .bind(Uuid::new_v4()).bind(activity).bind(f.target).execute(&f.pool).await.unwrap();
            }
            "admin_audit" => {
                sqlx::query("INSERT INTO system_admin_audit_logs (id, actor_user_id, event_type, resource_type, resource_key, changed_fields, created_at) VALUES ($1, $2, 'TEST', 'SYSTEM_SETTINGS', 'singleton', ARRAY['enabled'], now())")
                    .bind(Uuid::new_v4()).bind(f.target).execute(&f.pool).await.unwrap();
            }
            _ => unreachable!(),
        }
        assert_history_rejected(&f, f.target).await;
        assert!(
            PostgresAuthRepository::new(f.pool.clone())
                .find_session(&f.target_session.sha256_hash())
                .await
                .unwrap()
                .is_some(),
            "拒绝删除不能撤销原 Session：{kind}"
        );
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn pending_approved_and_rejected_join_requests_are_not_cascaded() {
    let _guard = TEST_LOCK.lock().await;
    let f = Fixture::new().await;
    let (activity, owner) = seed_activity(&f.pool, f.admin, f.admin).await;
    let invitation = seed_invitation(&f.pool, activity, owner).await;
    for status in ["PENDING", "APPROVED", "REJECTED"] {
        let request = Uuid::new_v4();
        sqlx::query("INSERT INTO activity_join_requests (id, activity_id, invitation_id, applicant_user_id, status, decided_by_member_id, decided_at, created_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'PENDING' THEN NULL ELSE $6 END, CASE WHEN $5 = 'PENDING' THEN NULL ELSE now() END, now())")
            .bind(request).bind(activity).bind(invitation).bind(f.target).bind(status).bind(owner).execute(&f.pool).await.unwrap();
        assert_history_rejected(&f, f.target).await;
        let retained: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM activity_join_requests WHERE id = $1)")
                .bind(request)
                .fetch_one(&f.pool)
                .await
                .unwrap();
        assert!(retained);
        sqlx::query("DELETE FROM activity_join_requests WHERE id = $1")
            .bind(request)
            .execute(&f.pool)
            .await
            .unwrap();
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn deletion_requires_authentication_csrf_admin_and_obeys_sensitive_rate_limit() {
    let _guard = TEST_LOCK.lock().await;
    let f = Fixture::new().await;
    let uri = format!("/api/admin/users/{}", f.target);
    let (status, _) = json_response(
        f.app.clone(),
        Request::builder()
            .method("DELETE")
            .uri(&uri)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let mut request = f.delete_request(f.target);
    request.headers_mut().remove("x-csrf-token");
    let (status, body) = json_response(f.app.clone(), request).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"]["code"], "CSRF_INVALID");
    let target_csrf = CsrfToken::mint(
        &AppSecret::from_bytes([19; 32]),
        CsrfContext::Session(&f.target_session.sha256_hash()),
    );
    let (status, body) = json_response(
        f.app.clone(),
        authenticated_request(&f.target_session, &target_csrf, "DELETE", &uri, ""),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"]["code"], "SYSTEM_ADMIN_REQUIRED");
    let (status, body) = json_response(f.app.clone(), f.delete_request(f.admin)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["error"]["code"], "LAST_ACTIVE_ADMIN");
    assert!(
        PostgresAuthRepository::new(f.pool.clone())
            .find_session(&f.session.sha256_hash())
            .await
            .unwrap()
            .is_some()
    );
    for _ in 0..9 {
        let (status, body) = json_response(f.app.clone(), f.delete_request(Uuid::new_v4())).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(body["error"]["code"], "USER_NOT_FOUND");
    }
    let response = f
        .app
        .clone()
        .oneshot(f.delete_request(f.target))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(response.headers().contains_key("retry-after"));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn self_deletion_expires_session_and_preserves_another_admin() {
    let _guard = TEST_LOCK.lock().await;
    let f = Fixture::new().await;
    grant_admin(&f.pool, f.target).await;
    let (status, _) = json_response(f.app.clone(), f.delete_request(f.admin)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = json_response(f.app.clone(), f.delete_request(f.target)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(f.repository().is_system_admin(f.target).await.unwrap());
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn concurrent_deletion_and_admin_changes_preserve_one_admin() {
    let _guard = TEST_LOCK.lock().await;
    for action in ["delete", "disable", "revoke"] {
        let f = Fixture::new().await;
        grant_admin(&f.pool, f.target).await;
        let repository = f.repository();
        let (first, second) = tokio::join!(
            async { repository.delete_user(f.admin).await.map(|_| ()) },
            async {
                match action {
                    "delete" => repository.delete_user(f.target).await.map(|_| ()),
                    "disable" => {
                        repository
                            .set_user_disabled(f.target, true, time::OffsetDateTime::now_utc())
                            .await
                    }
                    _ => {
                        repository
                            .set_system_admin(
                                f.target,
                                false,
                                f.admin,
                                time::OffsetDateTime::now_utc(),
                            )
                            .await
                    }
                }
            }
        );
        assert_eq!(
            usize::from(first.is_ok()) + usize::from(second.is_ok()),
            1,
            "{action}"
        );
        assert_eq!(
            [first, second]
                .into_iter()
                .filter(|r| matches!(r, Err(SystemAdminError::LastActiveAdmin)))
                .count(),
            1
        );
    }
    let f = Fixture::new().await;
    let repository = f.repository();
    let (first, second) = tokio::join!(
        repository.delete_user(f.target),
        repository.delete_user(f.target)
    );
    assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
    assert_eq!(
        [first, second]
            .into_iter()
            .filter(|r| matches!(r, Err(SystemAdminError::UserNotFound)))
            .count(),
        1
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn concurrent_join_request_is_preserved_before_deletion_checks() {
    let _guard = TEST_LOCK.lock().await;
    let f = Fixture::new().await;
    let (activity, owner) = seed_activity(&f.pool, f.admin, f.admin).await;
    let invitation = seed_invitation(&f.pool, activity, owner).await;
    let mut tx = f.pool.begin().await.unwrap();
    let writer_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO activity_join_requests (id, activity_id, invitation_id, applicant_user_id, created_at) VALUES ($1, $2, $3, $4, now())")
        .bind(Uuid::new_v4()).bind(activity).bind(invitation).bind(f.target).execute(&mut *tx).await.unwrap();
    let repository = f.repository();
    let target = f.target;
    let deletion = tokio::spawn(async move { repository.delete_user(target).await });
    // 等待实际数据库锁冲突，而不是依赖调度速度；旧实现会在检查时漏掉未提交的申请。
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))")
                .bind(writer_pid).fetch_one(&f.pool).await.unwrap();
            if blocked { break; }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }).await.expect("删除应等待入群申请的外键锁");
    tx.commit().await.unwrap();
    assert!(matches!(
        deletion.await.unwrap(),
        Err(SystemAdminError::UserHasBusinessRecords)
    ));
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM activity_join_requests WHERE applicant_user_id = $1",
    )
    .bind(f.target)
    .fetch_one(&f.pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
}
