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
use tower::ServiceExt as _;
use uuid::Uuid;

struct AccountingContext {
    pool: PgPool,
    app: axum::Router,
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
        activity_id,
        owner_member_id,
        guest_member_id,
        session,
        csrf,
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
        "exchangeRateKind": "MANUAL",
        "exchangeRate": "7.2",
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
    let item_uri = format!(
        "/api/activities/{}/settlements/{settlement_id}",
        context.activity_id
    );
    for uri in [collection_uri.clone(), item_uri.clone()] {
        let (status, _) = response(context, request(context, "GET", uri, json!(null))).await;
        assert_eq!(status, StatusCode::OK);
    }
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
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
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
    let expense_id = created["data"]["expense"]["expenseId"]
        .as_str()
        .expect("应返回 Expense ID");
    assert_eq!(created["data"]["expense"]["baseAmountMinor"], "7207");
    assert_eq!(
        fact_sum(&created["data"]["payments"], "baseAmountMinor"),
        7207
    );
    assert_eq!(
        fact_sum(&created["data"]["shares"], "baseAmountMinor"),
        7207
    );

    let (status, replay) =
        response(&context, request(&context, "POST", uri, payload.clone())).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replay["data"]["idempotentReplay"], true);
    assert_eq!(replay["data"]["expense"]["expenseId"], expense_id);

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

    let mut update = expense_payload(&context, mutation_id, "Updated Sushi");
    update["version"] = json!("1");
    let (status, updated) = response(
        &context,
        request(&context, "PUT", item_uri.clone(), update.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["data"]["expense"]["version"], "2");
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
                "amountMinor": recommendation["amountMinor"]
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

    sqlx::query(
        "UPDATE activities SET status = 'ENDED', deleted_at = now(), \
         purge_after = now() + interval '30 days' WHERE id = $1",
    )
    .bind(context.activity_id)
    .execute(&context.pool)
    .await
    .expect("应删除活动");
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

    sqlx::query(
        "UPDATE activities SET deleted_at = now(), purge_after = now() + interval '30 days' \
         WHERE id = $1",
    )
    .bind(context.activity_id)
    .execute(&context.pool)
    .await
    .expect("应软删除活动");
    for uri in read_uris {
        let (status, _) = response(&context, request(&context, "GET", uri, json!(null))).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn soft_deleted_active_activity_rejects_expense_creation() {
    let context = seed_context().await;
    sqlx::query(
        "UPDATE activities SET deleted_at = now(), purge_after = now() + interval '30 days' \
         WHERE id = $1",
    )
    .bind(context.activity_id)
    .execute(&context.pool)
    .await
    .expect("应软删除活动");

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
