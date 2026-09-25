#[path = "support/permanent_activity.rs"]
mod permanent_activity;

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
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use tokio::sync::Mutex;
use tower::ServiceExt as _;
use uuid::Uuid;

// 账务集成测试会清空同一可丢弃数据库；锁住整个场景，保证测试自身的并发只发生在 HTTP 请求处。
static DATABASE_TEST_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Clone)]
struct AccountingContext {
    pool: PgPool,
    app: axum::Router,
    user_id: Uuid,
    activity_id: Uuid,
    owner_member_id: Uuid,
    guest_member_id: Uuid,
    session: SessionToken,
    csrf: CsrfToken,
}

async fn seed_context() -> AccountingContext {
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
         VALUES ($1, $2, $3, 'Alice', 'OWNER', $4), \
                ($5, $2, NULL, '小林', 'MEMBER', $4)",
    )
    .bind(owner_member_id)
    .bind(activity_id)
    .bind(user_id)
    .bind(now)
    .bind(guest_member_id)
    .execute(&mut *transaction)
    .await
    .expect("应插入账务成员");
    transaction.commit().await.expect("应提交基础数据");
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
    .expect("应插入 Session");
    let secret = AppSecret::from_bytes([23; 32]);
    let csrf = CsrfToken::mint(&secret, CsrfContext::Session(&session_hash));
    let app = router_with_state(
        None,
        AppState::new(pool.clone(), secret, "http://localhost:5660".to_owned()),
    );
    AccountingContext {
        pool,
        app,
        user_id,
        activity_id,
        owner_member_id,
        guest_member_id,
        session,
        csrf,
    }
}

async fn wait_until_ledger_blocks_on_payments(pool: &PgPool) {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let is_blocked = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity \
             WHERE datname = current_database() AND state = 'active' \
             AND wait_event_type = 'Lock' \
             AND query LIKE 'SELECT p.payer_member_id, p.base_amount_minor FROM expense_payments p%')",
        )
        .fetch_one(pool)
        .await
        .expect("应读取 Ledger 查询等待状态");
        if is_blocked {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "Ledger 应在读取付款事实时等待表锁"
        );
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

fn expense_payload(context: &AccountingContext, mutation_id: Uuid, title: &str) -> Value {
    json!({
        "clientMutationId": mutation_id,
        "title": title,
        "category": "FOOD",
        "note": "晚餐",
        "occurredAt": "2026-08-30T12:00:00Z",
        "originalCurrency": "USD",
        "originalAmountMinor": "1001",
        "exchangeRateKind": "PROVIDER",
        "exchangeRate": "7.2",
        "exchangeRateReferenceDate": "2026-08-30",
        "exchangeRateProvider": "FRANKFURTER",
        "payments": [
            {"memberId": context.owner_member_id, "amountMinor": "600"},
            {"memberId": context.guest_member_id, "amountMinor": "401"}
        ],
        "split": {
            "mode": "EXACT",
            "entries": [
                {"memberId": context.owner_member_id, "value": "500"},
                {"memberId": context.guest_member_id, "value": "501"}
            ]
        }
    })
}

fn settlement_payload(context: &AccountingContext, mutation_id: Uuid, amount_minor: &str) -> Value {
    json!({
        "clientMutationId": mutation_id,
        "payerMemberId": context.owner_member_id,
        "receiverMemberId": context.guest_member_id,
        "currency": "CNY",
        "amountMinor": amount_minor
    })
}

