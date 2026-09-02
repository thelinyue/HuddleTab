use async_trait::async_trait;
use sqlx::{FromRow, PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::{
    attachment::{
        AttachmentRepository, AttachmentRepositoryError, DownloadedAttachment,
        UploadAttachmentInput, UploadAttachmentResult,
    },
    expense::ExpenseAttachmentRecord,
};

use super::{
    attachment_image::{AttachmentImageError, ProcessedAttachment, process_attachment_image},
    attachment_store::{AttachmentStoreError, LocalAttachmentStore},
};

#[derive(Clone, Debug)]
pub struct PostgresAttachmentRepository {
    pool: PgPool,
    store: LocalAttachmentStore,
}

impl PostgresAttachmentRepository {
    #[must_use]
    pub fn new(pool: PgPool, store: LocalAttachmentStore) -> Self {
        Self { pool, store }
    }
}

#[derive(FromRow)]
struct AttachmentRow {
    id: Uuid,
    mime_type: String,
    width: i32,
    height: i32,
    byte_size: i64,
    created_at: OffsetDateTime,
}

#[derive(FromRow)]
struct DownloadRow {
    attachment_id: Uuid,
    storage_key: String,
}

#[async_trait]
impl AttachmentRepository for PostgresAttachmentRepository {
    async fn upload(
        &self,
        input: UploadAttachmentInput,
    ) -> Result<UploadAttachmentResult, AttachmentRepositoryError> {
        authorize_upload(
            &self.pool,
            input.activity_id,
            input.expense_id,
            input.actor_user_id,
        )
        .await?;
        if let Some(attachment) =
            load_by_client_id(&self.pool, input.expense_id, input.client_attachment_id).await?
        {
            return Ok(UploadAttachmentResult {
                attachment,
                idempotent_replay: true,
            });
        }

        let processed = process_attachment_image(&input.bytes, &input.declared_mime)
            .map_err(map_image_error)?;
        self.persist_processed(input, processed).await
    }

    async fn download(
        &self,
        activity_id: Uuid,
        expense_id: Uuid,
        attachment_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<DownloadedAttachment, AttachmentRepositoryError> {
        let row = sqlx::query_as::<_, DownloadRow>(
            "SELECT attachment.id AS attachment_id, attachment.storage_key
             FROM expense_attachments attachment
             JOIN expenses expense ON expense.id = attachment.expense_id
             JOIN activities activity ON activity.id = expense.activity_id
             JOIN activity_members member ON member.activity_id = activity.id
             WHERE activity.id = $1 AND expense.id = $2 AND attachment.id = $3
               AND member.user_id = $4 AND member.status IN ('ACTIVE', 'LEFT')
               AND activity.deleted_at IS NULL AND expense.deleted_at IS NULL",
        )
        .bind(activity_id)
        .bind(expense_id)
        .bind(attachment_id)
        .bind(actor_user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(log_database_error)?
        .ok_or(AttachmentRepositoryError::NotFound)?;
        let bytes = self.store.read(&row.storage_key).await.map_err(|error| {
            drop(row.storage_key);
            map_download_store_error(error)
        })?;
        Ok(DownloadedAttachment {
            attachment_id: row.attachment_id,
            bytes,
        })
    }
}

impl PostgresAttachmentRepository {
    async fn persist_processed(
        &self,
        input: UploadAttachmentInput,
        processed: ProcessedAttachment,
    ) -> Result<UploadAttachmentResult, AttachmentRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_database_error)?;
        let actor_member_id =
            lock_activity(&mut transaction, input.activity_id, input.actor_user_id).await?;
        lock_expense(&mut transaction, input.activity_id, input.expense_id).await?;
        if let Some(attachment) = load_by_client_id(
            &mut *transaction,
            input.expense_id,
            input.client_attachment_id,
        )
        .await?
        {
            transaction.commit().await.map_err(log_database_error)?;
            return Ok(UploadAttachmentResult {
                attachment,
                idempotent_replay: true,
            });
        }
        let count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM expense_attachments WHERE expense_id = $1",
        )
        .bind(input.expense_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_database_error)?;
        if count >= 3 {
            return Err(AttachmentRepositoryError::LimitReached);
        }

        let attachment_id = Uuid::new_v4();
        let storage_key = format!(
            "{}/{}/{}.webp",
            input.activity_id, input.expense_id, attachment_id
        );
        self.store
            .write(&storage_key, &processed.bytes)
            .await
            .map_err(map_upload_store_error)?;
        let created_at = OffsetDateTime::now_utc();
        let insert_result = insert_metadata(
            &mut transaction,
            attachment_id,
            input.expense_id,
            input.client_attachment_id,
            &storage_key,
            &processed,
            created_at,
        )
        .await;
        if let Err(error) = insert_result {
            compensate_file(&self.store, &storage_key).await;
            return Err(error);
        }
        let audit_result = revise_and_audit(
            &mut transaction,
            input.activity_id,
            input.actor_user_id,
            actor_member_id,
            attachment_id,
            created_at,
        )
        .await;
        if let Err(error) = audit_result {
            compensate_file(&self.store, &storage_key).await;
            return Err(error);
        }
        if let Err(error) = transaction.commit().await {
            drop(error);
            tracing::error!("附件元数据事务提交失败");
            compensate_file(&self.store, &storage_key).await;
            return Err(AttachmentRepositoryError::Unavailable);
        }
        Ok(UploadAttachmentResult {
            attachment: ExpenseAttachmentRecord {
                id: attachment_id,
                mime_type: processed.mime_type.to_owned(),
                width: processed.width,
                height: processed.height,
                byte_size: i64::try_from(processed.bytes.len())
                    .map_err(|_| AttachmentRepositoryError::ImageInvalid)?,
                created_at,
            },
            idempotent_replay: false,
        })
    }
}

