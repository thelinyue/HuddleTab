use huddletab_server::{
    application::activity::{ActivityVersionInput, delete_activity},
    infrastructure::activity_repository::PostgresActivityRepository,
};
use sqlx::PgPool;
use uuid::Uuid;

/// 权限回归测试通过真实事务删除夹具，避免继续依赖已经移除的软删除字段。
#[allow(dead_code)]
pub async fn delete(pool: &PgPool, activity_id: Uuid) {
    let (actor, version): (Uuid, i64) = sqlx::query_as("SELECT m.user_id, a.version FROM activities a JOIN activity_members m ON m.id = a.owner_member_id WHERE a.id = $1")
        .bind(activity_id).fetch_one(pool).await.expect("应读取删除夹具所有者");
    delete_activity(
        &PostgresActivityRepository::new(pool.clone()),
        ActivityVersionInput {
            activity_id,
            actor_user_id: actor,
            version: version.to_string(),
        },
    )
    .await
    .expect("应永久删除活动夹具");
}

/// 构造跨成员、账单和结算的 RESTRICT 引用，确保删除测试覆盖真实依赖顺序。
#[allow(dead_code)]
pub async fn seed_related(pool: &PgPool, activity: Uuid, user: Uuid, owner: Uuid) -> Vec<String> {
    let guest = Uuid::new_v4();
    let expense = Uuid::new_v4();
    let settlement = Uuid::new_v4();
    let invite = Uuid::new_v4();
    let notification = Uuid::new_v4();
    let subscription = Uuid::new_v4();
    let image = Uuid::new_v4();
    let cover = Uuid::new_v4();
    let attachment_key = format!("{activity}/{expense}/{image}.webp");
    let cover_key = format!("covers/{activity}/{cover}.webp");
    // 所有插值均来自本测试生成的 UUID 或由这些 UUID 组成的路径。
    sqlx::raw_sql(&format!(r"
        INSERT INTO activity_members (id, activity_id, display_name, role, joined_at)
            VALUES ('{guest}', '{activity}', '临时成员', 'MEMBER', NOW());
        INSERT INTO expenses (id, activity_id, created_by_user_id, client_mutation_id, title, category, occurred_at,
            original_currency, original_amount_minor, base_currency, base_amount_minor, exchange_rate_kind,
            exchange_rate, split_mode, created_at, updated_at)
            VALUES ('{expense}', '{activity}', '{user}', gen_random_uuid(), '删除测试', 'OTHER', NOW(), 'JPY', 100, 'JPY', 100, 'IDENTITY', 1, 'EQUAL', NOW(), NOW());
        INSERT INTO expense_payments (id, activity_id, expense_id, payer_member_id, original_currency, original_amount_minor, base_currency, base_amount_minor)
            VALUES (gen_random_uuid(), '{activity}', '{expense}', '{owner}', 'JPY', 100, 'JPY', 100);
        INSERT INTO expense_shares (id, activity_id, expense_id, member_id, original_currency, original_amount_minor, base_currency, base_amount_minor)
            VALUES (gen_random_uuid(), '{activity}', '{expense}', '{guest}', 'JPY', 100, 'JPY', 100);
        INSERT INTO settlements (id, activity_id, created_by_user_id, client_mutation_id, payer_member_id, receiver_member_id, currency, amount_minor, created_at, updated_at)
            VALUES ('{settlement}', '{activity}', '{user}', gen_random_uuid(), '{guest}', '{owner}', 'JPY', 100, NOW(), NOW());
        INSERT INTO settlement_allocations (activity_id, settlement_id, expense_id, amount_minor, created_at)
            VALUES ('{activity}', '{settlement}', '{expense}', 100, NOW());
        INSERT INTO activity_invites (id, activity_id, created_by_member_id, token_hash, kind, expires_at, created_at)
            VALUES ('{invite}', '{activity}', '{owner}', decode(repeat('ab', 32), 'hex'), 'LINK', NOW() + interval '1 day', NOW());
        INSERT INTO activity_join_requests (id, activity_id, invitation_id, applicant_user_id, status, decided_by_member_id, decided_at, created_at)
            VALUES (gen_random_uuid(), '{activity}', '{invite}', '{user}', 'APPROVED', '{owner}', NOW(), NOW());
        INSERT INTO notifications (id, recipient_user_id, type, target_type, target_id, activity_id, created_at)
            VALUES ('{notification}', '{user}', 'ACTIVITY_STATUS_CHANGED', 'ACTIVITY', '{activity}', '{activity}', NOW());
        INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
            VALUES ('{subscription}', '{user}', 'https://example.invalid/{subscription}', 'test', 'test', NOW(), NOW());
        INSERT INTO notification_push_deliveries (id, notification_id, subscription_id, next_attempt_at, created_at, updated_at)
            VALUES (gen_random_uuid(), '{notification}', '{subscription}', NOW(), NOW(), NOW());
        INSERT INTO expense_attachments (id, expense_id, client_attachment_id, storage_key, mime_type, width, height, byte_size, created_at)
            VALUES ('{image}', '{expense}', gen_random_uuid(), '{attachment_key}', 'image/webp', 1, 1, 4, NOW());
        INSERT INTO activity_cover_images (activity_id, image_id, storage_key, width, height, byte_size, created_at, updated_at)
            VALUES ('{activity}', '{cover}', '{cover_key}', 1200, 900, 4, NOW(), NOW());
    ")).execute(pool).await.expect("应建立完整删除夹具");
    vec![attachment_key, cover_key]
}