fn direct_bill_payload(
    title: &str,
    payer: Uuid,
    debtor: Uuid,
    amount: &str,
    occurred_at: &str,
) -> Value {
    json!({
        "clientMutationId": Uuid::new_v4(),
        "title": title,
        "category": "OTHER",
        "occurredAt": occurred_at,
        "originalCurrency": "CNY",
        "originalAmountMinor": amount,
        "exchangeRateKind": "IDENTITY",
        "exchangeRate": "1",
        "payments": [{"memberId": payer, "amountMinor": amount}],
        "split": {"mode": "EXACT", "entries": [{"memberId": debtor, "value": amount}]}
    })
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 同一活动连续验证移除成员的历史账单可修正、新账单不能再引用该成员。
#[allow(clippy::too_many_lines)]
async fn removed_member_can_be_reused_on_existing_bills_but_not_new_bills() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let collection_uri = format!("/api/activities/{}/expenses", context.activity_id);
    let original = direct_bill_payload(
        "原有参与",
        context.guest_member_id,
        context.guest_member_id,
        "100",
        "2026-08-30T12:00:00Z",
    );
    let forgotten = direct_bill_payload(
        "漏记成员",
        context.owner_member_id,
        context.owner_member_id,
        "100",
        "2026-08-30T13:00:00Z",
    );
    let (status, created) = response(
        &context,
        request(&context, "POST", collection_uri.clone(), original.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let original_uri = format!(
        "{collection_uri}/{}",
        created["data"]["expense"]["expenseId"]
            .as_str()
            .expect("应返回账单 ID")
    );
    let (status, created) = response(
        &context,
        request(&context, "POST", collection_uri.clone(), forgotten.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let forgotten_uri = format!(
        "{collection_uri}/{}",
        created["data"]["expense"]["expenseId"]
            .as_str()
            .expect("应返回账单 ID")
    );
    let unreferenced_member_id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, display_name, role, joined_at)
         VALUES ($1, $2, '漏记的成员', 'MEMBER', now())",
    )
    .bind(unreferenced_member_id)
    .bind(context.activity_id)
    .execute(&context.pool)
    .await
    .expect("应插入尚无账务引用的成员");

    for member_id in [context.guest_member_id, unreferenced_member_id] {
        let (status, removed) = response(
            &context,
            request(
                &context,
                "DELETE",
                format!(
                    "/api/activities/{}/members/{member_id}",
                    context.activity_id
                ),
                json!({}),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(removed["data"]["result"], "LEFT");
    }

    let mut revised = original.clone();
    revised["version"] = json!("1");
    revised["title"] = json!("改用途仍保留成员");
    let (status, saved) = response(
        &context,
        request(&context, "PUT", original_uri.clone(), revised.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["data"]["expense"]["version"], "2");

    revised["version"] = json!("2");
    revised["payments"] = json!([{"memberId": context.owner_member_id, "amountMinor": "100"}]);
    revised["split"] = json!({"mode": "EXACT", "entries": [{"memberId": context.owner_member_id, "value": "100"}]});
    let (status, saved) = response(
        &context,
        request(&context, "PUT", original_uri.clone(), revised.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["data"]["expense"]["version"], "3");

    revised["version"] = json!("3");
    revised["payments"] = original["payments"].clone();
    revised["split"] = original["split"].clone();
    let (status, saved) = response(&context, request(&context, "PUT", original_uri, revised)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved["data"]["expense"]["version"], "4");

    let mut corrected = forgotten.clone();
    corrected["version"] = json!("1");
    corrected["payments"] = json!([{"memberId": unreferenced_member_id, "amountMinor": "100"}]);
    corrected["split"] =
        json!({"mode": "EXACT", "entries": [{"memberId": unreferenced_member_id, "value": "100"}]});
    let (status, saved) = response(
        &context,
        request(&context, "PUT", forgotten_uri, corrected.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        saved["data"]["payments"][0]["memberId"],
        unreferenced_member_id.to_string()
    );
    assert_eq!(
        saved["data"]["shares"][0]["memberId"],
        unreferenced_member_id.to_string()
    );

    let new_bill = direct_bill_payload(
        "已移除成员不能参与新账单",
        unreferenced_member_id,
        unreferenced_member_id,
        "100",
        "2026-08-30T14:00:00Z",
    );
    let (status, rejected) = response(
        &context,
        request(&context, "POST", collection_uri, new_bill),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(rejected["error"]["code"], "INVALID_EXPENSE");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 同一账本场景验证净额付款及跨账单抵销共同清偿，需保留完整状态迁移顺序。
#[allow(clippy::too_many_lines)]
async fn net_payment_and_cross_bill_offset_clear_both_bills_without_manual_links() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let bills_uri = format!("/api/activities/{}/expenses", context.activity_id);
    let first = direct_bill_payload(
        "甲欠乙",
        context.guest_member_id,
        context.owner_member_id,
        "100",
        "2026-08-30T12:00:00Z",
    );
    let second = direct_bill_payload(
        "乙欠甲",
        context.owner_member_id,
        context.guest_member_id,
        "40",
        "2026-08-31T12:00:00Z",
    );
    let (status, first_created) = response(
        &context,
        request(&context, "POST", bills_uri.clone(), first),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let first_id = first_created["data"]["expense"]["expenseId"]
        .as_str()
        .expect("应返回账单 ID");
    let (status, second_created) = response(
        &context,
        request(&context, "POST", bills_uri.clone(), second),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let second_id = second_created["data"]["expense"]["expenseId"]
        .as_str()
        .expect("应返回账单 ID");
    assert_eq!(
        second_created["data"]["settlementProgress"]["offsetMinor"],
        "0"
    );
    let settlement_uri = format!("/api/activities/{}/settlements", context.activity_id);
    let (status, created) = response(
        &context,
        request(
            &context,
            "POST",
            settlement_uri,
            settlement_payload(&context, Uuid::new_v4(), "60"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let applications = created["data"]["settlement"]["applications"]
        .as_array()
        .expect("应返回自动清偿来源");
    assert_eq!(applications.len(), 2);
    assert!(
        applications
            .iter()
            .all(|entry| entry["expenseId"] == first_id && entry["amountMinor"] == "60")
    );
    for expense_id in [first_id, second_id] {
        let uri = format!("{bills_uri}/{expense_id}");
        let (status, detail) = response(&context, request(&context, "GET", uri, json!(null))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(detail["data"]["settlementProgress"]["status"], "SETTLED");
        assert_eq!(detail["data"]["settlementProgress"]["remainingMinor"], "0");
    }
    let backdated = direct_bill_payload(
        "后补旧账",
        context.guest_member_id,
        context.owner_member_id,
        "20",
        "2026-08-29T12:00:00Z",
    );
    let (status, _) = response(
        &context,
        request(&context, "POST", bills_uri.clone(), backdated),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (_, first_after) = response(
        &context,
        request(
            &context,
            "GET",
            format!("{bills_uri}/{first_id}"),
            json!(null),
        ),
    )
    .await;
    assert_eq!(
        first_after["data"]["settlementProgress"]["status"],
        "SETTLED"
    );
    let second_uri = format!("{bills_uri}/{second_id}");
    let mut revised = direct_bill_payload(
        "乙欠甲",
        context.owner_member_id,
        context.guest_member_id,
        "20",
        "2026-08-31T12:00:00Z",
    );
    revised["version"] = json!("1");
    let (status, _) = response(
        &context,
        request(&context, "PUT", second_uri.clone(), revised),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, first_after_edit) = response(
        &context,
        request(
            &context,
            "GET",
            format!("{bills_uri}/{first_id}"),
            json!(null),
        ),
    )
    .await;
    assert_eq!(
        first_after_edit["data"]["settlementProgress"]["remainingMinor"],
        "20"
    );

    let (status, _) = response(
        &context,
        request(&context, "DELETE", second_uri, json!({"version": "2"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, first_after_delete) = response(
        &context,
        request(
            &context,
            "GET",
            format!("{bills_uri}/{first_id}"),
            json!(null),
        ),
    )
    .await;
    assert_eq!(
        first_after_delete["data"]["settlementProgress"]["remainingMinor"],
        "40"
    );
}

fn request(context: &AccountingContext, method: &str, uri: String, body: Value) -> Request<Body> {
    let serialized_body = body.to_string();
    drop(body);
    Request::builder()
        .method(method)
        .uri(uri)
        .header(CONTENT_TYPE, "application/json")
        .header(
            COOKIE,
            format!("huddletab_session={}", context.session.expose_for_cookie()),
        )
        .header(ORIGIN, "http://localhost:5660")
        .header("sec-fetch-site", "same-origin")
        .header("x-csrf-token", context.csrf.expose_for_header())
        .body(Body::from(serialized_body))
        .expect("请求应可构造")
}

async fn date_preview(
    context: &AccountingContext,
    dates: Value,
    timezone: &str,
    centralized: bool,
) -> Value {
    let mut body = json!({"dates": dates, "timeZone": timezone, "strategy": "min_transfers"});
    if centralized {
        body["strategy"] = json!("centralized");
        body["hubMemberId"] = json!(context.owner_member_id);
    }
    let (status, preview) = response(
        context,
        request(
            context,
            "POST",
            format!("/api/activities/{}/settlement-preview", context.activity_id),
            body,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    preview["data"].clone()
}

async fn scope_bill(
    context: &AccountingContext,
    title: &str,
    payer: Uuid,
    debtor: Uuid,
    amount: &str,
    date: &str,
) -> Value {
    let body = direct_bill_payload(title, payer, debtor, amount, date);
    let (status, created) = response(
        context,
        request(
            context,
            "POST",
            format!("/api/activities/{}/expenses", context.activity_id),
            body,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    created["data"].clone()
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
#[allow(clippy::too_many_lines)] // 一个连续场景验证预览、支付、补录、修改和作废的范围恢复。
async fn date_scope_preserves_selection_replay_and_later_bills() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let first = scope_bill(
        &context,
        "第一天",
        context.guest_member_id,
        context.owner_member_id,
        "100",
        "2026-09-24T04:00:00Z",
    )
    .await;
    let second = scope_bill(
        &context,
        "第二天",
        context.owner_member_id,
        context.guest_member_id,
        "40",
        "2026-09-25T04:00:00Z",
    )
    .await;
    let before = activity_side_effects(&context).await;
    let combined = date_preview(
        &context,
        json!(["2026-09-24", "2026-09-25"]),
        "Asia/Shanghai",
        false,
    )
    .await;
    assert_eq!(combined["recommendations"][0]["amountMinor"], "60");
    let preview = date_preview(
        &context,
        json!(["2026-09-24", "2026-09-24"]),
        "Asia/Shanghai",
        false,
    )
    .await;
    assert_eq!(preview["recommendations"][0]["amountMinor"], "100");
    assert_eq!(preview["scope"]["dates"], json!(["2026-09-24"]));
    assert_eq!(activity_side_effects(&context).await, before);
    let collection = format!("/api/activities/{}/settlements", context.activity_id);
    let mut body = settlement_payload(&context, Uuid::new_v4(), "100");
    body["scope"] = preview["scope"].clone();
    let (status, created) = response(
        &context,
        request(&context, "POST", collection.clone(), body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(
        created["data"]["settlement"]["scopeExpenseIds"],
        json!([first["expense"]["expenseId"]])
    );
    let after_create = activity_side_effects(&context).await;
    let (status, replay) = response(
        &context,
        request(&context, "POST", collection.clone(), body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["data"]["idempotentReplay"], true);
    assert_eq!(activity_side_effects(&context).await, after_create);
    let second_preview =
        date_preview(&context, json!(["2026-09-25"]), "Asia/Shanghai", false).await;
    assert_eq!(second_preview["recommendations"][0]["amountMinor"], "40");
    let second_uri = format!(
        "/api/activities/{}/expenses/{}",
        context.activity_id,
        second["expense"]["expenseId"].as_str().unwrap()
    );
    let (_, detail) = response(&context, request(&context, "GET", second_uri, json!(null))).await;
    assert_eq!(detail["data"]["settlementProgress"]["settledMinor"], "0");
    scope_bill(
        &context,
        "后来补录",
        context.guest_member_id,
        context.owner_member_id,
        "20",
        "2026-09-24T05:00:00Z",
    )
    .await;
    assert_eq!(
        date_preview(&context, json!(["2026-09-24"]), "Asia/Shanghai", false).await["recommendations"]
            [0]["amountMinor"],
        "20"
    );
    let before_stale = activity_side_effects(&context).await;
    body["clientMutationId"] = json!(Uuid::new_v4());
    let (status, stale) = response(
        &context,
        request(&context, "POST", collection.clone(), body),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{stale}");
    assert_eq!(stale["error"]["code"], "SETTLEMENT_PREVIEW_EXPIRED");
    assert_eq!(activity_side_effects(&context).await, before_stale);
    let item = format!(
        "{collection}/{}",
        created["data"]["settlement"]["settlementId"]
            .as_str()
            .unwrap()
    );
    let (status, updated) = response(&context, request(&context, "PUT", item.clone(), json!({"version":"1", "payerMemberId":context.owner_member_id, "receiverMemberId":context.guest_member_id, "amountMinor":"80"}))).await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(
        date_preview(&context, json!(["2026-09-24"]), "Asia/Shanghai", false).await["recommendations"]
            [0]["amountMinor"],
        "40"
    );
    let (status, result) = response(
        &context,
        request(&context, "DELETE", item, json!({"version":"2"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(
        date_preview(&context, json!(["2026-09-24"]), "Asia/Shanghai", false).await["recommendations"]
            [0]["amountMinor"],
        "120"
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn date_scope_offset_confirmation_is_cashless_and_idempotent() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    scope_bill(
        &context,
        "第一天",
        context.guest_member_id,
        context.owner_member_id,
        "100",
        "2026-09-24T04:00:00Z",
    )
    .await;
    scope_bill(
        &context,
        "第二天",
        context.owner_member_id,
        context.guest_member_id,
        "100",
        "2026-09-25T04:00:00Z",
    )
    .await;
    let preview = date_preview(&context, json!(null), "Asia/Shanghai", false).await;
    assert_eq!(preview["requiresOffsetConfirmation"], true);
    assert_eq!(preview["settled"], false);
    let uri = format!(
        "/api/activities/{}/offset-confirmations",
        context.activity_id
    );
    let body = json!({"clientMutationId":Uuid::new_v4(), "scope":preview["scope"]});
    let (status, confirmed) = response(
        &context,
        request(&context, "POST", uri.clone(), body.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{confirmed}");
    let side_effects = activity_side_effects(&context).await;
    let (status, replay) = response(&context, request(&context, "POST", uri, body)).await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["data"]["idempotentReplay"], true);
    assert_eq!(activity_side_effects(&context).await, side_effects);
    let cash: i64 = sqlx::query_scalar("SELECT count(*) FROM settlements WHERE activity_id = $1")
        .bind(context.activity_id)
        .fetch_one(&context.pool)
        .await
        .unwrap();
    assert_eq!(cash, 0);
    assert_eq!(
        date_preview(&context, json!(["2026-09-24"]), "Asia/Shanghai", false).await["settled"],
        true
    );
    scope_bill(
        &context,
        "补录",
        context.guest_member_id,
        context.owner_member_id,
        "20",
        "2026-09-24T05:00:00Z",
    )
    .await;
    assert_eq!(
        date_preview(&context, json!(["2026-09-24"]), "Asia/Shanghai", false).await["recommendations"]
            [0]["amountMinor"],
        "20"
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn date_scope_centralized_collection_keeps_hub_outgoing_balance() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let creditor = Uuid::new_v4();
    sqlx::query("INSERT INTO activity_members(id, activity_id, display_name, role, joined_at) VALUES ($1,$2,'小周','MEMBER',now())")
        .bind(creditor).bind(context.activity_id).execute(&context.pool).await.unwrap();
    scope_bill(
        &context,
        "代收代付",
        creditor,
        context.guest_member_id,
        "100",
        "2026-09-24T04:00:00Z",
    )
    .await;
    let collection = format!("/api/activities/{}/settlements", context.activity_id);
    let preview = date_preview(&context, json!(["2026-09-24"]), "Asia/Shanghai", true).await;
    let (status, collected) = response(&context, request(&context, "POST", collection.clone(), json!({"clientMutationId":Uuid::new_v4(), "payerMemberId":context.guest_member_id,"receiverMemberId":context.owner_member_id,"currency":"CNY","amountMinor":"100","scope":preview["scope"]}))).await;
    assert_eq!(status, StatusCode::CREATED, "{collected}");
    let next = date_preview(&context, json!(["2026-09-24"]), "Asia/Shanghai", true).await;
    assert_eq!(next["recommendations"].as_array().unwrap().len(), 1);
    assert_eq!(
        next["recommendations"][0]["payerMemberId"],
        context.owner_member_id.to_string()
    );
    assert_eq!(
        next["recommendations"][0]["receiverMemberId"],
        creditor.to_string()
    );
    assert_eq!(next["settled"], false);
    let (status, paid) = response(&context, request(&context, "POST", collection, json!({"clientMutationId":Uuid::new_v4(), "payerMemberId":context.owner_member_id,"receiverMemberId":creditor,"currency":"CNY","amountMinor":"100","scope":next["scope"]}))).await;
    assert_eq!(status, StatusCode::CREATED, "{paid}");
    assert_eq!(
        date_preview(&context, json!(["2026-09-24"]), "Asia/Shanghai", true).await["settled"],
        true
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn date_scope_uses_local_midnight_and_dst_and_rejects_empty_dates() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    for timestamp in [
        "2026-03-08T06:30:00Z",
        "2026-03-08T07:30:00Z",
        "2026-03-09T03:30:00Z",
        "2026-03-09T04:30:00Z",
    ] {
        scope_bill(
            &context,
            "夏令时",
            context.guest_member_id,
            context.owner_member_id,
            "100",
            timestamp,
        )
        .await;
    }
    let preview = date_preview(&context, json!(["2026-03-08"]), "America/New_York", false).await;
    assert_eq!(preview["expenseIds"].as_array().unwrap().len(), 3);
    assert_eq!(preview["recommendations"][0]["amountMinor"], "300");
    assert_eq!(
        date_preview(&context, json!(["2026-03-08"]), "UTC", false).await["expenseIds"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    for body in [
        json!({"dates":[],"timeZone":"UTC"}),
        json!({"dates":["2026-02-30"],"timeZone":"UTC"}),
        json!({"dates":null,"timeZone":"Invalid/Timezone"}),
    ] {
        let (status, error) = response(
            &context,
            request(
                &context,
                "POST",
                format!("/api/activities/{}/settlement-preview", context.activity_id),
                body,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn date_scope_concurrent_writes_replay_or_reject_stale_revision() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    scope_bill(
        &context,
        "并发结算",
        context.guest_member_id,
        context.owner_member_id,
        "100",
        "2026-09-24T04:00:00Z",
    )
    .await;
    let uri = format!("/api/activities/{}/settlements", context.activity_id);
    for same_key in [true, false] {
        let preview = date_preview(&context, json!(["2026-09-24"]), "Asia/Shanghai", false).await;
        let mut body = settlement_payload(&context, Uuid::new_v4(), "30");
        body["scope"] = preview["scope"].clone();
        let mut other = body.clone();
        if !same_key {
            other["clientMutationId"] = json!(Uuid::new_v4());
        }
        let before = activity_side_effects(&context).await;
        let (a, b) = tokio::join!(
            response(&context, request(&context, "POST", uri.clone(), body)),
            response(&context, request(&context, "POST", uri.clone(), other))
        );
        let expected = if same_key {
            StatusCode::OK
        } else {
            StatusCode::CONFLICT
        };
        assert!(
            (a.0 == StatusCode::CREATED && b.0 == expected)
                || (b.0 == StatusCode::CREATED && a.0 == expected),
            "{a:?} {b:?}"
        );
        assert_eq!(
            activity_side_effects(&context).await,
            (before.0 + 1, before.1 + 1)
        );
    }
    assert_eq!(
        date_preview(&context, json!(["2026-09-24"]), "UTC", false).await["recommendations"][0]["amountMinor"],
        "40"
    );
    scope_bill(
        &context,
        "相反账单",
        context.owner_member_id,
        context.guest_member_id,
        "40",
        "2026-09-26T04:00:00Z",
    )
    .await;
    let preview = date_preview(&context, json!(["2026-09-24", "2026-09-26"]), "UTC", false).await;
    let uri = format!(
        "/api/activities/{}/offset-confirmations",
        context.activity_id
    );
    let body = json!({"clientMutationId":Uuid::new_v4(), "scope":preview["scope"]});
    let (a, b) = tokio::join!(
        response(
            &context,
            request(&context, "POST", uri.clone(), body.clone())
        ),
        response(
            &context,
            request(&context, "POST", uri.clone(), body.clone())
        )
    );
    assert_eq!((a.0, b.0), (StatusCode::OK, StatusCode::OK));
    assert_ne!(
        a.1["data"]["idempotentReplay"],
        b.1["data"]["idempotentReplay"]
    );
    let mut stale = body;
    stale["clientMutationId"] = json!(Uuid::new_v4());
    assert_eq!(
        response(&context, request(&context, "POST", uri, stale))
            .await
            .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn date_scope_bill_date_changes_and_deletion_preserve_cash_and_history() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let bill = scope_bill(
        &context,
        "已付账单",
        context.guest_member_id,
        context.owner_member_id,
        "100",
        "2026-09-24T04:00:00Z",
    )
    .await;
    let preview = date_preview(&context, json!(null), "Asia/Shanghai", false).await;
    let collection = format!("/api/activities/{}/settlements", context.activity_id);
    let mut body = settlement_payload(&context, Uuid::new_v4(), "100");
    body["scope"] = preview["scope"].clone();
    let (status, created) = response(
        &context,
        request(&context, "POST", collection.clone(), body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(
        created["data"]["settlement"]["scopeDates"],
        json!(["2026-09-24"])
    );
    let uri = format!(
        "/api/activities/{}/expenses/{}",
        context.activity_id,
        bill["expense"]["expenseId"].as_str().unwrap()
    );
    let mut changed = direct_bill_payload(
        "已付账单",
        context.guest_member_id,
        context.owner_member_id,
        "100",
        "2026-09-26T04:00:00Z",
    );
    changed["version"] = json!("1");
    let (status, result) = response(&context, request(&context, "PUT", uri.clone(), changed)).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(
        date_preview(&context, json!(["2026-09-26"]), "UTC", false).await["settled"],
        true
    );
    let (_, history) = response(
        &context,
        request(&context, "GET", collection.clone(), json!(null)),
    )
    .await;
    assert_eq!(history["data"][0]["scopeDates"], json!(["2026-09-24"]));
    let (status, result) = response(
        &context,
        request(&context, "DELETE", uri, json!({"version":"2"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    let refund = date_preview(&context, json!(null), "UTC", false).await;
    assert_eq!(
        refund["recommendations"][0]["payerMemberId"],
        context.guest_member_id.to_string()
    );
    assert_eq!(refund["recommendations"][0]["amountMinor"], "100");
    let mut repayment = refund["recommendations"][0].clone();
    repayment["currency"] = json!("CNY");
    repayment["clientMutationId"] = json!(Uuid::new_v4());
    repayment["scope"] = refund["scope"].clone();
    let (status, result) =
        response(&context, request(&context, "POST", collection, repayment)).await;
    assert_eq!(status, StatusCode::CREATED, "{result}");
    assert_eq!(
        date_preview(&context, json!(null), "UTC", false).await["settled"],
        true
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn date_scope_unallocated_payment_needs_explicit_all_date_confirmation() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let collection = format!("/api/activities/{}/settlements", context.activity_id);
    let (status, _) = response(
        &context,
        request(
            &context,
            "POST",
            collection,
            settlement_payload(&context, Uuid::new_v4(), "100"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    scope_bill(
        &context,
        "后来账单",
        context.guest_member_id,
        context.owner_member_id,
        "100",
        "2026-09-24T04:00:00Z",
    )
    .await;
    let single = date_preview(&context, json!(["2026-09-24"]), "UTC", false).await;
    assert_eq!(single["recommendations"][0]["amountMinor"], "100");
    let all = date_preview(&context, json!(null), "UTC", false).await;
    assert_eq!(all["requiresOffsetConfirmation"], true);
    let before = activity_side_effects(&context).await;
    let uri = format!(
        "/api/activities/{}/offset-confirmations",
        context.activity_id
    );
    let body = json!({"clientMutationId":Uuid::new_v4(), "scope":all["scope"]});
    let mut no_csrf = request(&context, "POST", uri.clone(), body.clone());
    no_csrf.headers_mut().remove("x-csrf-token");
    assert_eq!(response(&context, no_csrf).await.0, StatusCode::FORBIDDEN);
    assert_eq!(activity_side_effects(&context).await, before);
    let (status, result) = response(&context, request(&context, "POST", uri, body)).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(
        date_preview(&context, json!(["2026-09-24"]), "UTC", false).await["settled"],
        true
    );
    let cash: i64 = sqlx::query_scalar(
        "SELECT sum(amount_minor)::bigint FROM settlements WHERE activity_id = $1",
    )
    .bind(context.activity_id)
    .fetch_one(&context.pool)
    .await
    .unwrap();
    assert_eq!(cash, 100);
}

async fn response(context: &AccountingContext, request: Request<Body>) -> (StatusCode, Value) {
    let response = context
        .app
        .clone()
        .oneshot(request)
        .await
        .expect("router 应响应");
    let status = response.status();
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("应读取响应")
        .to_bytes();
    let body = serde_json::from_slice(&bytes).expect("响应应为 JSON");
    (status, body)
}

fn fact_sum(rows: &Value, field: &str) -> i64 {
    rows.as_array()
        .expect("事实应为数组")
        .iter()
        .map(|row| {
            row[field]
                .as_str()
                .expect("金额应为字符串")
                .parse::<i64>()
                .expect("金额应为 i64")
        })
        .sum()
}

async fn activity_side_effects(context: &AccountingContext) -> (i64, i64) {
    sqlx::query_as::<_, (i64, i64)>(
        "SELECT revision, (SELECT count(*) FROM activity_audit_logs WHERE activity_id = $1) \
         FROM activities WHERE id = $1",
    )
    .bind(context.activity_id)
    .fetch_one(&context.pool)
    .await
    .expect("应读取活动 revision 与 Audit 数量")
}

// 单一连续场景证明 Settlement 的 replay、noop、更新、冲突和 VOID 共享同一 revision 序列。
#[allow(clippy::too_many_lines)]
async fn exercise_settlement_lifecycle(context: &AccountingContext, ledger_uri: &str) {
    let recommendation_uri = format!("/api/activities/{}/recommendations", context.activity_id);
    let (status, recommendations) = response(
        context,
        request(context, "GET", recommendation_uri, json!(null)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let recommendation = &recommendations["data"]["recommendations"][0];
    let full_amount = recommendation["amountMinor"]
        .as_str()
        .expect("应返回建议金额")
        .parse::<i64>()
        .expect("建议金额应为 i64");
    let partial_amount = full_amount - 1;
    let mutation_id = Uuid::new_v4();
    let collection_uri = format!("/api/activities/{}/settlements", context.activity_id);
    let create = json!({
        "clientMutationId": mutation_id,
        "payerMemberId": recommendation["payerMemberId"],
        "receiverMemberId": recommendation["receiverMemberId"],
        "currency": "CNY",
        "amountMinor": partial_amount.to_string()
    });
    let (status, created) = response(
        context,
        request(context, "POST", collection_uri.clone(), create.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["data"]["settlement"]["revision"], "4");
    let settlement_id = created["data"]["settlement"]["settlementId"]
        .as_str()
        .expect("应返回 Settlement ID");
    let (status, replay) = response(
        context,
        request(context, "POST", collection_uri.clone(), create),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["data"]["idempotentReplay"], true);
    assert_eq!(replay["data"]["settlement"]["revision"], "4");
    let item_uri = format!(
        "/api/activities/{}/settlements/{settlement_id}",
        context.activity_id
    );
    for uri in [collection_uri.clone(), item_uri.clone()] {
        let (status, _) = response(context, request(context, "GET", uri, json!(null))).await;
        assert_eq!(status, StatusCode::OK);
    }
    let unchanged = json!({
        "version": "1",
        "payerMemberId": recommendation["payerMemberId"],
        "receiverMemberId": recommendation["receiverMemberId"],
        "amountMinor": partial_amount.to_string()
    });
    let (status, unchanged) = response(
        context,
        request(context, "PUT", item_uri.clone(), unchanged),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unchanged["data"]["settlement"]["version"], "1");
    assert_eq!(unchanged["data"]["settlement"]["revision"], "4");
    assert_eq!(activity_side_effects(context).await, (4, 3));

    let update = json!({
        "version": "1",
        "payerMemberId": recommendation["payerMemberId"],
        "receiverMemberId": recommendation["receiverMemberId"],
        "amountMinor": full_amount.to_string()
    });
    let (status, updated) = response(
        context,
        request(context, "PUT", item_uri.clone(), update.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["data"]["settlement"]["version"], "2");
    assert_eq!(updated["data"]["settlement"]["revision"], "5");
    let (status, _) = response(context, request(context, "PUT", item_uri.clone(), update)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (_, settled_ledger) = response(
        context,
        request(context, "GET", ledger_uri.to_owned(), json!(null)),
    )
    .await;
    assert!(
        settled_ledger["data"]["balances"]
            .as_array()
            .expect("余额应为数组")
            .iter()
            .all(|balance| balance["netMinor"] == "0")
    );
    let (status, voided) = response(
        context,
        request(context, "DELETE", item_uri, json!({"version":"2"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(voided["data"]["settlement"]["status"], "VOID");
    assert_eq!(voided["data"]["settlement"]["revision"], "6");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 单一连续场景证明 Expense 与后续 Settlement 的 revision、Audit 和账本副作用。
#[allow(clippy::too_many_lines)]
async fn expense_crud_keeps_double_amount_facts_idempotency_and_versions() {
    let context = seed_context().await;
    let mutation_id = Uuid::new_v4();
    let uri = format!("/api/activities/{}/expenses", context.activity_id);
    let payload = expense_payload(&context, mutation_id, "Sushi");

    let (status, created) = response(
        &context,
        request(&context, "POST", uri.clone(), payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["data"]["expense"]["revision"], "2");
    let expense_id = created["data"]["expense"]["expenseId"]
        .as_str()
        .expect("应返回 Expense ID");
    assert_eq!(created["data"]["expense"]["baseAmountMinor"], "7207");
    assert_eq!(created["data"]["expense"]["exchangeRateKind"], "PROVIDER");
    assert_eq!(
        created["data"]["expense"]["exchangeRateReferenceDate"],
        "2026-08-30"
    );
    assert_eq!(
        created["data"]["expense"]["exchangeRateProvider"],
        "FRANKFURTER"
    );
    assert_eq!(
        fact_sum(&created["data"]["payments"], "baseAmountMinor"),
        7207
    );
    assert_eq!(
        fact_sum(&created["data"]["shares"], "baseAmountMinor"),
        7207
    );
    let audit_uri = format!("/api/activities/{}/audit-logs", context.activity_id);
    let (status, audit_page) =
        response(&context, request(&context, "GET", audit_uri, json!(null))).await;
    assert_eq!(status, StatusCode::OK);
    let created_audit = audit_page["data"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["action"] == "EXPENSE_CREATED"))
        .expect("账单创建应出现在活动记录");
    assert_eq!(created_audit["expense"]["title"], "Sushi");
    assert_eq!(created_audit["expense"]["category"], "FOOD");
    assert_eq!(created_audit["expense"]["originalCurrency"], "USD");
    assert_eq!(created_audit["expense"]["originalAmountMinor"], "1001");

    let (status, replay) =
        response(&context, request(&context, "POST", uri, payload.clone())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["data"]["idempotentReplay"], true);
    assert_eq!(replay["data"]["expense"]["expenseId"], expense_id);
    assert_eq!(replay["data"]["expense"]["revision"], "2");
    assert_eq!(replay["data"]["expense"]["exchangeRateKind"], "PROVIDER");

    let item_uri = format!(
        "/api/activities/{}/expenses/{expense_id}",
        context.activity_id
    );
    let (status, detail) = response(
        &context,
        request(&context, "GET", item_uri.clone(), json!(null)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(detail["data"]["expense"]["version"], "1");

    let original_payments = detail["data"]["payments"].clone();
    let original_shares = detail["data"]["shares"].clone();
    let mut unchanged = payload.clone();
    unchanged["version"] = json!("1");
    let (status, unchanged) = response(
        &context,
        request(&context, "PUT", item_uri.clone(), unchanged),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unchanged["data"]["expense"]["version"], "1");
    assert_eq!(unchanged["data"]["expense"]["revision"], "2");
    assert_eq!(unchanged["data"]["payments"], original_payments);
    assert_eq!(unchanged["data"]["shares"], original_shares);
    assert_eq!(activity_side_effects(&context).await, (2, 1));

    let mut update = expense_payload(&context, mutation_id, "Updated Sushi");
    update["version"] = json!("1");
    let (status, updated) = response(
        &context,
        request(&context, "PUT", item_uri.clone(), update.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["data"]["expense"]["version"], "2");
    assert_eq!(updated["data"]["expense"]["revision"], "3");
    let audit_uri = format!("/api/activities/{}/audit-logs", context.activity_id);
    let (status, audit_page) =
        response(&context, request(&context, "GET", audit_uri, json!(null))).await;
    assert_eq!(status, StatusCode::OK);
    let updated_audit = audit_page["data"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["action"] == "EXPENSE_UPDATED"))
        .expect("账单修改应出现在活动记录");
    assert_eq!(updated_audit["changes"][0]["field"], "title");
    assert_eq!(updated_audit["changes"][0]["beforeValue"], "Sushi");
    assert_eq!(updated_audit["changes"][0]["afterValue"], "Updated Sushi");
    let (status, _) = response(&context, request(&context, "PUT", item_uri.clone(), update)).await;
    assert_eq!(status, StatusCode::CONFLICT);

    let ledger_uri = format!("/api/activities/{}/ledger", context.activity_id);
    let (status, ledger) = response(
        &context,
        request(&context, "GET", ledger_uri.clone(), json!(null)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fact_sum(&ledger["data"]["balances"], "netMinor"), 0);

    exercise_settlement_lifecycle(&context, &ledger_uri).await;

    let (status, deleted) = response(
        &context,
        request(&context, "DELETE", item_uri, json!({"version":"2"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(deleted["data"]["status"], "DELETED");
    assert_eq!(deleted["data"]["revision"], "7");
    let (status, ledger) =
        response(&context, request(&context, "GET", ledger_uri, json!(null))).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        ledger["data"]["balances"]
            .as_array()
            .expect("余额应为数组")
            .iter()
            .all(|balance| balance["netMinor"] == "0")
    );
    let side_effects = sqlx::query_as::<_, (i64, i64)>(
        "SELECT revision, (SELECT count(*) FROM activity_audit_logs WHERE activity_id = $1) \
         FROM activities WHERE id = $1",
    )
    .bind(context.activity_id)
    .fetch_one(&context.pool)
    .await
    .expect("应读取 revision 与 Audit");
    assert_eq!(side_effects, (7, 6));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn expense_and_settlement_notifications_follow_the_transaction_event_matrix() {
    let context = seed_context().await;
    let recipient_user_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ($1, 'bob', 'unused', 'Bob', $2, $2)")
        .bind(recipient_user_id).bind(now).execute(&context.pool).await.expect("应插入通知接收人");
    sqlx::query("UPDATE activity_members SET user_id = $1 WHERE id = $2")
        .bind(recipient_user_id)
        .bind(context.guest_member_id)
        .execute(&context.pool)
        .await
        .expect("应绑定账务参与成员");

    let expense_uri = format!("/api/activities/{}/expenses", context.activity_id);
    let mutation_id = Uuid::new_v4();
    let create = expense_payload(&context, mutation_id, "通知账单");
    let (status, created) = response(
        &context,
        request(&context, "POST", expense_uri.clone(), create),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let expense_id = created["data"]["expense"]["expenseId"]
        .as_str()
        .expect("应返回 expenseId");
    assert_eq!(notification_count(&context, recipient_user_id).await, 0);

    let item_uri = format!("{expense_uri}/{expense_id}");
    let mut update = expense_payload(&context, mutation_id, "修改后的账单");
    update["version"] = json!("1");
    let (status, _) = response(&context, request(&context, "PUT", item_uri.clone(), update)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = response(
        &context,
        request(&context, "DELETE", item_uri, json!({"version":"2"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let settlement_uri = format!("/api/activities/{}/settlements", context.activity_id);
    let settlement = settlement_payload(&context, Uuid::new_v4(), "20");
    let (status, created) = response(
        &context,
        request(&context, "POST", settlement_uri.clone(), settlement.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let settlement_id = created["data"]["settlement"]["settlementId"]
        .as_str()
        .expect("应返回 settlementId");
    let (status, replay) = response(
        &context,
        request(&context, "POST", settlement_uri, settlement),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["data"]["idempotentReplay"], true);
    let settlement_item = format!(
        "/api/activities/{}/settlements/{settlement_id}",
        context.activity_id
    );
    let (status, _) = response(
        &context,
        request(
            &context,
            "PUT",
            settlement_item.clone(),
            json!({
                "version":"1",
                "payerMemberId":context.owner_member_id,
                "receiverMemberId":context.guest_member_id,
                "amountMinor":"21"
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = response(
        &context,
        request(&context, "DELETE", settlement_item, json!({"version":"2"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let kinds = sqlx::query_scalar::<_, String>(
        "SELECT type FROM notifications WHERE recipient_user_id = $1 ORDER BY created_at, id",
    )
    .bind(recipient_user_id)
    .fetch_all(&context.pool)
    .await
    .expect("应读取账务通知");
    assert_eq!(
        kinds,
        vec![
            "PARTICIPATING_EXPENSE_CHANGED",
            "PARTICIPATING_EXPENSE_DELETED",
            "SETTLEMENT_RECEIVED",
        ]
    );
}

async fn notification_count(context: &AccountingContext, recipient_user_id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM notifications WHERE recipient_user_id = $1")
        .bind(recipient_user_id)
        .fetch_one(&context.pool)
        .await
        .expect("应读取通知数量")
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn expense_noop_ignores_zero_base_fact_input_order() {
    let context = seed_context().await;
    let mut members = [context.owner_member_id, context.guest_member_id];
    members.sort_unstable();
    members.reverse();
    let payload = json!({
        "clientMutationId": Uuid::new_v4(),
        "title": "Tiny expense",
        "category": "OTHER",
        "occurredAt": "2026-08-30T12:00:00Z",
        "originalCurrency": "USD",
        "originalAmountMinor": "3",
        "exchangeRateKind": "MANUAL",
        "exchangeRate": "0.000001",
        "payments": [
            {"memberId": members[0], "amountMinor": "1"},
            {"memberId": members[0], "amountMinor": "1"},
            {"memberId": members[1], "amountMinor": "1"}
        ],
        "split": {
            "mode": "EXACT",
            "entries": [
                {"memberId": members[0], "value": "1"},
                {"memberId": members[1], "value": "2"}
            ]
        }
    });
    let collection_uri = format!("/api/activities/{}/expenses", context.activity_id);
    let (status, created) = response(
        &context,
        request(&context, "POST", collection_uri, payload.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(created["data"]["expense"]["baseAmountMinor"], "0");

    let expense_id = created["data"]["expense"]["expenseId"]
        .as_str()
        .expect("应返回 Expense ID");
    let mut unchanged = payload.clone();
    unchanged["version"] = json!("1");
    let item_uri = format!(
        "/api/activities/{}/expenses/{expense_id}",
        context.activity_id
    );
    let (status, unchanged) = response(
        &context,
        request(&context, "PUT", item_uri.clone(), unchanged),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(unchanged["data"]["expense"]["version"], "1");
    assert_eq!(unchanged["data"]["expense"]["revision"], "2");
    assert_eq!(unchanged["data"]["payments"], created["data"]["payments"]);
    assert_eq!(unchanged["data"]["shares"], created["data"]["shares"]);
    assert_eq!(activity_side_effects(&context).await, (2, 1));

    let mut changed = payload;
    changed["version"] = json!("1");
    changed["payments"] = json!([
        {"memberId": members[0], "amountMinor": "1"},
        {"memberId": members[1], "amountMinor": "1"},
        {"memberId": members[1], "amountMinor": "1"}
    ]);
    let (status, changed) = response(&context, request(&context, "PUT", item_uri, changed)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(changed["data"]["expense"]["version"], "2");
    assert_eq!(changed["data"]["expense"]["revision"], "3");
    let second_member_count = changed["data"]["payments"]
        .as_array()
        .expect("应返回付款事实")
        .iter()
        .filter(|fact| fact["memberId"] == members[1].to_string())
        .count();
    assert_eq!(second_member_count, 2);
    assert_eq!(activity_side_effects(&context).await, (3, 2));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn expense_noop_uses_postgresql_timestamp_precision() {
    let context = seed_context().await;
    let collection_uri = format!("/api/activities/{}/expenses", context.activity_id);
    for (index, occurred_at) in [
        "2026-08-30T12:00:00.123456789Z",
        "1999-12-31T12:00:00.123456789Z",
    ]
    .into_iter()
    .enumerate()
    {
        let mut payload = expense_payload(&context, Uuid::new_v4(), "Nanosecond expense");
        payload["occurredAt"] = json!(occurred_at);
        let (status, created) = response(
            &context,
            request(&context, "POST", collection_uri.clone(), payload.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);

        let expense_id = created["data"]["expense"]["expenseId"]
            .as_str()
            .expect("应返回 Expense ID");
        let mut unchanged = payload;
        unchanged["version"] = json!("1");
        let item_uri = format!(
            "/api/activities/{}/expenses/{expense_id}",
            context.activity_id
        );
        let (status, unchanged) =
            response(&context, request(&context, "PUT", item_uri, unchanged)).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(unchanged["data"]["expense"]["version"], "1");
        assert_eq!(
            unchanged["data"]["expense"]["revision"],
            (index + 2).to_string()
        );
    }
    assert_eq!(activity_side_effects(&context).await, (3, 2));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 单一场景按顺序验证 ENDED 下 Expense 冻结与 Settlement 三种写操作，拆分会重复昂贵数据库准备。
#[allow(clippy::too_many_lines)]
async fn ended_only_keeps_settlement_mutations_writable() {
    let context = seed_context().await;
    let expense_uri = format!("/api/activities/{}/expenses", context.activity_id);
    let (status, _) = response(
        &context,
        request(
            &context,
            "POST",
            expense_uri.clone(),
            expense_payload(&context, Uuid::new_v4(), "Sushi"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    sqlx::query("UPDATE activities SET status = 'ENDED' WHERE id = $1")
        .bind(context.activity_id)
        .execute(&context.pool)
        .await
        .expect("应结束活动");

    let (status, _) = response(
        &context,
        request(
            &context,
            "POST",
            expense_uri,
            expense_payload(&context, Uuid::new_v4(), "Late expense"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let recommendation_uri = format!("/api/activities/{}/recommendations", context.activity_id);
    let (_, recommendations) = response(
        &context,
        request(&context, "GET", recommendation_uri, json!(null)),
    )
    .await;
    let recommendation = &recommendations["data"]["recommendations"][0];
    let collection_uri = format!("/api/activities/{}/settlements", context.activity_id);
    let create = json!({
        "clientMutationId": Uuid::new_v4(),
        "payerMemberId": recommendation["payerMemberId"],
        "receiverMemberId": recommendation["receiverMemberId"],
        "currency": "CNY",
        "amountMinor": recommendation["amountMinor"]
    });
    let (status, created) = response(
        &context,
        request(&context, "POST", collection_uri.clone(), create),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let settlement_id = created["data"]["settlement"]["settlementId"]
        .as_str()
        .expect("应返回 Settlement ID");
    let item_uri = format!(
        "/api/activities/{}/settlements/{settlement_id}",
        context.activity_id
    );
    for uri in [collection_uri.clone(), item_uri.clone()] {
        let (status, _) = response(&context, request(&context, "GET", uri, json!(null))).await;
        assert_eq!(status, StatusCode::OK);
    }
    let updated_amount = recommendation["amountMinor"]
        .as_str()
        .expect("推荐金额应为字符串")
        .parse::<i64>()
        .expect("推荐金额应为整数")
        - 1;
    let (status, updated) = response(
        &context,
        request(
            &context,
            "PUT",
            item_uri.clone(),
            json!({
                "version": "1",
                "payerMemberId": recommendation["payerMemberId"],
                "receiverMemberId": recommendation["receiverMemberId"],
                "amountMinor": updated_amount.to_string()
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["data"]["settlement"]["version"], "2");
    let (status, _) = response(
        &context,
        request(
            &context,
            "DELETE",
            item_uri.clone(),
            json!({"version": "2"}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    sqlx::query("UPDATE activities SET status = 'ARCHIVED' WHERE id = $1")
        .bind(context.activity_id)
        .execute(&context.pool)
        .await
        .expect("应归档活动");
    for uri in [collection_uri.clone(), item_uri.clone()] {
        let (status, _) = response(&context, request(&context, "GET", uri, json!(null))).await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status, _) = response(
        &context,
        request(
            &context,
            "POST",
            collection_uri.clone(),
            json!({
                "clientMutationId": Uuid::new_v4(),
                "payerMemberId": context.owner_member_id,
                "receiverMemberId": context.guest_member_id,
                "currency": "CNY",
                "amountMinor": "1"
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    permanent_activity::delete(&context.pool, context.activity_id).await;
    let (status, _) = response(
        &context,
        request(
            &context,
            "POST",
            collection_uri,
            json!({
                "clientMutationId": Uuid::new_v4(),
                "payerMemberId": context.owner_member_id,
                "receiverMemberId": context.guest_member_id,
                "currency": "CNY",
                "amountMinor": "1"
            }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn ended_activity_keeps_expense_reads_available_to_members() {
    let context = seed_context().await;
    let collection_uri = format!("/api/activities/{}/expenses", context.activity_id);
    let (status, created) = response(
        &context,
        request(
            &context,
            "POST",
            collection_uri.clone(),
            expense_payload(&context, Uuid::new_v4(), "Sushi"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let expense_id = created["data"]["expense"]["expenseId"]
        .as_str()
        .expect("应返回 Expense ID");

    sqlx::query("UPDATE activities SET status = 'ENDED' WHERE id = $1")
        .bind(context.activity_id)
        .execute(&context.pool)
        .await
        .expect("应结束活动");

    let (status, expenses) = response(
        &context,
        request(&context, "GET", collection_uri, json!(null)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(expenses["data"].as_array().map(Vec::len), Some(1));

    let (status, expense) = response(
        &context,
        request(
            &context,
            "GET",
            format!(
                "/api/activities/{}/expenses/{expense_id}",
                context.activity_id
            ),
            json!(null),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(expense["data"]["expense"]["title"], "Sushi");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn archived_accounting_reads_reject_the_same_activity_after_soft_delete() {
    let context = seed_context().await;
    let expense_uri = format!("/api/activities/{}/expenses", context.activity_id);
    let (status, _) = response(
        &context,
        request(
            &context,
            "POST",
            expense_uri,
            expense_payload(&context, Uuid::new_v4(), "Sushi"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    sqlx::query("UPDATE activities SET status = 'ARCHIVED' WHERE id = $1")
        .bind(context.activity_id)
        .execute(&context.pool)
        .await
        .expect("应归档活动");
    let read_uris = [
        format!("/api/activities/{}/ledger", context.activity_id),
        format!("/api/activities/{}/recommendations", context.activity_id),
    ];
    for uri in &read_uris {
        let (status, _) =
            response(&context, request(&context, "GET", uri.clone(), json!(null))).await;
        assert_eq!(status, StatusCode::OK);
    }

    permanent_activity::delete(&context.pool, context.activity_id).await;
    for uri in read_uris {
        let (status, _) = response(&context, request(&context, "GET", uri, json!(null))).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn permanently_deleted_activity_rejects_expense_creation() {
    let context = seed_context().await;
    permanent_activity::delete(&context.pool, context.activity_id).await;

    let (status, _) = response(
        &context,
        request(
            &context,
            "POST",
            format!("/api/activities/{}/expenses", context.activity_id),
            expense_payload(&context, Uuid::new_v4(), "Sushi"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn archived_activity_keeps_expense_list_and_detail_readable() {
    let context = seed_context().await;
    let collection_uri = format!("/api/activities/{}/expenses", context.activity_id);
    let (status, created) = response(
        &context,
        request(
            &context,
            "POST",
            collection_uri.clone(),
            expense_payload(&context, Uuid::new_v4(), "Sushi"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let expense_id = created["data"]["expense"]["expenseId"]
        .as_str()
        .expect("应返回 Expense ID");
    sqlx::query("UPDATE activities SET status = 'ARCHIVED' WHERE id = $1")
        .bind(context.activity_id)
        .execute(&context.pool)
        .await
        .expect("应归档活动");

    for uri in [
        collection_uri,
        format!(
            "/api/activities/{}/expenses/{expense_id}",
            context.activity_id
        ),
    ] {
        let (status, _) = response(&context, request(&context, "GET", uri, json!(null))).await;
        assert_eq!(status, StatusCode::OK);
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn ledger_reads_revision_and_facts_from_one_snapshot() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let mut blocker = context.pool.begin().await.expect("应开启阻塞事务");
    sqlx::query("LOCK TABLE expense_payments IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .expect("应锁住付款事实表");

    let ledger_context = context.clone();
    let ledger_request = request(
        &context,
        "GET",
        format!("/api/activities/{}/ledger", context.activity_id),
        json!(null),
    );
    let ledger_task = tokio::spawn(async move { response(&ledger_context, ledger_request).await });
    wait_until_ledger_blocks_on_payments(&context.pool).await;

    // 写事务在 Ledger 已读取 revision 后提交；一致快照必须继续忽略这笔新结算。
    let now = OffsetDateTime::now_utc();
    let mut writer = context.pool.begin().await.expect("应开启并发写事务");
    sqlx::query("UPDATE activities SET revision = revision + 1, updated_at = $2 WHERE id = $1")
        .bind(context.activity_id)
        .bind(now)
        .execute(&mut *writer)
        .await
        .expect("应更新活动 revision");
    sqlx::query(
        "INSERT INTO settlements (id, activity_id, created_by_user_id, client_mutation_id, \
         payer_member_id, receiver_member_id, currency, amount_minor, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, 'CNY', 1, $7, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(context.activity_id)
    .bind(context.user_id)
    .bind(Uuid::new_v4())
    .bind(context.owner_member_id)
    .bind(context.guest_member_id)
    .bind(now)
    .execute(&mut *writer)
    .await
    .expect("应写入并发结算事实");
    writer.commit().await.expect("应提交并发写事务");
    blocker.commit().await.expect("应释放付款事实表锁");

    let (status, ledger) = ledger_task.await.expect("Ledger 请求任务应完成");
    assert_eq!(status, StatusCode::OK);
    assert_eq!(ledger["data"]["revision"], "1");
    assert!(
        ledger["data"]["balances"]
            .as_array()
            .expect("余额应为数组")
            .iter()
            .all(|balance| balance["netMinor"] == "0"),
        "旧 revision 的快照不应混入新结算"
    );
    let persisted = sqlx::query_as::<_, (i64, i64)>(
        "SELECT revision, (SELECT count(*) FROM settlements WHERE activity_id = $1) \
         FROM activities WHERE id = $1",
    )
    .bind(context.activity_id)
    .fetch_one(&context.pool)
    .await
    .expect("应确认并发写已提交");
    assert_eq!(persisted, (2, 1));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn concurrent_expense_creates_replay_once_and_emit_one_side_effect() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let mutation_id = Uuid::new_v4();
    let uri = format!("/api/activities/{}/expenses", context.activity_id);
    let payload = expense_payload(&context, mutation_id, "Concurrent Sushi");
    assert_eq!(activity_side_effects(&context).await, (1, 0));

    let first = response(
        &context,
        request(&context, "POST", uri.clone(), payload.clone()),
    );
    let second = response(&context, request(&context, "POST", uri, payload));
    let (first, second) = tokio::join!(first, second);

    assert!(matches!(
        (first.0, second.0),
        (StatusCode::CREATED, StatusCode::OK) | (StatusCode::OK, StatusCode::CREATED)
    ));
    let (created, replay) = if first.0 == StatusCode::CREATED {
        (&first.1, &second.1)
    } else {
        (&second.1, &first.1)
    };
    assert_eq!(created["data"]["idempotentReplay"], false);
    assert_eq!(replay["data"]["idempotentReplay"], true);
    assert_eq!(
        replay["data"]["expense"]["expenseId"],
        created["data"]["expense"]["expenseId"]
    );

    let resource_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM expenses WHERE activity_id = $1 AND client_mutation_id = $2",
    )
    .bind(context.activity_id)
    .bind(mutation_id)
    .fetch_one(&context.pool)
    .await
    .expect("应统计 Expense 幂等资源");
    assert_eq!(resource_count, 1);
    assert_eq!(activity_side_effects(&context).await, (2, 1));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn concurrent_settlement_creates_replay_once_and_emit_one_side_effect() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let mutation_id = Uuid::new_v4();
    let uri = format!("/api/activities/{}/settlements", context.activity_id);
    let payload = settlement_payload(&context, mutation_id, "1");
    assert_eq!(activity_side_effects(&context).await, (1, 0));

    let first = response(
        &context,
        request(&context, "POST", uri.clone(), payload.clone()),
    );
    let second = response(&context, request(&context, "POST", uri, payload));
    let (first, second) = tokio::join!(first, second);

    assert!(matches!(
        (first.0, second.0),
        (StatusCode::CREATED, StatusCode::OK) | (StatusCode::OK, StatusCode::CREATED)
    ));
    let (created, replay) = if first.0 == StatusCode::CREATED {
        (&first.1, &second.1)
    } else {
        (&second.1, &first.1)
    };
    assert_eq!(created["data"]["idempotentReplay"], false);
    assert_eq!(replay["data"]["idempotentReplay"], true);
    assert_eq!(
        replay["data"]["settlement"]["settlementId"],
        created["data"]["settlement"]["settlementId"]
    );

    let resource_count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM settlements WHERE activity_id = $1 AND client_mutation_id = $2",
    )
    .bind(context.activity_id)
    .bind(mutation_id)
    .fetch_one(&context.pool)
    .await
    .expect("应统计 Settlement 幂等资源");
    assert_eq!(resource_count, 1);
    assert_eq!(activity_side_effects(&context).await, (2, 1));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn concurrent_expense_updates_with_same_version_apply_once() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let collection_uri = format!("/api/activities/{}/expenses", context.activity_id);
    let (status, created) = response(
        &context,
        request(
            &context,
            "POST",
            collection_uri,
            expense_payload(&context, Uuid::new_v4(), "Original Sushi"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let expense_id = created["data"]["expense"]["expenseId"]
        .as_str()
        .expect("应返回 Expense ID");
    assert_eq!(activity_side_effects(&context).await, (2, 1));
    let uri = format!(
        "/api/activities/{}/expenses/{expense_id}",
        context.activity_id
    );
    let mut first_update = expense_payload(&context, Uuid::new_v4(), "Concurrent Sushi A");
    first_update["version"] = json!("1");
    let mut second_update = expense_payload(&context, Uuid::new_v4(), "Concurrent Sushi B");
    second_update["version"] = json!("1");

    let first = response(
        &context,
        request(&context, "PUT", uri.clone(), first_update),
    );
    let second = response(
        &context,
        request(&context, "PUT", uri.clone(), second_update),
    );
    let (first, second) = tokio::join!(first, second);

    assert_eq!(
        [first.0, second.0]
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        [first.0, second.0]
            .iter()
            .filter(|status| **status == StatusCode::CONFLICT)
            .count(),
        1
    );
    let (updated, conflict) = if first.0 == StatusCode::OK {
        (&first.1, &second.1)
    } else {
        (&second.1, &first.1)
    };
    assert_eq!(updated["data"]["expense"]["version"], "2");
    assert_eq!(conflict["error"]["code"], "VERSION_CONFLICT");

    let (status, final_expense) =
        response(&context, request(&context, "GET", uri, json!(null))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(final_expense["data"]["expense"]["version"], "2");
    assert!(matches!(
        final_expense["data"]["expense"]["title"].as_str(),
        Some("Concurrent Sushi A" | "Concurrent Sushi B")
    ));
    assert_eq!(activity_side_effects(&context).await, (3, 2));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn concurrent_settlement_updates_with_same_version_apply_once() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let collection_uri = format!("/api/activities/{}/settlements", context.activity_id);
    let (status, created) = response(
        &context,
        request(
            &context,
            "POST",
            collection_uri,
            settlement_payload(&context, Uuid::new_v4(), "1"),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let settlement_id = created["data"]["settlement"]["settlementId"]
        .as_str()
        .expect("应返回 Settlement ID");
    assert_eq!(activity_side_effects(&context).await, (2, 1));
    let uri = format!(
        "/api/activities/{}/settlements/{settlement_id}",
        context.activity_id
    );
    let first_update = json!({
        "version": "1",
        "payerMemberId": context.owner_member_id,
        "receiverMemberId": context.guest_member_id,
        "amountMinor": "2"
    });
    let second_update = json!({
        "version": "1",
        "payerMemberId": context.owner_member_id,
        "receiverMemberId": context.guest_member_id,
        "amountMinor": "3"
    });

    let first = response(
        &context,
        request(&context, "PUT", uri.clone(), first_update),
    );
    let second = response(
        &context,
        request(&context, "PUT", uri.clone(), second_update),
    );
    let (first, second) = tokio::join!(first, second);

    assert_eq!(
        [first.0, second.0]
            .iter()
            .filter(|status| **status == StatusCode::OK)
            .count(),
        1
    );
    assert_eq!(
        [first.0, second.0]
            .iter()
            .filter(|status| **status == StatusCode::CONFLICT)
            .count(),
        1
    );
    let (updated, conflict) = if first.0 == StatusCode::OK {
        (&first.1, &second.1)
    } else {
        (&second.1, &first.1)
    };
    assert_eq!(updated["data"]["settlement"]["version"], "2");
    assert_eq!(conflict["error"]["code"], "VERSION_CONFLICT");

    let (status, final_settlement) =
        response(&context, request(&context, "GET", uri, json!(null))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(final_settlement["data"]["settlement"]["version"], "2");
    assert!(matches!(
        final_settlement["data"]["settlement"]["amountMinor"].as_str(),
        Some("2" | "3")
    ));
    assert_eq!(activity_side_effects(&context).await, (3, 2));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn deletion_and_expense_creation_serialize_without_orphans() {
    let _guard = DATABASE_TEST_LOCK.lock().await;
    let context = seed_context().await;
    let deletion = context.app.clone().oneshot(request(
        &context,
        "DELETE",
        format!("/api/activities/{}", context.activity_id),
        json!({"version":"1"}),
    ));
    let creation = context.app.clone().oneshot(request(
        &context,
        "POST",
        format!("/api/activities/{}/expenses", context.activity_id),
        expense_payload(&context, Uuid::new_v4(), "并发账单"),
    ));
    let (deleted, created) = tokio::join!(deletion, creation);
    assert_eq!(deleted.unwrap().status(), StatusCode::NO_CONTENT);
    assert!(matches!(
        created.unwrap().status(),
        StatusCode::CREATED | StatusCode::FORBIDDEN
    ));
    for table in [
        "expenses",
        "expense_payments",
        "expense_shares",
        "activity_members",
        "activity_audit_logs",
        "notifications",
    ] {
        let count: i64 = sqlx::query_scalar(&format!(
            "SELECT count(*) FROM {table} WHERE activity_id = $1"
        ))
        .bind(context.activity_id)
        .fetch_one(&context.pool)
        .await
        .unwrap();
        assert_eq!(count, 0, "{table} 不得残留");
    }
}
