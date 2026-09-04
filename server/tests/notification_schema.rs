use huddletab_server::infrastructure::database::connect_and_migrate;
use sqlx::{PgPool, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

async fn seed_activity(transaction: &mut Transaction<'_, Postgres>) -> (Uuid, Uuid) {
    let user_id = Uuid::new_v4();
    let activity_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    sqlx::query("INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) VALUES ($1, $2, 'unused', 'Alice', $3, $3)")
        .bind(user_id).bind(format!("user{}", &user_id.simple().to_string()[..12])).bind(now).execute(&mut **transaction).await.expect("应插入用户");
    sqlx::query("INSERT INTO activities (id, name, base_currency, start_date, owner_member_id, created_by_user_id, created_at, updated_at) VALUES ($1, '通知约束', 'CNY', '2026-09-02', $2, $3, $4, $4)")
        .bind(activity_id).bind(member_id).bind(user_id).bind(now).execute(&mut **transaction).await.expect("应插入活动");
    sqlx::query("INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) VALUES ($1, $2, $3, 'Alice', 'OWNER', $4)")
        .bind(member_id).bind(activity_id).bind(user_id).bind(now).execute(&mut **transaction).await.expect("应插入成员");
    (user_id, activity_id)
}

async fn insert_notification(
    pool: &PgPool,
    recipient: Uuid,
    activity_id: Uuid,
    kind: &str,
    target_type: &str,
    target_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO notifications (id, recipient_user_id, type, target_type, target_id, activity_id, payload, created_at) VALUES ($1, $2, $3, $4, $5, $6, '{}', NOW())")
        .bind(Uuid::new_v4()).bind(recipient).bind(kind).bind(target_type).bind(target_id).bind(activity_id).execute(pool).await.map(|_| ())
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn notification_schema_accepts_only_frozen_kind_target_pairs() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let mut transaction = pool.begin().await.expect("应开始事务");
    let (recipient, activity_id) = seed_activity(&mut transaction).await;
    transaction.commit().await.expect("应提交测试事实");

    for (kind, target_type) in [
        ("MEMBER_JOINED", "ACTIVITY"),
        ("PARTICIPATING_EXPENSE_CHANGED", "EXPENSE"),
        ("PARTICIPATING_EXPENSE_DELETED", "EXPENSE"),
        ("SETTLEMENT_RECEIVED", "SETTLEMENT"),
        ("ACTIVITY_STATUS_CHANGED", "ACTIVITY"),
        ("OWNERSHIP_CHANGED", "ACTIVITY"),
    ] {
        let target_id = if target_type == "ACTIVITY" {
            activity_id
        } else {
            Uuid::new_v4()
        };
        insert_notification(&pool, recipient, activity_id, kind, target_type, target_id)
            .await
            .unwrap_or_else(|error| panic!("{kind}/{target_type} 应合法：{error}"));
    }
    let invalid = insert_notification(
        &pool,
        recipient,
        activity_id,
        "SETTLEMENT_RECEIVED",
        "EXPENSE",
        Uuid::new_v4(),
    )
    .await
    .expect_err("错误 kind/target 组合必须被数据库拒绝");
    assert_eq!(
        invalid
            .as_database_error()
            .and_then(|error| error.constraint()),
        Some("notifications_kind_target")
    );
}