async fn authorize_upload(
    pool: &PgPool,
    activity_id: Uuid,
    expense_id: Uuid,
    actor_user_id: Uuid,
) -> Result<(), AttachmentRepositoryError> {
    let allowed = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM activities activity
            JOIN activity_members member ON member.activity_id = activity.id
            WHERE activity.id = $1 AND activity.status = 'ACTIVE'
              AND activity.deleted_at IS NULL AND member.user_id = $2
              AND member.status = 'ACTIVE'
         )",
    )
    .bind(activity_id)
    .bind(actor_user_id)
    .fetch_one(pool)
    .await
    .map_err(log_database_error)?;
    if !allowed {
        return Err(AttachmentRepositoryError::Forbidden);
    }
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(
            SELECT 1 FROM expenses WHERE id = $1 AND activity_id = $2 AND deleted_at IS NULL
         )",
    )
    .bind(expense_id)
    .bind(activity_id)
    .fetch_one(pool)
    .await
    .map_err(log_database_error)?;
    if !exists {
        return Err(AttachmentRepositoryError::NotFound);
    }
    Ok(())
}

async fn lock_activity(
    connection: &mut PgConnection,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Uuid, AttachmentRepositoryError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT member.id FROM activities activity
         JOIN activity_members member ON member.activity_id = activity.id
         WHERE activity.id = $1 AND activity.status = 'ACTIVE'
           AND activity.deleted_at IS NULL AND member.user_id = $2
           AND member.status = 'ACTIVE' FOR UPDATE OF activity",
    )
    .bind(activity_id)
    .bind(actor_user_id)
    .fetch_optional(connection)
    .await
    .map_err(log_database_error)?
    .ok_or(AttachmentRepositoryError::Forbidden)
}

async fn lock_expense(
    connection: &mut PgConnection,
    activity_id: Uuid,
    expense_id: Uuid,
) -> Result<(), AttachmentRepositoryError> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT id FROM expenses
         WHERE id = $1 AND activity_id = $2 AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(expense_id)
    .bind(activity_id)
    .fetch_optional(connection)
    .await
    .map_err(log_database_error)?
    .ok_or(AttachmentRepositoryError::NotFound)?;
    Ok(())
}

async fn load_by_client_id<'e, E>(
    executor: E,
    expense_id: Uuid,
    client_attachment_id: Uuid,
) -> Result<Option<ExpenseAttachmentRecord>, AttachmentRepositoryError>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query_as::<_, AttachmentRow>(
        "SELECT id, mime_type, width, height, byte_size, created_at
         FROM expense_attachments WHERE expense_id = $1 AND client_attachment_id = $2",
    )
    .bind(expense_id)
    .bind(client_attachment_id)
    .fetch_optional(executor)
    .await
    .map_err(log_database_error)
    .map(|row| row.map(attachment_from_row))
}

