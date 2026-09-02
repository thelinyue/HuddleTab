use huddletab_server::infrastructure::database::connect_and_migrate;
use sqlx::{Executor, Postgres, Transaction};
use uuid::Uuid;

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn composite_member_foreign_keys_and_single_owner_are_enforced() {
    let database_url = std::env::var("TEST_DATABASE_URL")
        .expect("运行 Schema 集成测试前必须设置 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试库应可 migration");
    let mut transaction = pool.begin().await.expect("应可开始测试事务");

    let first_user = Uuid::new_v4();
    let second_user = Uuid::new_v4();
    let first_activity = Uuid::new_v4();
    let second_activity = Uuid::new_v4();
    let first_owner = Uuid::new_v4();
    let second_owner = Uuid::new_v4();
    insert_user(&mut transaction, first_user, "schema-user-a").await;
    insert_user(&mut transaction, second_user, "schema-user-b").await;
    insert_activity_and_owner(&mut transaction, first_activity, first_owner, first_user).await;
    insert_activity_and_owner(&mut transaction, second_activity, second_owner, second_user).await;

    let expense = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO expenses (
            id, activity_id, created_by_user_id, client_mutation_id, title, category,
            occurred_at, original_currency, original_amount_minor, base_currency,
            base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, '测试账单', 'OTHER', NOW(), 'CNY', 100, 'CNY',
                   100, 'IDENTITY', 1, 'EXACT', NOW(), NOW())",
    )
    .bind(expense)
    .bind(first_activity)
    .bind(first_user)
    .bind(Uuid::new_v4())
    .execute(&mut *transaction)
    .await
    .expect("合法账单应可创建");

    transaction
        .execute("SAVEPOINT cross_activity_member")
        .await
        .expect("应可建立 savepoint");
    let cross_activity_error = sqlx::query(
        "INSERT INTO expense_payments (
            id, activity_id, expense_id, payer_member_id, original_currency,
            original_amount_minor, base_currency, base_amount_minor
         ) VALUES ($1, $2, $3, $4, 'CNY', 100, 'CNY', 100)",
    )
    .bind(Uuid::new_v4())
    .bind(first_activity)
    .bind(expense)
    .bind(second_owner)
    .execute(&mut *transaction)
    .await
    .expect_err("跨活动 payer 必须被复合外键拒绝");
    assert_eq!(
        constraint_name(&cross_activity_error),
        Some("expense_payments_activity_id_payer_member_id_fkey")
    );
    transaction
        .execute("ROLLBACK TO SAVEPOINT cross_activity_member")
        .await
        .expect("应可恢复 savepoint");

    transaction
        .execute("SAVEPOINT duplicate_owner")
        .await
        .expect("应可建立 savepoint");
    let duplicate_owner_error = sqlx::query(
        "INSERT INTO activity_members (
            id, activity_id, user_id, display_name, role, status, joined_at
         ) VALUES ($1, $2, NULL, '第二 Owner', 'OWNER', 'ACTIVE', NOW())",
    )
    .bind(Uuid::new_v4())
    .bind(first_activity)
    .execute(&mut *transaction)
    .await
    .expect_err("同一活动第二个 Owner 必须被唯一索引拒绝");
    assert_eq!(
        constraint_name(&duplicate_owner_error),
        Some("activity_members_one_owner_idx")
    );

    transaction.rollback().await.expect("测试事务应可回滚");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn join_requests_enforce_mode_pending_uniqueness_and_activity_identity() {
    let database_url = std::env::var("TEST_DATABASE_URL")
        .expect("运行 Schema 集成测试前必须设置 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试库应可 migration");
    let mut transaction = pool.begin().await.expect("应可开始测试事务");

    let applicant = Uuid::new_v4();
    let first_owner_user = Uuid::new_v4();
    let second_owner_user = Uuid::new_v4();
    let first_activity = Uuid::new_v4();
    let second_activity = Uuid::new_v4();
    let first_owner = Uuid::new_v4();
    let second_owner = Uuid::new_v4();
    insert_user(&mut transaction, applicant, "join-applicant").await;
    insert_user(&mut transaction, first_owner_user, "join-owner-a").await;
    insert_user(&mut transaction, second_owner_user, "join-owner-b").await;
    insert_activity_and_owner(
        &mut transaction,
        first_activity,
        first_owner,
        first_owner_user,
    )
    .await;
    insert_activity_and_owner(
        &mut transaction,
        second_activity,
        second_owner,
        second_owner_user,
    )
    .await;

    assert_invite_mode_constraints(&mut transaction, first_activity).await;

    let first_invitation = insert_invitation(&mut transaction, first_activity, first_owner).await;
    let second_invitation =
        insert_invitation(&mut transaction, second_activity, second_owner).await;
    assert_pending_join_request_uniqueness(
        &mut transaction,
        first_activity,
        first_invitation,
        applicant,
        first_owner,
    )
    .await;
    assert_invitation_activity_identity(
        &mut transaction,
        first_activity,
        second_invitation,
        second_owner_user,
    )
    .await;

    transaction.rollback().await.expect("测试事务应可回滚");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 同一事务连续验证跨活动外键和三种绑定邀请形状，避免重复建库数据掩盖约束关系。
#[allow(clippy::too_many_lines)]
async fn guest_binding_invites_enforce_activity_identity_and_shape() {
    let database_url = std::env::var("TEST_DATABASE_URL")
        .expect("运行 Schema 集成测试前必须设置 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试库应可 migration");
    let mut transaction = pool.begin().await.expect("应可开始测试事务");

    let first_owner_user = Uuid::new_v4();
    let second_owner_user = Uuid::new_v4();
    let first_activity = Uuid::new_v4();
    let second_activity = Uuid::new_v4();
    let first_owner = Uuid::new_v4();
    let second_owner = Uuid::new_v4();
    let first_guest = Uuid::new_v4();
    let second_guest = Uuid::new_v4();
    insert_user(&mut transaction, first_owner_user, "binding-owner-a").await;
    insert_user(&mut transaction, second_owner_user, "binding-owner-b").await;
    insert_activity_and_owner(
        &mut transaction,
        first_activity,
        first_owner,
        first_owner_user,
    )
    .await;
    insert_activity_and_owner(
        &mut transaction,
        second_activity,
        second_owner,
        second_owner_user,
    )
    .await;
    insert_guest(&mut transaction, first_guest, first_activity, "临时成员甲").await;
    insert_guest(
        &mut transaction,
        second_guest,
        second_activity,
        "临时成员乙",
    )
    .await;

    transaction
        .execute("SAVEPOINT cross_activity_binding")
        .await
        .expect("应可建立 savepoint");
    let cross_activity = insert_binding_invitation(
        &mut transaction,
        first_activity,
        first_owner,
        "DIRECT",
        Some("target-a"),
        Some(1),
        second_guest,
    )
    .await
    .expect_err("绑定邀请不能引用其他活动成员");
    assert_eq!(
        constraint_name(&cross_activity),
        Some("activity_invites_activity_guest_member_fkey")
    );
    transaction
        .execute("ROLLBACK TO SAVEPOINT cross_activity_binding")
        .await
        .expect("应可恢复 savepoint");

    for (savepoint, kind, target_username, max_uses) in [
        ("binding_link", "LINK", None, Some(1)),
        ("binding_without_target", "DIRECT", None, Some(1)),
        ("binding_multiple_uses", "DIRECT", Some("target-a"), Some(2)),
    ] {
        transaction
            .execute(format!("SAVEPOINT {savepoint}").as_str())
            .await
            .expect("应可建立 savepoint");
        let invalid = insert_binding_invitation(
            &mut transaction,
            first_activity,
            first_owner,
            kind,
            target_username,
            max_uses,
            first_guest,
        )
        .await
        .expect_err("非法绑定邀请形状必须被数据库拒绝");
        assert_eq!(
            constraint_name(&invalid),
            Some("activity_invites_guest_binding_shape")
        );
        transaction
            .execute(format!("ROLLBACK TO SAVEPOINT {savepoint}").as_str())
            .await
            .expect("应可恢复 savepoint");
    }

    insert_binding_invitation(
        &mut transaction,
        first_activity,
        first_owner,
        "DIRECT",
        Some("target-a"),
        Some(1),
        first_guest,
    )
    .await
    .expect("同活动的定向单次绑定邀请应可创建");

    transaction.rollback().await.expect("测试事务应可回滚");
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn expense_attachments_enforce_idempotency_and_positive_metadata() {
    let database_url = std::env::var("TEST_DATABASE_URL")
        .expect("运行 Schema 集成测试前必须设置 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试库应可 migration");
    let mut transaction = pool.begin().await.expect("应可开始测试事务");

    let user_id = Uuid::new_v4();
    let activity_id = Uuid::new_v4();
    let owner_member_id = Uuid::new_v4();
    let expense_id = Uuid::new_v4();
    let client_attachment_id = Uuid::new_v4();
    insert_user(&mut transaction, user_id, "attachment-owner").await;
    insert_activity_and_owner(&mut transaction, activity_id, owner_member_id, user_id).await;
    sqlx::query(
        "INSERT INTO expenses (
            id, activity_id, created_by_user_id, client_mutation_id, title, category,
            occurred_at, original_currency, original_amount_minor, base_currency,
            base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, '附件约束账单', 'OTHER', NOW(), 'CNY', 100, 'CNY',
                   100, 'IDENTITY', 1, 'EXACT', NOW(), NOW())",
    )
    .bind(expense_id)
    .bind(activity_id)
    .bind(user_id)
    .bind(Uuid::new_v4())
    .execute(&mut *transaction)
    .await
    .expect("合法账单应可创建");

    insert_attachment(
        &mut transaction,
        expense_id,
        client_attachment_id,
        "first.webp",
        640,
        480,
        1234,
    )
    .await
    .expect("合法附件元数据应可创建");

    transaction
        .execute("SAVEPOINT duplicate_attachment")
        .await
        .expect("应可建立 savepoint");
    let duplicate = insert_attachment(
        &mut transaction,
        expense_id,
        client_attachment_id,
        "duplicate.webp",
        640,
        480,
        1234,
    )
    .await
    .expect_err("同一账单的客户端附件 ID 必须唯一");
    assert_eq!(
        constraint_name(&duplicate),
        Some("expense_attachments_expense_client_uq")
    );
    transaction
        .execute("ROLLBACK TO SAVEPOINT duplicate_attachment")
        .await
        .expect("应可恢复 savepoint");

    transaction
        .execute("SAVEPOINT zero_attachment_size")
        .await
        .expect("应可建立 savepoint");
    let zero_size = insert_attachment(
        &mut transaction,
        expense_id,
        Uuid::new_v4(),
        "zero.webp",
        640,
        480,
        0,
    )
    .await
    .expect_err("附件尺寸与字节数必须为正数");
    assert_eq!(
        constraint_name(&zero_size),
        Some("expense_attachments_positive_dimensions_and_size")
    );

    transaction.rollback().await.expect("测试事务应可回滚");
}

async fn assert_invite_mode_constraints(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
) {
    let default_mode: String =
        sqlx::query_scalar("SELECT invite_mode FROM activities WHERE id = $1")
            .bind(activity_id)
            .fetch_one(&mut **transaction)
            .await
            .expect("新活动应有默认邀请模式");
    assert_eq!(default_mode, "DIRECT_JOIN");

    transaction
        .execute("SAVEPOINT invalid_invite_mode")
        .await
        .expect("应可建立 savepoint");
    sqlx::query("UPDATE activities SET invite_mode = 'PER_INVITE' WHERE id = $1")
        .bind(activity_id)
        .execute(&mut **transaction)
        .await
        .expect_err("数据库必须拒绝未冻结的邀请模式");
    transaction
        .execute("ROLLBACK TO SAVEPOINT invalid_invite_mode")
        .await
        .expect("应可恢复 savepoint");
}

async fn assert_pending_join_request_uniqueness(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
    invitation_id: Uuid,
    applicant_user_id: Uuid,
    owner_member_id: Uuid,
) {
    let first_request = Uuid::new_v4();
    insert_join_request(
        transaction,
        first_request,
        activity_id,
        invitation_id,
        applicant_user_id,
    )
    .await;

    transaction
        .execute("SAVEPOINT duplicate_pending")
        .await
        .expect("应可建立 savepoint");
    let duplicate = sqlx::query(
        "INSERT INTO activity_join_requests (
            id, activity_id, invitation_id, applicant_user_id, created_at
         ) VALUES ($1, $2, $3, $4, NOW())",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(invitation_id)
    .bind(applicant_user_id)
    .execute(&mut **transaction)
    .await
    .expect_err("同一活动和用户只能有一个 Pending 申请");
    assert_eq!(
        constraint_name(&duplicate),
        Some("activity_join_requests_one_pending_per_user")
    );
    transaction
        .execute("ROLLBACK TO SAVEPOINT duplicate_pending")
        .await
        .expect("应可恢复 savepoint");

    sqlx::query(
        "UPDATE activity_join_requests
         SET status = 'REJECTED', decided_by_member_id = $1, decided_at = NOW()
         WHERE id = $2",
    )
    .bind(owner_member_id)
    .bind(first_request)
    .execute(&mut **transaction)
    .await
    .expect("关闭旧申请后应释放 Pending 唯一约束");
    insert_join_request(
        transaction,
        Uuid::new_v4(),
        activity_id,
        invitation_id,
        applicant_user_id,
    )
    .await;
}

async fn assert_invitation_activity_identity(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
    other_activity_invitation_id: Uuid,
    applicant_user_id: Uuid,
) {
    transaction
        .execute("SAVEPOINT cross_activity_invitation")
        .await
        .expect("应可建立 savepoint");
    let cross_activity = sqlx::query(
        "INSERT INTO activity_join_requests (
            id, activity_id, invitation_id, applicant_user_id, created_at
         ) VALUES ($1, $2, $3, $4, NOW())",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(other_activity_invitation_id)
    .bind(applicant_user_id)
    .execute(&mut **transaction)
    .await
    .expect_err("申请不能引用其他活动的邀请");
    assert_eq!(
        constraint_name(&cross_activity),
        Some("activity_join_requests_activity_id_invitation_id_fkey")
    );
}

async fn insert_user(transaction: &mut Transaction<'_, Postgres>, id: Uuid, username: &str) {
    sqlx::query(
        "INSERT INTO users (
            id, username, password_hash, display_name, created_at, updated_at
         ) VALUES ($1, $2, 'test-only-hash', $2, NOW(), NOW())",
    )
    .bind(id)
    .bind(username)
    .execute(&mut **transaction)
    .await
    .expect("测试用户应可创建");
}

