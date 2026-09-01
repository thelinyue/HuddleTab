use async_trait::async_trait;
use axum::{
    body::Body,
    http::{
        Request, StatusCode,
        header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE, COOKIE},
    },
};
use http_body_util::BodyExt as _;
use huddletab_server::{
    application::sharing::{
        CsvExpenseRow, CsvNamedAmount, SharingError, SharingRepository, SharingRepositoryError,
        SharingSnapshot, SnapshotLedgerEntry, SnapshotMember, load_summary, serialize_expense_csv,
    },
    http::router::{AppState, router_with_state},
    infrastructure::{app_secret::AppSecret, database::connect_and_migrate, session::SessionToken},
};
use serde_json::Value;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use tower::ServiceExt as _;
use uuid::Uuid;

struct StubRepository {
    snapshot: SharingSnapshot,
}

#[async_trait]
impl SharingRepository for StubRepository {
    async fn load_snapshot(
        &self,
        _activity_id: Uuid,
        _actor_user_id: Uuid,
    ) -> Result<SharingSnapshot, SharingRepositoryError> {
        Ok(self.snapshot.clone())
    }
}

#[tokio::test]
async fn summary_uses_authoritative_ledger_and_named_members() {
    let owner = Uuid::new_v4();
    let guest = Uuid::new_v4();
    let repository = StubRepository {
        snapshot: SharingSnapshot {
            activity_name: "东京行".to_owned(),
            base_currency: "CNY".to_owned(),
            revision: 8,
            current_user_member_id: owner,
            members: vec![
                SnapshotMember {
                    member_id: owner,
                    display_name: "Alice".to_owned(),
                },
                SnapshotMember {
                    member_id: guest,
                    display_name: "小林".to_owned(),
                },
            ],
            total_expense_minor: 1200,
            payments: vec![SnapshotLedgerEntry::new(owner, 1200)],
            shares: vec![SnapshotLedgerEntry::new(guest, 1200)],
            settlements: vec![],
            expenses: vec![],
        },
    };

    let summary = load_summary(&repository, Uuid::new_v4(), Uuid::new_v4())
        .await
        .expect("账务事实完整时应生成摘要");

    assert_eq!(summary.activity_name, "东京行");
    assert_eq!(summary.member_count, 2);
    assert_eq!(summary.total_expense_minor, 1200);
    assert_eq!(summary.current_user_balance_minor, 1200);
    assert_eq!(
        summary
            .balances
            .iter()
            .find(|balance| balance.member_id == guest)
            .expect("应保留成员余额")
            .display_name,
        "小林"
    );
    assert_eq!(summary.recommendations.len(), 1);
    assert_eq!(summary.recommendations[0].payer_member_id, guest);
    assert_eq!(summary.recommendations[0].receiver_member_id, owner);
}

#[tokio::test]
async fn summary_rejects_balanced_facts_that_do_not_match_expense_total() {
    let owner = Uuid::from_u128(1);
    let guest = Uuid::from_u128(2);
    let repository = StubRepository {
        snapshot: SharingSnapshot {
            activity_name: "缺失事实活动".to_owned(),
            base_currency: "CNY".to_owned(),
            revision: 1,
            current_user_member_id: owner,
            members: vec![
                SnapshotMember {
                    member_id: owner,
                    display_name: "甲".to_owned(),
                },
                SnapshotMember {
                    member_id: guest,
                    display_name: "乙".to_owned(),
                },
            ],
            total_expense_minor: 1200,
            payments: vec![SnapshotLedgerEntry::new(owner, 800)],
            shares: vec![SnapshotLedgerEntry::new(guest, 800)],
            settlements: vec![],
            expenses: vec![],
        },
    };

    let result = load_summary(&repository, Uuid::new_v4(), Uuid::new_v4()).await;

    assert!(matches!(result, Err(SharingError::Integrity)));
}

#[tokio::test]
async fn summary_maps_fact_total_overflow_to_integrity_error() {
    let owner = Uuid::from_u128(1);
    let guest = Uuid::from_u128(2);
    let repository = StubRepository {
        snapshot: SharingSnapshot {
            activity_name: "溢出事实活动".to_owned(),
            base_currency: "CNY".to_owned(),
            revision: 1,
            current_user_member_id: owner,
            members: vec![
                SnapshotMember {
                    member_id: owner,
                    display_name: "甲".to_owned(),
                },
                SnapshotMember {
                    member_id: guest,
                    display_name: "乙".to_owned(),
                },
            ],
            total_expense_minor: i64::MAX,
            payments: vec![
                SnapshotLedgerEntry::new(owner, i64::MAX),
                SnapshotLedgerEntry::new(owner, 1),
            ],
            shares: vec![
                SnapshotLedgerEntry::new(guest, i64::MAX),
                SnapshotLedgerEntry::new(guest, 1),
            ],
            settlements: vec![],
            expenses: vec![],
        },
    };

    let result = load_summary(&repository, Uuid::new_v4(), Uuid::new_v4()).await;

    assert!(matches!(result, Err(SharingError::Integrity)));
}

