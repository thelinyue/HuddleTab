use std::{fs, io::Cursor, path::Path};

use huddletab_server::{
    application::attachment::{
        AttachmentError, UploadAttachmentInput, download_attachment, upload_attachment,
    },
    infrastructure::{
        attachment_repository::PostgresAttachmentRepository,
        attachment_store::LocalAttachmentStore, database::connect_and_migrate,
    },
};
use image::{DynamicImage, ImageFormat, RgbaImage};
use sqlx::PgPool;
use tempfile::TempDir;
use time::OffsetDateTime;
use uuid::Uuid;

struct Context {
    pool: PgPool,
    uploads: TempDir,
    activity_id: Uuid,
    expense_id: Uuid,
    owner_user_id: Uuid,
    member_user_id: Uuid,
    outsider_user_id: Uuid,
}

impl Context {
    fn repository(&self) -> PostgresAttachmentRepository {
        PostgresAttachmentRepository::new(
            self.pool.clone(),
            LocalAttachmentStore::new(self.uploads.path()).expect("临时上传目录应可用"),
        )
    }

    fn input(&self, actor_user_id: Uuid, client_attachment_id: Uuid) -> UploadAttachmentInput {
        UploadAttachmentInput {
            activity_id: self.activity_id,
            expense_id: self.expense_id,
            actor_user_id,
            client_attachment_id,
            declared_mime: "image/png".to_owned(),
            bytes: png_1_by_1(),
        }
    }
}