async fn insert_guest(
    transaction: &mut Transaction<'_, Postgres>,
    id: Uuid,
    activity_id: Uuid,
    display_name: &str,
) {
    sqlx::query(
        "INSERT INTO activity_members (
            id, activity_id, display_name, role, status, joined_at
         ) VALUES ($1, $2, $3, 'MEMBER', 'ACTIVE', NOW())",
    )
    .bind(id)
    .bind(activity_id)
    .bind(display_name)
    .execute(&mut **transaction)
    .await
    .expect("测试 Guest 应可创建");
}

async fn insert_binding_invitation(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
    owner_member_id: Uuid,
    kind: &str,
    target_username: Option<&str>,
    max_uses: Option<i32>,
    guest_member_id: Uuid,
) -> Result<(), sqlx::Error> {
    let invitation_id = Uuid::new_v4();
    let token_hash = [
        activity_id.as_bytes().as_slice(),
        invitation_id.as_bytes().as_slice(),
    ]
    .concat();
    sqlx::query(
        "INSERT INTO activity_invites (
            id, activity_id, created_by_member_id, token_hash, kind, target_username,
            expires_at, max_uses, guest_member_id, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '1 day', $7, $8, NOW())",
    )
    .bind(invitation_id)
    .bind(activity_id)
    .bind(owner_member_id)
    .bind(token_hash)
    .bind(kind)
    .bind(target_username)
    .bind(max_uses)
    .bind(guest_member_id)
    .execute(&mut **transaction)
    .await
    .map(|_| ())
}

