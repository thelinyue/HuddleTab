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
    /// 活动软删除状态；通知保留为历史记录，但客户端不得再生成活动深链。
    pub activity_deleted: bool,
    pub payload: Value,
    pub read_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct NotificationList {
    pub items: Vec<NotificationView>,
    pub unread_count: usize,
}

/// 通知页允许的筛选范围；批量清理使用同一枚举，避免前后端各自解释字符串。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NotificationFilter {
    All,
    Unread,
    Invitation,
    Settlement,
    System,
}

impl NotificationFilter {
    #[must_use]
    pub const fn as_database_value(self) -> &'static str {
        match self {
            Self::All => "ALL",
            Self::Unread => "UNREAD",
            Self::Invitation => "INVITATION",
            Self::Settlement => "SETTLEMENT",
            Self::System => "SYSTEM",
        }
    }
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
    ) -> Result<(Vec<NotificationView>, usize), NotificationRepositoryError>;

    async fn mark_read(
        &self,
        notification_id: Uuid,
        recipient_user_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<NotificationView, NotificationRepositoryError>;

    async fn mark_all_read(
        &self,
        recipient_user_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<(), NotificationRepositoryError>;

    async fn clear(
        &self,
        recipient_user_id: Uuid,
        filter: NotificationFilter,
    ) -> Result<(), NotificationRepositoryError>;

    async fn delete(
        &self,
        notification_id: Uuid,
        recipient_user_id: Uuid,
    ) -> Result<(), NotificationRepositoryError>;
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
    let (items, unread_count) = repository
        .list(recipient_user_id)
        .await
        .map_err(map_repository_error)?;
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

/// 一次标记当前用户的全部未读通知，服务端不受列表展示上限影响。
pub async fn mark_all_notifications_read(
    repository: &dyn NotificationRepository,
    clock: &dyn Clock,
    recipient_user_id: Uuid,
) -> Result<(), NotificationError> {
    repository
        .mark_all_read(recipient_user_id, clock.now())
        .await
        .map_err(map_repository_error)
}

/// 永久删除当前用户筛选范围内的通知；筛选为空时由 HTTP 层拒绝，不会误删全部记录。
pub async fn clear_notifications(
    repository: &dyn NotificationRepository,
    recipient_user_id: Uuid,
    filter: NotificationFilter,
) -> Result<(), NotificationError> {
    repository
        .clear(recipient_user_id, filter)
        .await
        .map_err(map_repository_error)
}

/// 永久删除当前用户的一条通知，不触碰通知指向的业务实体。
pub async fn delete_notification(
    repository: &dyn NotificationRepository,
    notification_id: Uuid,
    recipient_user_id: Uuid,
) -> Result<(), NotificationError> {
    repository
        .delete(notification_id, recipient_user_id)
        .await
        .map_err(map_repository_error)
}

fn map_repository_error(error: NotificationRepositoryError) -> NotificationError {
    match error {
        NotificationRepositoryError::NotFound => NotificationError::NotFound,
        NotificationRepositoryError::Unavailable => NotificationError::Unavailable,
    }
}