#[test]
fn csv_has_fixed_columns_crlf_bom_and_neutralizes_formulas() {
    let csv = serialize_expense_csv(&[CsvExpenseRow {
        occurred_at: "2026-08-30T12:00:00Z".to_owned(),
        title: "=SUM(A1:A2)".to_owned(),
        category: "FOOD".to_owned(),
        original_amount_minor: 1200,
        original_currency: "CNY".to_owned(),
        exchange_rate: "1".to_owned(),
        base_amount_minor: 1200,
        payers: vec![CsvNamedAmount {
            display_name: "小王".to_owned(),
            amount_minor: 1200,
        }],
        participants: vec![CsvNamedAmount {
            display_name: "小李".to_owned(),
            amount_minor: 1200,
        }],
        split_mode: "EQUAL".to_owned(),
        creator_name: "小王".to_owned(),
        created_at: "2026-08-30T12:01:00Z".to_owned(),
        note: Some("晚餐, \"聚会\"".to_owned()),
    }]);

    assert!(csv.starts_with(
        "\u{feff}\"消费时间\",\"用途\",\"分类\",\"原始金额\",\"原始币种\",\"汇率\",\"主币种金额\",\"付款人\",\"参与成员\",\"分摊方式\",\"创建人\",\"创建时间\",\"备注\"\r\n"
    ));
    assert!(csv.contains("\"'=SUM(A1:A2)\""));
    assert!(csv.contains("\"晚餐, \"\"聚会\"\"\""));
    assert!(csv.ends_with("\r\n"));
}

struct SharingContext {
    pool: PgPool,
    app: axum::Router,
    activity_id: Uuid,
    owner_member_id: Uuid,
    session: SessionToken,
}

// 该集成场景必须在一次种子准备中同时放入有效与无效账务事实，拆分会掩盖快照过滤的对照关系。
#[allow(clippy::too_many_lines)]
async fn seed_context() -> SharingContext {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let user_id = Uuid::new_v4();
    let activity_id = Uuid::new_v4();
    let owner_member_id = Uuid::new_v4();
    let guest_member_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let occurred_at = OffsetDateTime::parse("2026-08-30T12:00:00Z", &Rfc3339)
        .expect("固定测试时间应符合 RFC 3339");
    let mut transaction = pool.begin().await.expect("应开启事务");
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'alice', 'unused', 'Alice', $2, $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入用户");
    sqlx::query(
        "INSERT INTO activities (id, name, base_currency, start_date, owner_member_id, \
         created_by_user_id, created_at, updated_at) \
         VALUES ($1, 'Tokyo Trip', 'CNY', '2026-08-30', $2, $3, $4, $4)",
    )
    .bind(activity_id)
    .bind(owner_member_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动");
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) \
         VALUES ($1, $2, $3, 'Alice', 'OWNER', $4), ($5, $2, NULL, '小林', 'MEMBER', $4)",
    )
    .bind(owner_member_id)
    .bind(activity_id)
    .bind(user_id)
    .bind(now)
    .bind(guest_member_id)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动成员");
    let active_expense_id = Uuid::new_v4();
    let deleted_expense_id = Uuid::new_v4();
    for (expense_id, title, amount, deleted_at) in [
        (active_expense_id, "=晚餐", 1200_i64, None),
        (deleted_expense_id, "不应导出", 800_i64, Some(now)),
    ] {
        sqlx::query(
            "INSERT INTO expenses (id, activity_id, created_by_user_id, client_mutation_id, title, \
             category, occurred_at, original_currency, original_amount_minor, base_currency, \
             base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, deleted_at, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, 'FOOD', $6, 'CNY', $7, 'CNY', $7, 'IDENTITY', 1, 'EQUAL', $8, $6, $6)",
        )
        .bind(expense_id)
        .bind(activity_id)
        .bind(user_id)
        .bind(Uuid::new_v4())
        .bind(title)
        .bind(occurred_at)
        .bind(amount)
        .bind(deleted_at)
        .execute(&mut *transaction)
        .await
        .expect("应插入支出");
        sqlx::query(
            "INSERT INTO expense_payments (id, activity_id, expense_id, payer_member_id, original_currency, \
             original_amount_minor, base_currency, base_amount_minor) \
             VALUES ($1, $2, $3, $4, 'CNY', $5, 'CNY', $5)",
        )
        .bind(Uuid::new_v4())
        .bind(activity_id)
        .bind(expense_id)
        .bind(owner_member_id)
        .bind(amount)
        .execute(&mut *transaction)
        .await
        .expect("应插入付款事实");
        sqlx::query(
            "INSERT INTO expense_shares (id, activity_id, expense_id, member_id, original_currency, \
             original_amount_minor, base_currency, base_amount_minor) \
             VALUES ($1, $2, $3, $4, 'CNY', $5, 'CNY', $5)",
        )
        .bind(Uuid::new_v4())
        .bind(activity_id)
        .bind(expense_id)
        .bind(guest_member_id)
        .bind(amount)
        .execute(&mut *transaction)
        .await
        .expect("应插入分摊事实");
    }
    sqlx::query(
        "INSERT INTO settlements (id, activity_id, created_by_user_id, client_mutation_id, payer_member_id, \
         receiver_member_id, currency, amount_minor, status, voided_at, voided_by_user_id, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, 'CNY', 1200, 'VOID', $7, $3, $7, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(user_id)
    .bind(Uuid::new_v4())
    .bind(guest_member_id)
    .bind(owner_member_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入已作废结算");
    transaction.commit().await.expect("应提交基础数据");
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
    .bind(now + Duration::days(30))
    .bind(now + Duration::days(90))
    .execute(&pool)
    .await
    .expect("应插入 Session");
    let app = router_with_state(
        None,
        AppState::new(
            pool.clone(),
            AppSecret::from_bytes([25; 32]),
            "http://localhost:5660".to_owned(),
        ),
    );
    SharingContext {
        pool,
        app,
        activity_id,
        owner_member_id,
        session,
    }
}

fn request(context: &SharingContext, uri: String) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .header(
            COOKIE,
            format!("huddletab_session={}", context.session.expose_for_cookie()),
        )
        .body(Body::empty())
        .expect("请求应可构造")
}

