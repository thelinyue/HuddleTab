use async_trait::async_trait;
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::notification::{
    NotificationRepository, NotificationRepositoryError, NotificationView,
};

#[derive(Clone, Debug)]
pub struct PostgresNotificationRepository {
    pool: PgPool,
}

impl PostgresNotificationRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[derive(FromRow)]
struct NotificationRow {
    id: Uuid,
    recipient_user_id: Uuid,
    kind: String,
    target_type: String,
    target_id: Uuid,
    activity_id: Uuid,
    activity_deleted: bool,
    payload: Value,
    read_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
}

#[async_trait]
impl NotificationRepository for PostgresNotificationRepository {
    async fn list(
        &self,
        recipient_user_id: Uuid,
    ) -> Result<(Vec<NotificationView>, usize), NotificationRepositoryError> {
        let rows = sqlx::query_as::<_, NotificationRow>(
            "SELECT notifications.id, notifications.recipient_user_id,
                    notifications.type AS kind, notifications.target_type,
                    notifications.target_id, notifications.activity_id,
                    activity.deleted_at IS NOT NULL AS activity_deleted,
                    notifications.payload, notifications.read_at, notifications.created_at
             FROM notifications
             JOIN activities activity ON activity.id = notifications.activity_id
             WHERE notifications.recipient_user_id = $1
             ORDER BY (notifications.read_at IS NOT NULL), notifications.created_at DESC,
                      notifications.id
             LIMIT 50",
        )
        .bind(recipient_user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(log_repository_error)?;
        let unread_count = sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL",
        )
        .bind(recipient_user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(log_repository_error)?;
        Ok((
            rows.into_iter().map(notification_from_row).collect(),
            usize::try_from(unread_count).map_err(|_| NotificationRepositoryError::Unavailable)?,
        ))
    }

    async fn mark_read(
        &self,
        notification_id: Uuid,
        recipient_user_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<NotificationView, NotificationRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        sqlx::query(
            "UPDATE notifications SET read_at = $3
             WHERE id = $1 AND recipient_user_id = $2 AND read_at IS NULL",
        )
        .bind(notification_id)
        .bind(recipient_user_id)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        // 已读更新和活动删除状态在同一事务内读取，避免响应继续暴露可跳转的旧状态。
        let row = sqlx::query_as::<_, NotificationRow>(
            "SELECT notification.id, notification.recipient_user_id,
                    notification.type AS kind, notification.target_type,
                    notification.target_id, notification.activity_id,
                    activity.deleted_at IS NOT NULL AS activity_deleted,
                    notification.payload, notification.read_at, notification.created_at
             FROM notifications notification
             JOIN activities activity ON activity.id = notification.activity_id
             WHERE notification.id = $1 AND notification.recipient_user_id = $2",
        )
        .bind(notification_id)
        .bind(recipient_user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(NotificationRepositoryError::NotFound)?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(notification_from_row(row))
    }
}

fn notification_from_row(row: NotificationRow) -> NotificationView {
    NotificationView {
        id: row.id,
        recipient_user_id: row.recipient_user_id,
        kind: row.kind,
        target_type: row.target_type,
        target_id: row.target_id,
        activity_id: row.activity_id,
        activity_deleted: row.activity_deleted,
        payload: row.payload,
        read_at: row.read_at,
        created_at: row.created_at,
    }
}

fn log_repository_error(error: sqlx::Error) -> NotificationRepositoryError {
    tracing::error!(%error, "读取或更新通知失败");
    drop(error);
    NotificationRepositoryError::Unavailable
}
