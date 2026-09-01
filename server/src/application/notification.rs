use async_trait::async_trait;
use serde_json::Value;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::ports::Clock;

#[derive(Clone, Debug)]
pub struct NotificationView {
    pub id: Uuid,
    pub recipient_user_id: Uuid,
    pub kind: String,
    pub target_type: String,
    pub target_id: Uuid,
    pub activity_id: Uuid,
    pub payload: Value,
    pub read_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct NotificationList {
    pub items: Vec<NotificationView>,
    pub unread_count: usize,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum NotificationRepositoryError {
    #[error("通知不存在")]
    NotFound,
    #[error("通知数据访问失败")]
    Unavailable,
}

#[async_trait]
pub trait NotificationRepository: Send + Sync {
    async fn list(
        &self,
        recipient_user_id: Uuid,
    ) -> Result<Vec<NotificationView>, NotificationRepositoryError>;

    async fn mark_read(
        &self,
        notification_id: Uuid,
        recipient_user_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<NotificationView, NotificationRepositoryError>;
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum NotificationError {
    #[error("通知不存在")]
    NotFound,
    #[error("通知数据不完整")]
    Integrity,
    #[error("通知服务暂时不可用")]
    Unavailable,
}

/// 返回当前用户的通知，未读数量只从同一批已授权记录计算。
///
/// # Errors
///
/// 存储不可用时返回通知服务错误。
pub async fn list_notifications(
    repository: &dyn NotificationRepository,
    recipient_user_id: Uuid,
) -> Result<NotificationList, NotificationError> {
    let items = repository
        .list(recipient_user_id)
        .await
        .map_err(map_repository_error)?;
    let unread_count = items.iter().filter(|item| item.read_at.is_none()).count();
    Ok(NotificationList {
        items,
        unread_count,
    })
}

/// 幂等标记当前用户拥有的通知为已读，重复调用保留首次已读时间。
///
/// # Errors
///
/// 通知不存在、不属于当前用户或存储不可用时返回对应错误。
pub async fn mark_notification_read(
    repository: &dyn NotificationRepository,
    clock: &dyn Clock,
    notification_id: Uuid,
    recipient_user_id: Uuid,
) -> Result<NotificationView, NotificationError> {
    repository
        .mark_read(notification_id, recipient_user_id, clock.now())
        .await
        .map_err(map_repository_error)
}

fn map_repository_error(error: NotificationRepositoryError) -> NotificationError {
    match error {
        NotificationRepositoryError::NotFound => NotificationError::NotFound,
        NotificationRepositoryError::Unavailable => NotificationError::Unavailable,
    }
}