async fn insert_activity_and_owner(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
    owner_member_id: Uuid,
    user_id: Uuid,
) {
    sqlx::query(
        "INSERT INTO activities (
            id, name, base_currency, start_date, owner_member_id, created_by_user_id, created_at, updated_at
         ) VALUES ($1, '测试活动', 'CNY', '2026-08-30', $2, $3, NOW(), NOW())",
    )
    .bind(activity_id)
    .bind(owner_member_id)
    .bind(user_id)
    .execute(&mut **transaction)
    .await
    .expect("测试活动应可创建");
    sqlx::query(
        "INSERT INTO activity_members (
            id, activity_id, user_id, display_name, role, status, joined_at
         ) VALUES ($1, $2, $3, 'Owner', 'OWNER', 'ACTIVE', NOW())",
    )
    .bind(owner_member_id)
    .bind(activity_id)
    .bind(user_id)
    .execute(&mut **transaction)
    .await
    .expect("测试 Owner 应可创建");
}

fn constraint_name(error: &sqlx::Error) -> Option<&str> {
    error
        .as_database_error()
        .and_then(|error| error.constraint())
}

async fn insert_invitation(
    transaction: &mut Transaction<'_, Postgres>,
    activity_id: Uuid,
    owner_member_id: Uuid,
) -> Uuid {
    let invitation_id = Uuid::new_v4();
    let token_hash = [
        activity_id.as_bytes().as_slice(),
        invitation_id.as_bytes().as_slice(),
    ]
    .concat();
    sqlx::query(
        "INSERT INTO activity_invites (
            id, activity_id, created_by_member_id, token_hash, kind,
            expires_at, created_at
         ) VALUES ($1, $2, $3, $4, 'LINK', NOW() + INTERVAL '1 day', NOW())",
    )
    .bind(invitation_id)
    .bind(activity_id)
    .bind(owner_member_id)
    .bind(token_hash)
    .execute(&mut **transaction)
    .await
    .expect("测试邀请应可创建");
    invitation_id
}