fn anonymous_request(uri: String) -> Request<Body> {
    Request::builder()
        .uri(uri)
        .body(Body::empty())
        .expect("匿名请求应可构造")
}

async fn raw_response(
    context: &SharingContext,
    request: Request<Body>,
) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let response = context
        .app
        .clone()
        .oneshot(request)
        .await
        .expect("router 应响应");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    (status, headers, bytes.to_vec())
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
#[allow(clippy::too_many_lines)]
async fn summary_and_csv_use_one_private_authorized_snapshot() {
    let context = seed_context().await;
    for suffix in ["summary", "export.csv"] {
        let (status, _, _) = raw_response(
            &context,
            anonymous_request(format!("/api/activities/{}/{suffix}", context.activity_id)),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    let (status, _, summary_bytes) = raw_response(
        &context,
        request(
            &context,
            format!("/api/activities/{}/summary", context.activity_id),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let summary: Value = serde_json::from_slice(&summary_bytes).expect("摘要应为 JSON");
    assert_eq!(summary["data"]["activityName"], "Tokyo Trip");
    assert_eq!(summary["data"]["memberCount"], 2);
    assert_eq!(summary["data"]["totalExpenseMinor"], "1200");
    assert_eq!(summary["data"]["currentUserBalanceMinor"], "1200");
    assert_eq!(summary["data"]["recommendations"][0]["amountMinor"], "1200");

    let (status, headers, csv) = raw_response(
        &context,
        request(
            &context,
            format!("/api/activities/{}/export.csv", context.activity_id),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers
            .get(CACHE_CONTROL)
            .and_then(|value| value.to_str().ok()),
        Some("private, no-store")
    );
    assert_eq!(
        headers
            .get(CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok()),
        Some("attachment; filename=\"activity-export.csv\"")
    );
    assert!(
        headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("text/csv; charset=utf-8"))
    );
    assert_eq!(&csv[..3], &[0xef, 0xbb, 0xbf]);
    let csv = String::from_utf8(csv).expect("CSV 应为 UTF-8");
    assert!(csv.contains("\"'=晚餐\""));
    assert!(csv.contains("\"2026-08-30T20:00:00.000+08:00\""));
    assert!(!csv.contains("不应导出"));

    for activity_status in ["ENDED", "ARCHIVED"] {
        sqlx::query("UPDATE activities SET status = $1 WHERE id = $2")
            .bind(activity_status)
            .bind(context.activity_id)
            .execute(&context.pool)
            .await
            .expect("应更新活动生命周期");
        for suffix in ["summary", "export.csv"] {
            let (status, _, _) = raw_response(
                &context,
                request(
                    &context,
                    format!("/api/activities/{}/{suffix}", context.activity_id),
                ),
            )
            .await;
            assert_eq!(
                status,
                StatusCode::OK,
                "{activity_status} 成员应可读取 {suffix}"
            );
        }
    }

    sqlx::query(
        "UPDATE activities SET deleted_at = now(), purge_after = now() + interval '30 days' \
         WHERE id = $1",
    )
    .bind(context.activity_id)
    .execute(&context.pool)
    .await
    .expect("应软删除活动");
    for suffix in ["summary", "export.csv"] {
        let (status, _, _) = raw_response(
            &context,
            request(
                &context,
                format!("/api/activities/{}/{suffix}", context.activity_id),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "已删除活动不应读取 {suffix}");
    }

    sqlx::query("UPDATE activities SET deleted_at = NULL, purge_after = NULL WHERE id = $1")
        .bind(context.activity_id)
        .execute(&context.pool)
        .await
        .expect("应恢复活动以单独验证成员权限");

    sqlx::query("UPDATE activity_members SET status = 'LEFT', left_at = now() WHERE id = $1")
        .bind(context.owner_member_id)
        .execute(&context.pool)
        .await
        .expect("应将当前成员标记为已离开");
    for suffix in ["summary", "export.csv"] {
        let (status, _, _) = raw_response(
            &context,
            request(
                &context,
                format!("/api/activities/{}/{suffix}", context.activity_id),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    context.pool.close().await;
}
