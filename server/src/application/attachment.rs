use async_trait::async_trait;
use thiserror::Error;
use uuid::Uuid;

use super::expense::ExpenseAttachmentRecord;

#[derive(Clone, Debug)]
pub struct UploadAttachmentInput {
    pub activity_id: Uuid,
    pub expense_id: Uuid,
    pub actor_user_id: Uuid,
    pub client_attachment_id: Uuid,
    pub declared_mime: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct UploadAttachmentResult {
    pub attachment: ExpenseAttachmentRecord,
    pub idempotent_replay: bool,
}

#[derive(Clone, Debug)]
pub struct DownloadedAttachment {
    pub attachment_id: Uuid,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AttachmentRepositoryError {
    #[error("附件超过大小限制")]
    TooLarge,
    #[error("附件图片类型不受支持")]
    TypeNotAllowed,
    #[error("附件声明类型与内容不一致")]
    MimeMismatch,
    #[error("附件图片内容无效")]
    ImageInvalid,
    #[error("每笔账单最多上传三张附件")]
    LimitReached,
    #[error("没有附件写入权限")]
    Forbidden,
    #[error("附件或所属资源不存在")]
    NotFound,
    #[error("附件文件缺失")]
    MissingFile,
    #[error("附件存储不可用")]
    StorageUnavailable,
    #[error("附件数据访问失败")]
    Unavailable,
}

#[async_trait]
pub trait AttachmentRepository: Send + Sync {
    async fn upload(
        &self,
        input: UploadAttachmentInput,
    ) -> Result<UploadAttachmentResult, AttachmentRepositoryError>;

    async fn download(
        &self,
        activity_id: Uuid,
        expense_id: Uuid,
        attachment_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<DownloadedAttachment, AttachmentRepositoryError>;

    async fn delete(
        &self,
        activity_id: Uuid,
        expense_id: Uuid,
        attachment_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<(), AttachmentRepositoryError>;
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AttachmentError {
    #[error("附件超过大小限制")]
    TooLarge,
    #[error("附件图片类型不受支持")]
    TypeNotAllowed,
    #[error("附件声明类型与内容不一致")]
    MimeMismatch,
    #[error("附件图片内容无效")]
    ImageInvalid,
    #[error("每笔账单最多上传三张附件")]
    LimitReached,
    #[error("没有附件写入权限")]
    Forbidden,
    #[error("附件或所属资源不存在")]
    NotFound,
    #[error("附件文件缺失")]
    MissingFile,
    #[error("附件存储不可用")]
    StorageUnavailable,
    #[error("附件服务暂时不可用")]
    Unavailable,
}

impl From<AttachmentRepositoryError> for AttachmentError {
    fn from(error: AttachmentRepositoryError) -> Self {
        match error {
            AttachmentRepositoryError::TooLarge => Self::TooLarge,
            AttachmentRepositoryError::TypeNotAllowed => Self::TypeNotAllowed,
            AttachmentRepositoryError::MimeMismatch => Self::MimeMismatch,
            AttachmentRepositoryError::ImageInvalid => Self::ImageInvalid,
            AttachmentRepositoryError::LimitReached => Self::LimitReached,
            AttachmentRepositoryError::Forbidden => Self::Forbidden,
            AttachmentRepositoryError::NotFound => Self::NotFound,
            AttachmentRepositoryError::MissingFile => Self::MissingFile,
            AttachmentRepositoryError::StorageUnavailable => Self::StorageUnavailable,
            AttachmentRepositoryError::Unavailable => Self::Unavailable,
        }
    }
}

/// 上传入口只负责编排应用端口，授权、图片处理与事务由 repository 原子实现。
///
/// # Errors
///
/// 输入无效、权限不足、达到数量上限或依赖不可用时返回稳定业务错误。
pub async fn upload_attachment(
    repository: &dyn AttachmentRepository,
    input: UploadAttachmentInput,
) -> Result<UploadAttachmentResult, AttachmentError> {
    repository
        .upload(input)
        .await
        .map_err(AttachmentError::from)
}

/// 读取入口要求 repository 在取得私有存储键前完成完整嵌套授权。
///
/// # Errors
///
/// 资源不可见、文件缺失或存储不可用时返回稳定业务错误。
pub async fn download_attachment(
    repository: &dyn AttachmentRepository,
    activity_id: Uuid,
    expense_id: Uuid,
    attachment_id: Uuid,
    actor_user_id: Uuid,
) -> Result<DownloadedAttachment, AttachmentError> {
    repository
        .download(activity_id, expense_id, attachment_id, actor_user_id)
        .await
        .map_err(AttachmentError::from)
}

/// 删除入口要求 repository 同时维护私有文件、metadata、Audit 与 Activity revision。
///
/// # Errors
///
/// 活动不可写、附件不可见、文件缺失或存储不可用时返回稳定业务错误。
pub async fn delete_attachment(
    repository: &dyn AttachmentRepository,
    activity_id: Uuid,
    expense_id: Uuid,
    attachment_id: Uuid,
    actor_user_id: Uuid,
) -> Result<(), AttachmentError> {
    repository
        .delete(activity_id, expense_id, attachment_id, actor_user_id)
        .await
        .map_err(AttachmentError::from)
}