async fn insert_metadata(
    connection: &mut PgConnection,
    attachment_id: Uuid,
    expense_id: Uuid,
    client_attachment_id: Uuid,
    storage_key: &str,
    processed: &ProcessedAttachment,
    created_at: OffsetDateTime,
) -> Result<(), AttachmentRepositoryError> {
    let byte_size = i64::try_from(processed.bytes.len())
        .map_err(|_| AttachmentRepositoryError::ImageInvalid)?;
    sqlx::query(
        "INSERT INTO expense_attachments (
            id, expense_id, client_attachment_id, storage_key, mime_type,
            width, height, byte_size, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(attachment_id)
    .bind(expense_id)
    .bind(client_attachment_id)
    .bind(storage_key)
    .bind(processed.mime_type)
    .bind(processed.width)
    .bind(processed.height)
    .bind(byte_size)
    .bind(created_at)
    .execute(connection)
    .await
    .map_err(log_database_error)?;
    Ok(())
}

async fn revise_and_audit(
    connection: &mut PgConnection,
    activity_id: Uuid,
    actor_user_id: Uuid,
    actor_member_id: Uuid,
    attachment_id: Uuid,
    now: OffsetDateTime,
) -> Result<(), AttachmentRepositoryError> {
    let revision = sqlx::query_scalar::<_, i64>(
        "UPDATE activities SET revision = revision + 1, updated_at = $1
         WHERE id = $2 RETURNING revision",
    )
    .bind(now)
    .bind(activity_id)
    .fetch_one(&mut *connection)
    .await
    .map_err(log_database_error)?;
    sqlx::query(
        "INSERT INTO activity_audit_logs (
            id, activity_id, actor_user_id, actor_member_id, action,
            resource_type, resource_id, activity_revision, created_at
         ) VALUES ($1, $2, $3, $4, 'ATTACHMENT_UPLOADED', 'ATTACHMENT', $5, $6, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(actor_user_id)
    .bind(actor_member_id)
    .bind(attachment_id)
    .bind(revision)
    .bind(now)
    .execute(connection)
    .await
    .map_err(log_database_error)?;
    Ok(())
}

fn attachment_from_row(row: AttachmentRow) -> ExpenseAttachmentRecord {
    ExpenseAttachmentRecord {
        id: row.id,
        mime_type: row.mime_type,
        width: row.width,
        height: row.height,
        byte_size: row.byte_size,
        created_at: row.created_at,
    }
}

fn map_image_error(error: AttachmentImageError) -> AttachmentRepositoryError {
    match error {
        AttachmentImageError::TooLarge => AttachmentRepositoryError::TooLarge,
        AttachmentImageError::TypeNotAllowed => AttachmentRepositoryError::TypeNotAllowed,
        AttachmentImageError::MimeMismatch => AttachmentRepositoryError::MimeMismatch,
        AttachmentImageError::PixelLimitExceeded | AttachmentImageError::InvalidImage => {
            AttachmentRepositoryError::ImageInvalid
        }
    }
}

fn map_upload_store_error(error: AttachmentStoreError) -> AttachmentRepositoryError {
    let _ = error;
    AttachmentRepositoryError::StorageUnavailable
}

fn map_download_store_error(error: AttachmentStoreError) -> AttachmentRepositoryError {
    match error {
        AttachmentStoreError::NotFound => AttachmentRepositoryError::MissingFile,
        AttachmentStoreError::InvalidKey | AttachmentStoreError::Unavailable => {
            AttachmentRepositoryError::StorageUnavailable
        }
    }
}

async fn compensate_file(store: &LocalAttachmentStore, storage_key: &str) {
    if store.remove(storage_key).await.is_err() {
        tracing::error!("附件事务失败后无法删除临时落盘文件，稍后将由孤立文件清理器处理");
    }
}

fn log_database_error(error: sqlx::Error) -> AttachmentRepositoryError {
    drop(error);
    tracing::error!("附件数据库事务执行失败");
    AttachmentRepositoryError::Unavailable
}
