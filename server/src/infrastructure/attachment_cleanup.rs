use std::{path::PathBuf, time::Duration};

use sqlx::PgPool;
use thiserror::Error;
use time::OffsetDateTime;

use super::attachment_store::{AttachmentStoreError, LocalAttachmentStore};

const CLEANUP_INTERVAL: Duration = Duration::from_hours(24);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CleanupResult {
    pub scanned: usize,
    pub deleted: usize,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AttachmentCleanupError {
    #[error("无法扫描或删除附件文件")]
    Storage,
    #[error("无法核对附件数据库元数据")]
    Database,
}

/// 清理超过截止时间且数据库明确不存在元数据的普通 WebP 文件。
///
/// # Errors
///
/// 文件系统扫描、数据库查询或删除失败时立即停止并返回对应错误；数据库不可用时不删除文件。
pub async fn cleanup_orphan_attachments(
    pool: &PgPool,
    store: &LocalAttachmentStore,
    cutoff: OffsetDateTime,
) -> Result<CleanupResult, AttachmentCleanupError> {
    let scan = store
        .files_older_than(cutoff)
        .await
        .map_err(map_store_error)?;
    let mut deleted = 0;
    for file in scan.candidates {
        let referenced = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
                SELECT 1 FROM expense_attachments WHERE storage_key = $1
             )",
        )
        .bind(&file.storage_key)
        .fetch_one(pool)
        .await
        .map_err(|error| {
            drop(error);
            AttachmentCleanupError::Database
        })?;
        if referenced {
            continue;
        }
        store
            .remove(&file.storage_key)
            .await
            .map_err(map_store_error)?;
        deleted += 1;
    }
    Ok(CleanupResult {
        scanned: scan.scanned,
        deleted,
    })
}

/// 启动单一顺序清理循环：进程启动后立即执行一次，之后每 24 小时执行一次。
pub fn spawn_attachment_cleanup(pool: PgPool, uploads_dir: PathBuf) {
    tokio::spawn(async move {
        let store = match LocalAttachmentStore::new(uploads_dir) {
            Ok(store) => store,
            Err(error) => {
                let _ = error;
                tracing::error!("无法启动孤立附件清理，请检查数据目录权限");
                return;
            }
        };
        let mut interval = tokio::time::interval(CLEANUP_INTERVAL);
        loop {
            interval.tick().await;
            let cutoff = OffsetDateTime::now_utc() - time::Duration::hours(24);
            match cleanup_orphan_attachments(&pool, &store, cutoff).await {
                Ok(result) => tracing::info!(
                    scanned = result.scanned,
                    deleted = result.deleted,
                    "孤立附件清理完成"
                ),
                Err(error) => {
                    tracing::error!(error = %error, "孤立附件清理失败，请检查数据库和数据目录权限");
                }
            }
        }
    });
}

fn map_store_error(error: AttachmentStoreError) -> AttachmentCleanupError {
    let _ = error;
    AttachmentCleanupError::Storage
}