async fn seed_context() -> Context {
    let database_url = std::env::var("TEST_DATABASE_URL").expect("应提供 TEST_DATABASE_URL");
    let pool = connect_and_migrate(&database_url)
        .await
        .expect("测试数据库应可迁移");
    sqlx::query("TRUNCATE users CASCADE")
        .execute(&pool)
        .await
        .expect("应清空测试数据");

    let activity_id = Uuid::new_v4();
    let expense_id = Uuid::new_v4();
    let owner_user_id = Uuid::new_v4();
    let member_user_id = Uuid::new_v4();
    let outsider_user_id = Uuid::new_v4();
    let owner_member_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let now = OffsetDateTime::now_utc();
    let mut transaction = pool.begin().await.expect("应开启测试事务");
    sqlx::query(
        "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at)
         VALUES ($1, 'attachment-owner', 'unused', 'Owner', $4, $4),
                ($2, 'attachment-member', 'unused', 'Member', $4, $4),
                ($3, 'attachment-outsider', 'unused', 'Outsider', $4, $4)",
    )
    .bind(owner_user_id)
    .bind(member_user_id)
    .bind(outsider_user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入测试用户");
    sqlx::query(
        "INSERT INTO activities (
            id, name, base_currency, start_date, owner_member_id, created_by_user_id,
            status, revision, created_at, updated_at
         ) VALUES ($1, '附件活动', 'CNY', '2026-09-02', $2, $3, 'ACTIVE', 1, $4, $4)",
    )
    .bind(activity_id)
    .bind(owner_member_id)
    .bind(owner_user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动");
    sqlx::query(
        "INSERT INTO activity_members (
            id, activity_id, user_id, display_name, role, status, joined_at
         ) VALUES ($1, $3, $4, 'Owner', 'OWNER', 'ACTIVE', $6),
                  ($2, $3, $5, 'Member', 'MEMBER', 'ACTIVE', $6)",
    )
    .bind(owner_member_id)
    .bind(member_id)
    .bind(activity_id)
    .bind(owner_user_id)
    .bind(member_user_id)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入活动成员");
    sqlx::query(
        "INSERT INTO expenses (
            id, activity_id, created_by_user_id, client_mutation_id, title, category,
            occurred_at, original_currency, original_amount_minor, base_currency,
            base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, '附件账单', 'OTHER', $5, 'CNY', 100, 'CNY',
                   100, 'IDENTITY', 1, 'EXACT', $5, $5)",
    )
    .bind(expense_id)
    .bind(activity_id)
    .bind(owner_user_id)
    .bind(Uuid::new_v4())
    .bind(now)
    .execute(&mut *transaction)
    .await
    .expect("应插入 Expense");
    transaction.commit().await.expect("应提交测试数据");

    Context {
        pool,
        uploads: tempfile::tempdir().expect("应创建临时上传目录"),
        activity_id,
        expense_id,
        owner_user_id,
        member_user_id,
        outsider_user_id,
    }
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn upload_is_idempotent_concurrent_and_limited_to_three() {
    let context = seed_context().await;
    let repository = context.repository();
    let first_client_id = Uuid::new_v4();
    let first = upload_attachment(
        &repository,
        context.input(context.member_user_id, first_client_id),
    )
    .await
    .expect("ACTIVE 成员首次上传应成功");
    assert!(!first.idempotent_replay);
    assert_eq!(facts(&context).await, (1, 1, 2, 1));

    let replay = upload_attachment(
        &repository,
        context.input(context.member_user_id, first_client_id),
    )
    .await
    .expect("同一客户端附件应幂等重放");
    assert!(replay.idempotent_replay);
    assert_eq!(replay.attachment.id, first.attachment.id);
    assert_eq!(facts(&context).await, (1, 1, 2, 1));

    let concurrent_client_id = Uuid::new_v4();
    let left_repository = repository.clone();
    let right_repository = repository.clone();
    let left_input = context.input(context.member_user_id, concurrent_client_id);
    let right_input = context.input(context.member_user_id, concurrent_client_id);
    let (left, right) = tokio::join!(
        upload_attachment(&left_repository, left_input),
        upload_attachment(&right_repository, right_input),
    );
    let left = left.expect("并发上传左侧应成功");
    let right = right.expect("并发上传右侧应成功");
    assert_eq!(left.attachment.id, right.attachment.id);
    assert_ne!(left.idempotent_replay, right.idempotent_replay);
    assert_eq!(facts(&context).await, (2, 2, 3, 2));

    upload_attachment(
        &repository,
        context.input(context.member_user_id, Uuid::new_v4()),
    )
    .await
    .expect("第三张附件应成功");
    assert_eq!(facts(&context).await, (3, 3, 4, 3));
    let fourth = upload_attachment(
        &repository,
        context.input(context.member_user_id, Uuid::new_v4()),
    )
    .await;
    assert_eq!(fourth.unwrap_err(), AttachmentError::LimitReached);
    assert_eq!(facts(&context).await, (3, 3, 4, 3));
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
// 同一附件跨 ACTIVE、LEFT 与活动生命周期验证，避免重复 fixture 掩盖读取权限变化。
#[allow(clippy::too_many_lines)]
async fn upload_and_download_enforce_membership_lifecycle_and_nested_ids() {
    let context = seed_context().await;
    let repository = context.repository();
    let uploaded = upload_attachment(
        &repository,
        context.input(context.member_user_id, Uuid::new_v4()),
    )
    .await
    .expect("ACTIVE 成员应可上传");

    sqlx::query("UPDATE activity_members SET status = 'LEFT', left_at = NOW() WHERE user_id = $1")
        .bind(context.member_user_id)
        .execute(&context.pool)
        .await
        .expect("应把成员标记为 LEFT");
    assert_eq!(
        upload_attachment(
            &repository,
            context.input(context.member_user_id, Uuid::new_v4()),
        )
        .await
        .unwrap_err(),
        AttachmentError::Forbidden
    );
    let downloaded = download_attachment(
        &repository,
        context.activity_id,
        context.expense_id,
        uploaded.attachment.id,
        context.member_user_id,
    )
    .await
    .expect("LEFT 历史成员仍应可读取可见附件");
    assert_eq!(downloaded.attachment_id, uploaded.attachment.id);
    assert_eq!(&downloaded.bytes[..4], b"RIFF");

    for (activity_id, expense_id) in [
        (Uuid::new_v4(), context.expense_id),
        (context.activity_id, Uuid::new_v4()),
    ] {
        assert_eq!(
            download_attachment(
                &repository,
                activity_id,
                expense_id,
                uploaded.attachment.id,
                context.owner_user_id,
            )
            .await
            .unwrap_err(),
            AttachmentError::NotFound
        );
    }
    assert_eq!(
        download_attachment(
            &repository,
            context.activity_id,
            context.expense_id,
            uploaded.attachment.id,
            context.outsider_user_id,
        )
        .await
        .unwrap_err(),
        AttachmentError::NotFound
    );

    sqlx::query("UPDATE activities SET status = $1 WHERE id = $2")
        .bind("ENDED")
        .bind(context.activity_id)
        .execute(&context.pool)
        .await
        .expect("应更新活动状态");
    assert_eq!(
        upload_attachment(
            &repository,
            context.input(context.owner_user_id, Uuid::new_v4()),
        )
        .await
        .unwrap_err(),
        AttachmentError::Forbidden
    );
    sqlx::query("UPDATE activities SET status = 'ARCHIVED' WHERE id = $1")
        .bind(context.activity_id)
        .execute(&context.pool)
        .await
        .expect("应归档活动");
    assert_eq!(
        upload_attachment(
            &repository,
            context.input(context.owner_user_id, Uuid::new_v4()),
        )
        .await
        .unwrap_err(),
        AttachmentError::Forbidden
    );
    sqlx::query(
        "UPDATE activities
         SET status = 'ACTIVE', deleted_at = NOW(), purge_after = NOW() + INTERVAL '30 days'
         WHERE id = $1",
    )
    .bind(context.activity_id)
    .execute(&context.pool)
    .await
    .expect("应软删除活动");
    assert_eq!(
        upload_attachment(
            &repository,
            context.input(context.owner_user_id, Uuid::new_v4()),
        )
        .await
        .unwrap_err(),
        AttachmentError::Forbidden
    );
}

#[tokio::test]
#[ignore = "需要 TEST_DATABASE_URL 指向可丢弃的 PostgreSQL 测试库"]
async fn metadata_failure_removes_file_without_revision_or_audit() {
    let context = seed_context().await;
    let repository = context.repository();
    sqlx::query(
        "ALTER TABLE expense_attachments
         ADD CONSTRAINT attachment_test_reject_insert CHECK (byte_size < 0)",
    )
    .execute(&context.pool)
    .await
    .expect("应安装测试专用失败约束");

    let result = upload_attachment(
        &repository,
        context.input(context.owner_user_id, Uuid::new_v4()),
    )
    .await;
    sqlx::query("ALTER TABLE expense_attachments DROP CONSTRAINT attachment_test_reject_insert")
        .execute(&context.pool)
        .await
        .expect("应移除测试专用失败约束");

    assert_eq!(result.unwrap_err(), AttachmentError::Unavailable);
    assert_eq!(facts(&context).await, (0, 0, 1, 0));
}

async fn facts(context: &Context) -> (i64, i64, i64, usize) {
    let attachments: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM expense_attachments")
        .fetch_one(&context.pool)
        .await
        .expect("应统计附件");
    let audits: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM activity_audit_logs WHERE action = 'ATTACHMENT_UPLOADED'",
    )
    .fetch_one(&context.pool)
    .await
    .expect("应统计附件 Audit");
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM activities WHERE id = $1")
        .bind(context.activity_id)
        .fetch_one(&context.pool)
        .await
        .expect("应读取 Activity revision");
    (
        attachments,
        audits,
        revision,
        count_files(context.uploads.path()),
    )
}

fn count_files(root: &Path) -> usize {
    let mut count = 0;
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).expect("应遍历临时上传目录") {
            let path = entry.expect("目录项应有效").path();
            if path.is_dir() {
                directories.push(path);
            } else if path.is_file() {
                count += 1;
            }
        }
    }
    count
}

fn png_1_by_1() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(RgbaImage::new(1, 1))
        .write_to(&mut bytes, ImageFormat::Png)
        .expect("测试图片应可编码");
    bytes.into_inner()
}
