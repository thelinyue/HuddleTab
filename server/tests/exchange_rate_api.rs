use std::sync::Arc;

use async_trait::async_trait;
use axum::{
    body::Body,
    http::{Request, StatusCode, header::COOKIE},
};
use http_body_util::BodyExt as _;
use huddletab_server::{
    application::exchange_rate::{
        ExchangeRateProvider, ExchangeRateProviderError, ProviderExchangeRate,
    },
    http::router::{AppState, router_with_state},
    infrastructure::{app_secret::AppSecret, database::connect_and_migrate, session::SessionToken},
};
use serde_json::Value;
use time::{Date, Duration, OffsetDateTime, macros::date};
use tower::ServiceExt as _;
use uuid::Uuid;

#[derive(Clone)]
struct FakeProvider {
    value: Result<ProviderExchangeRate, ExchangeRateProviderError>,
}

#[async_trait]
impl ExchangeRateProvider for FakeProvider {
    async fn get_rate(
        &self,
        _from: &str,
        _to: &str,
        _date: Date,
    ) -> Result<ProviderExchangeRate, ExchangeRateProviderError> {
        self.value.clone()
    }
}

async fn insert_session(pool: &sqlx::PgPool, user_id: Uuid, now: OffsetDateTime) -> SessionToken {
    let session = SessionToken::generate();
    let hash = session.sha256_hash();
    sqlx::query(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
         idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
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

fn get(uri: String, session: Option<&SessionToken>) -> Request<Body> {
    let mut builder = Request::builder().uri(uri);
    if let Some(session) = session {
        builder = builder.header(
            COOKIE,
            format!("huddletab_session={}", session.expose_for_cookie()),
        );
    }
    builder.body(Body::empty()).expect("应构造请求")
}

async fn json(response: axum::response::Response) -> Value {
    serde_json::from_slice(
        &response
            .into_body()
            .collect()
            .await
            .expect("应读取响应")
            .to_bytes(),
    )
    .expect("应返回 JSON")
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
#[allow(clippy::too_many_lines)]
async fn authorized_suggestion_uses_provider_then_cache_and_keeps_errors_json() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    sqlx::query("TRUNCATE exchange_rate_cache")
        .execute(&pool)
        .await
        .expect("应清空汇率缓存");
    let user_id = Uuid::new_v4();
    let outsider_id = Uuid::new_v4();
    let activity_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
         VALUES ($1, 'rate_owner', 'unused', '汇率用户', $3, $3), \
                ($2, 'rate_outsider', 'unused', '外部用户', $3, $3)",
    )
    .bind(user_id)
    .bind(outsider_id)
    .bind(now)
    .execute(&pool)
    .await
    .expect("应插入用户");
    let mut transaction = pool.begin().await.expect("应开启事务");
    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *transaction)
        .await
        .expect("应延迟循环外键");
    sqlx::query(
        "INSERT INTO activities (id, name, base_currency, start_date, owner_member_id, \
         created_by_user_id, created_at, updated_at) \
         VALUES ($1, '汇率活动', 'CNY', '2026-08-30', $2, $3, $4, $4)",
    )
    .bind(activity_id)
    .bind(member_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动");
    sqlx::query(
        "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) \
         VALUES ($1, $2, $3, '汇率用户', 'OWNER', $4)",
    )
    .bind(member_id)
    .bind(activity_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入成员");
    transaction.commit().await.expect("应提交活动和成员");
    let session = insert_session(&pool, user_id, now).await;
    let outsider = insert_session(&pool, outsider_id, now).await;
    let state = AppState::new(
        pool.clone(),
        AppSecret::from_bytes([41; 32]),
        "http://localhost:5660".to_owned(),
    )
    .with_exchange_rate_provider(Arc::new(FakeProvider {
        value: Ok(ProviderExchangeRate {
            rate: "0.0420900".to_owned(),
            provider: "FRANKFURTER".to_owned(),
            reference_date: date!(2026 - 08 - 30),
        }),
    }));
    let app = router_with_state(None, state);
    let uri = format!("/api/activities/{activity_id}/exchange-rate?from=JPY&date=2026-08-30");

    let first = app
        .clone()
        .oneshot(get(uri.clone(), Some(&session)))
        .await
        .expect("请求应完成");
    assert_eq!(first.status(), StatusCode::OK);
    let first_body = json(first).await;
    assert_eq!(first_body["data"]["rate"], "0.04209");
    assert_eq!(first_body["data"]["source"], "PROVIDER");
    assert_eq!(first_body["data"]["referenceDate"], "2026-08-30");

    let second = app
        .clone()
        .oneshot(get(uri, Some(&session)))
        .await
        .expect("请求应完成");
    assert_eq!(json(second).await["data"]["source"], "CACHE");

    let forbidden = app
        .clone()
        .oneshot(get(
            format!("/api/activities/{activity_id}/exchange-rate?from=JPY&date=2026-08-30"),
            Some(&outsider),
        ))
        .await
        .expect("请求应完成");
    assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);

    let invalid = app
        .oneshot(get(
            format!("/api/activities/{activity_id}/exchange-rate?from=JPY&date=2099-01-01"),
            Some(&session),
        ))
        .await
        .expect("请求应完成");
    assert_eq!(invalid.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        json(invalid).await["error"]["code"],
        "INVALID_EXCHANGE_RATE_QUERY"
    );

    sqlx::query("TRUNCATE exchange_rate_cache")
        .execute(&pool)
        .await
        .expect("应清空缓存");
    let unavailable_app = router_with_state(
        None,
        AppState::new(
            pool.clone(),
            AppSecret::from_bytes([42; 32]),
            "http://localhost:5660".to_owned(),
        )
        .with_exchange_rate_provider(Arc::new(FakeProvider {
            value: Err(ExchangeRateProviderError::Unavailable),
        })),
    );

    let response = unavailable_app
        .oneshot(get(
            format!("/api/activities/{activity_id}/exchange-rate?from=USD&date=2026-08-30"),
            Some(&session),
        ))
        .await
        .expect("请求应完成");
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = json(response).await;
    assert_eq!(body["error"]["code"], "EXCHANGE_RATE_UNAVAILABLE");
    assert_eq!(
        body["error"]["message"],
        "暂时无法获取参考汇率，请手动输入。"
    );
}
