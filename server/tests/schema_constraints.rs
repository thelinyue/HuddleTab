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