async fn insert_join_request(
    transaction: &mut Transaction<'_, Postgres>,
    request_id: Uuid,
    activity_id: Uuid,
    invitation_id: Uuid,
    applicant_user_id: Uuid,
) {
    sqlx::query(
        "INSERT INTO activity_join_requests (
            id, activity_id, invitation_id, applicant_user_id, created_at
         ) VALUES ($1, $2, $3, $4, NOW())",
    )
    .bind(request_id)
    .bind(activity_id)
    .bind(invitation_id)
    .bind(applicant_user_id)
    .execute(&mut **transaction)
    .await
    .expect("合法 Pending 申请应可创建");
}

async fn insert_attachment(
    transaction: &mut Transaction<'_, Postgres>,
    expense_id: Uuid,
    client_attachment_id: Uuid,
    storage_key: &str,
    width: i32,
    height: i32,
    byte_size: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO expense_attachments (
            id, expense_id, client_attachment_id, storage_key, mime_type,
            width, height, byte_size, created_at
         ) VALUES ($1, $2, $3, $4, 'image/webp', $5, $6, $7, NOW())",
    )
    .bind(Uuid::new_v4())
    .bind(expense_id)
    .bind(client_attachment_id)
    .bind(storage_key)
    .bind(width)
    .bind(height)
    .bind(byte_size)
    .execute(&mut **transaction)
    .await
    .map(|_| ())
}
