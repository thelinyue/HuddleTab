use std::time::Duration as StdDuration;

use huddletab_server::infrastructure::{
    attachment_cleanup::{CleanupResult, cleanup_orphan_attachments},
    attachment_store::LocalAttachmentStore,
    database::connect_and_migrate,
};
use sqlx::{PgPool, postgres::PgPoolOptions};
use time::OffsetDateTime;
use uuid::Uuid;

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn cleanup_deletes_only_old_unreferenced_regular_files() {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");
    let expense_id = seed_expense(&pool).await;
    let root = tempfile::tempdir().expect("应创建临时上传目录");
    let store = LocalAttachmentStore::new(root.path()).expect("上传目录应可用");
    let old_referenced = storage_key(expense_id);
    let old_orphan = storage_key(expense_id);
    let recent_orphan = storage_key(expense_id);
    store
        .write(&old_referenced, b"referenced")
        .await
        .expect("应写入旧引用文件");
    store
        .write(&old_orphan, b"orphan")
        .await
        .expect("应写入旧孤儿文件");
    insert_metadata(&pool, expense_id, &old_referenced).await;
    tokio::time::sleep(StdDuration::from_millis(20)).await;
    let cutoff = OffsetDateTime::now_utc();
    tokio::time::sleep(StdDuration::from_millis(20)).await;
    store
        .write(&recent_orphan, b"recent")
        .await
        .expect("应写入最近孤儿文件");

    #[cfg(unix)]
    let symlink_outside = tempfile::tempdir().expect("应创建 symlink 外部目录");
    #[cfg(unix)]
    let symlink_target = {
        use std::os::unix::fs::symlink;
        let target = symlink_outside.path().join("outside-keep.webp");
        std::fs::write(&target, b"keep").expect("应写入 symlink 目标");
        symlink(&target, root.path().join("ignored.webp")).expect("应创建测试 symlink");
        target
    };

    let result = cleanup_orphan_attachments(&pool, &store, cutoff)
        .await
        .expect("清理应成功");
    assert_eq!(
        result,
        CleanupResult {
            scanned: 3,
            deleted: 1,
        }
    );
    assert_eq!(store.read(&old_referenced).await.unwrap(), b"referenced");
    assert!(store.read(&old_orphan).await.is_err());
    assert_eq!(store.read(&recent_orphan).await.unwrap(), b"recent");
    #[cfg(unix)]
    assert_eq!(std::fs::read(symlink_target).unwrap(), b"keep");
}

#[tokio::test]
async fn missing_uploads_directory_returns_zero_without_database_access() {
    let root = tempfile::tempdir().expect("应创建临时目录");
    let store = LocalAttachmentStore::new(root.path()).expect("上传目录应可用");
    std::fs::remove_dir(root.path()).expect("应移除空上传目录");
    let unavailable_pool = PgPoolOptions::new()
        .connect_lazy("postgresql://unused:unused@127.0.0.1:1/unused")
        .expect("无连接池应可延迟创建");

    assert_eq!(
        cleanup_orphan_attachments(&unavailable_pool, &store, OffsetDateTime::now_utc())
            .await
            .expect("无目录不需要访问数据库"),
        CleanupResult {
            scanned: 0,
            deleted: 0,
        }
    );
}

#[tokio::test]
async fn database_failure_keeps_old_file() {
    let root = tempfile::tempdir().expect("应创建临时上传目录");
    let store = LocalAttachmentStore::new(root.path()).expect("上传目录应可用");
    let key = format!(
        "{}/{}/{}.webp",
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4()
    );
    store.write(&key, b"keep").await.expect("应写入测试文件");
    let unavailable_pool = PgPoolOptions::new()
        .acquire_timeout(StdDuration::from_millis(50))
        .connect_lazy("postgresql://unused:unused@127.0.0.1:1/unused")
        .expect("无连接池应可延迟创建");

    assert!(
        cleanup_orphan_attachments(
            &unavailable_pool,
            &store,
            OffsetDateTime::now_utc() + time::Duration::seconds(1),
        )
        .await
        .is_err()
    );
    assert_eq!(store.read(&key).await.unwrap(), b"keep");
}

async fn seed_expense(pool: &PgPool) -> Uuid {
    let user_id = Uuid::new_v4();
    let activity_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let expense_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let mut transaction = pool.begin().await.expect("应开启测试事务");
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
         VALUES ($1, 'cleanup-owner', 'unused', 'Owner', $2, $2)",
    )
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入用户");
    sqlx::query(
        "INSERT INTO activities (
            id, name, base_currency, start_date, owner_member_id, created_by_user_id,
            created_at, updated_at
         ) VALUES ($1, '清理活动', 'CNY', '2026-09-02', $2, $3, $4, $4)",
    )
    .bind(activity_id)
    .bind(member_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动");
    sqlx::query(
        "INSERT INTO activity_members (
            id, activity_id, user_id, display_name, role, joined_at
         ) VALUES ($1, $2, $3, 'Owner', 'OWNER', $4)",
    )
    .bind(member_id)
    .bind(activity_id)
    .bind(user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入成员");
    sqlx::query(
        "INSERT INTO expenses (
            id, activity_id, created_by_user_id, client_mutation_id, title, category,
            occurred_at, original_currency, original_amount_minor, base_currency,
            base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, '清理账单', 'OTHER', $5, 'CNY', 100, 'CNY',
                   100, 'IDENTITY', 1, 'EXACT', $5, $5)",
    )
    .bind(expense_id)
    .bind(activity_id)
    .bind(user_id)
    .bind(Uuid::new_v4())
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入 Expense");
    transaction.commit().await.expect("应提交 fixture");
    expense_id
}

async fn insert_metadata(pool: &PgPool, expense_id: Uuid, storage_key: &str) {
    sqlx::query(
        "INSERT INTO expense_attachments (
            id, expense_id, client_attachment_id, storage_key, mime_type,
            width, height, byte_size, created_at
         ) VALUES ($1, $2, $3, $4, 'image/webp', 1, 1, 10, NOW())",
    )
    .bind(Uuid::new_v4())
    .bind(expense_id)
    .bind(Uuid::new_v4())
    .bind(storage_key)
    .execute(pool)
    .await
    .expect("应插入引用元数据");
}

fn storage_key(expense_id: Uuid) -> String {
    format!("{expense_id}/{expense_id}/{}.webp", Uuid::new_v4())
}
