use std::fmt;

use async_trait::async_trait;
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{
    application::ports::Clock,
    domain::{
        identity::Username,
        join_request::{JoinDecision, JoinRequestStatus},
    },
};

const INVITATION_LIFETIME: Duration = Duration::days(7);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InvitationKind {
    Link,
    Direct,
}

impl InvitationKind {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Link => "LINK",
            Self::Direct => "DIRECT",
        }
    }
}

#[derive(Clone)]
pub struct IssuedInvitationToken {
    raw: String,
    pub hash: [u8; 32],
}

impl IssuedInvitationToken {
    #[must_use]
    pub fn new(raw: String, hash: [u8; 32]) -> Self {
        Self { raw, hash }
    }

    #[must_use]
    pub fn expose_once(&self) -> &str {
        &self.raw
    }
}

impl fmt::Debug for IssuedInvitationToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("IssuedInvitationToken([REDACTED])")
    }
}

/// 邀请 token 的随机生成和规范解析属于密码学边界，应用层只处理摘要。
pub trait InvitationTokenCodec: Send + Sync {
    fn generate(&self) -> IssuedInvitationToken;
    fn hash(&self, raw: &str) -> Option<[u8; 32]>;
}

#[derive(Clone, Debug)]
pub struct NewGuest {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub display_name: String,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct GuestMember {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub display_name: String,
    pub version: i64,
    pub revision: i64,
}

#[derive(Clone, Debug)]
pub struct NewInvitation {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub token_hash: [u8; 32],
    pub kind: InvitationKind,
    pub target_username: Option<String>,
    pub expires_at: OffsetDateTime,
    pub max_uses: Option<i32>,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct Invitation {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub kind: InvitationKind,
    pub target_username: Option<String>,
    pub expires_at: OffsetDateTime,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub revoked_at: Option<OffsetDateTime>,
    pub version: i64,
    pub revision: i64,
}

#[derive(Clone, Debug)]
pub struct InvitationPreview {
    pub activity_id: Uuid,
    pub activity_name: String,
    pub active_member_count: i64,
    pub kind: InvitationKind,
    pub expires_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct JoinInvitationInput {
    pub token_hash: [u8; 32],
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub now: OffsetDateTime,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JoinStatus {
    Joined,
    AlreadyMember,
    PendingApproval,
}

impl JoinStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Joined => "JOINED",
            Self::AlreadyMember => "ALREADY_MEMBER",
            Self::PendingApproval => "PENDING_APPROVAL",
        }
    }
}

#[derive(Clone, Debug)]
pub struct JoinedInvitation {
    pub status: JoinStatus,
    pub activity_id: Uuid,
    pub member_id: Option<Uuid>,
    pub request_id: Option<Uuid>,
    pub revision: i64,
}

#[derive(Clone, Debug)]
pub struct JoinRequestView {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub applicant_user_id: Uuid,
    pub applicant_display_name: String,
    pub status: JoinRequestStatus,
    pub decided_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub revision: i64,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum CollaborationRepositoryError {
    #[error("没有活动管理权限")]
    Forbidden,
    #[error("协作资源不存在")]
    NotFound,
    #[error("协作资源状态冲突")]
    Conflict,
    #[error("加入申请已经处理")]
    JoinRequestClosed,
    #[error("当前活动不允许新成员加入")]
    ActivityNotJoinable,
    #[error("邀请无效或已失效")]
    InvalidInvitation,
    #[error("协作数据访问失败")]
    Unavailable,
}

/// Repository 的每个写方法都封装一次完整事务，保证业务事实、revision 与 Audit 同步提交。
#[async_trait]
pub trait CollaborationRepository: Send + Sync {
    async fn create_guest(
        &self,
        guest: NewGuest,
    ) -> Result<GuestMember, CollaborationRepositoryError>;

    async fn create_invitation(
        &self,
        invitation: NewInvitation,
    ) -> Result<Invitation, CollaborationRepositoryError>;

    async fn list_invitations(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Vec<Invitation>, CollaborationRepositoryError>;

    async fn revoke_invitation(
        &self,
        activity_id: Uuid,
        invitation_id: Uuid,
        actor_user_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<Invitation, CollaborationRepositoryError>;

    async fn preview_invitation(
        &self,
        token_hash: &[u8; 32],
        now: OffsetDateTime,
    ) -> Result<Option<InvitationPreview>, CollaborationRepositoryError>;

    async fn join_invitation(
        &self,
        input: JoinInvitationInput,
    ) -> Result<JoinedInvitation, CollaborationRepositoryError>;

    async fn list_join_requests(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Vec<JoinRequestView>, CollaborationRepositoryError>;

    async fn get_join_request(
        &self,
        request_id: Uuid,
        applicant_user_id: Uuid,
    ) -> Result<JoinRequestView, CollaborationRepositoryError>;

    async fn decide_join_request(
        &self,
        activity_id: Uuid,
        request_id: Uuid,
        actor_user_id: Uuid,
        decision: JoinDecision,
        now: OffsetDateTime,
    ) -> Result<JoinRequestView, CollaborationRepositoryError>;
}

#[derive(Clone, Debug)]
pub struct CreateInvitationInput {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub kind: String,
    pub target_username: Option<String>,
    pub max_uses: Option<i32>,
}

#[derive(Clone, Debug)]
pub struct CreatedInvitation {
    pub invitation: Invitation,
    pub token: IssuedInvitationToken,
}

#[derive(Clone)]
pub struct JoinInput {
    pub raw_token: String,
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
}

/// 邀请 token 只在本次 join 的内存流程中使用，Debug 输出必须保持不可逆脱敏。
impl fmt::Debug for JoinInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("JoinInput")
            .field("raw_token", &"[REDACTED]")
            .field("user_id", &self.user_id)
            .field("username", &self.username)
            .field("display_name", &self.display_name)
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum CollaborationError {
    #[error("协作输入无效")]
    InvalidInput,
    #[error("邀请无效或已失效")]
    InvalidInvitation,
    #[error("没有活动管理权限")]
    Forbidden,
    #[error("协作资源不存在")]
    NotFound,
    #[error("协作资源状态冲突")]
    Conflict,
    #[error("加入申请已经处理")]
    JoinRequestClosed,
    #[error("当前活动不允许新成员加入")]
    ActivityNotJoinable,
    #[error("协作服务暂时不可用")]
    Unavailable,
}

/// 验证 Guest 昵称，并原子写入成员、revision 与 Audit。
///
/// # Errors
///
/// 昵称无效、操作者无权限或事务失败时返回对应协作错误。
pub async fn create_guest(
    repository: &dyn CollaborationRepository,
    clock: &dyn Clock,
    activity_id: Uuid,
    actor_user_id: Uuid,
    display_name: String,
) -> Result<GuestMember, CollaborationError> {
    let display_name = display_name.trim();
    if !(1..=80).contains(&display_name.chars().count()) {
        return Err(CollaborationError::InvalidInput);
    }
    repository
        .create_guest(NewGuest {
            id: Uuid::new_v4(),
            activity_id,
            actor_user_id,
            display_name: display_name.to_owned(),
            now: clock.now(),
        })
        .await
        .map_err(map_repository_error)
}

/// 创建七天有效的链接或定向邀请，明文 token 只随本次结果返回。
///
/// # Errors
///
/// 邀请类型、目标用户名、使用次数无效，或事务失败时返回对应协作错误。
pub async fn create_invitation(
    repository: &dyn CollaborationRepository,
    codec: &dyn InvitationTokenCodec,
    clock: &dyn Clock,
    input: CreateInvitationInput,
) -> Result<CreatedInvitation, CollaborationError> {
    let kind = match input.kind.as_str() {
        "LINK" => InvitationKind::Link,
        "DIRECT" => InvitationKind::Direct,
        _ => return Err(CollaborationError::InvalidInput),
    };
    let target_username = match (kind, input.target_username) {
        (InvitationKind::Link, None) => None,
        (InvitationKind::Direct, Some(username)) => Some(
            Username::parse(&username)
                .map_err(|_| CollaborationError::InvalidInput)?
                .as_str()
                .to_owned(),
        ),
        _ => return Err(CollaborationError::InvalidInput),
    };
    if input
        .max_uses
        .is_some_and(|value| !(1..=1000).contains(&value))
    {
        return Err(CollaborationError::InvalidInput);
    }
    let now = clock.now();
    let expires_at = now
        .checked_add(INVITATION_LIFETIME)
        .ok_or(CollaborationError::Unavailable)?;
    let token = codec.generate();
    let invitation = repository
        .create_invitation(NewInvitation {
            id: Uuid::new_v4(),
            activity_id: input.activity_id,
            actor_user_id: input.actor_user_id,
            token_hash: token.hash,
            kind,
            target_username,
            expires_at,
            max_uses: input.max_uses,
            now,
        })
        .await
        .map_err(map_repository_error)?;
    Ok(CreatedInvitation { invitation, token })
}

/// 读取公开邀请预览，只暴露加入决策所需的最小活动信息。
///
/// # Errors
///
/// token 格式错误、已失效或存储不可用时返回对应协作错误。
pub async fn preview_invitation(
    repository: &dyn CollaborationRepository,
    codec: &dyn InvitationTokenCodec,
    clock: &dyn Clock,
    raw_token: &str,
) -> Result<InvitationPreview, CollaborationError> {
    let token_hash = codec
        .hash(raw_token)
        .ok_or(CollaborationError::InvalidInvitation)?;
    repository
        .preview_invitation(&token_hash, clock.now())
        .await
        .map_err(map_repository_error)?
        .ok_or(CollaborationError::InvalidInvitation)
}

/// 列出活动邀请元数据，永远不返回可用于加入的明文 token。
///
/// # Errors
///
/// 操作者无管理权限或存储不可用时返回对应协作错误。
pub async fn list_invitations(
    repository: &dyn CollaborationRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Vec<Invitation>, CollaborationError> {
    repository
        .list_invitations(activity_id, actor_user_id)
        .await
        .map_err(map_repository_error)
}

/// 幂等撤销邀请；首次撤销时 revision 与 Audit 只增加一次。
///
/// # Errors
///
/// 邀请不存在、操作者无权限或事务失败时返回对应协作错误。
pub async fn revoke_invitation(
    repository: &dyn CollaborationRepository,
    clock: &dyn Clock,
    activity_id: Uuid,
    invitation_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Invitation, CollaborationError> {
    repository
        .revoke_invitation(activity_id, invitation_id, actor_user_id, clock.now())
        .await
        .map_err(map_repository_error)
}

/// 重新验证邀请和定向用户名后创建或恢复账务成员身份。
///
/// # Errors
///
/// token 无效、邀请失效、定向用户不匹配或事务失败时返回对应协作错误。
pub async fn join_invitation(
    repository: &dyn CollaborationRepository,
    codec: &dyn InvitationTokenCodec,
    clock: &dyn Clock,
    input: JoinInput,
) -> Result<JoinedInvitation, CollaborationError> {
    let token_hash = codec
        .hash(&input.raw_token)
        .ok_or(CollaborationError::InvalidInvitation)?;
    repository
        .join_invitation(JoinInvitationInput {
            token_hash,
            user_id: input.user_id,
            username: input.username,
            display_name: input.display_name,
            now: clock.now(),
        })
        .await
        .map_err(|error| match error {
            CollaborationRepositoryError::NotFound | CollaborationRepositoryError::Forbidden => {
                CollaborationError::InvalidInvitation
            }
            other => map_repository_error(other),
        })
}

/// 读取 Owner 的待审批队列，普通成员没有读取权限。
///
/// # Errors
///
/// 活动不存在、操作者不是 Owner 或存储不可用时返回对应错误。
pub async fn list_join_requests(
    repository: &dyn CollaborationRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Vec<JoinRequestView>, CollaborationError> {
    repository
        .list_join_requests(activity_id, actor_user_id)
        .await
        .map_err(map_repository_error)
}

/// 只允许申请人读取自己的加入申请，避免暴露其他用户的审批状态。
///
/// # Errors
///
/// 申请不存在、不属于当前用户或存储不可用时返回对应错误。
pub async fn get_join_request(
    repository: &dyn CollaborationRepository,
    request_id: Uuid,
    applicant_user_id: Uuid,
) -> Result<JoinRequestView, CollaborationError> {
    repository
        .get_join_request(request_id, applicant_user_id)
        .await
        .map_err(map_repository_error)
}

/// 解析 Owner 决策并在单个事务内完成成员、邀请、通知、Audit 与 revision 更新。
///
/// # Errors
///
/// 决策值无效、申请已关闭、活动或邀请失效以及存储失败时返回对应错误。
pub async fn decide_join_request(
    repository: &dyn CollaborationRepository,
    clock: &dyn Clock,
    activity_id: Uuid,
    request_id: Uuid,
    actor_user_id: Uuid,
    decision: &str,
) -> Result<JoinRequestView, CollaborationError> {
    let decision = JoinDecision::parse(decision).map_err(|_| CollaborationError::InvalidInput)?;
    repository
        .decide_join_request(
            activity_id,
            request_id,
            actor_user_id,
            decision,
            clock.now(),
        )
        .await
        .map_err(map_repository_error)
}

fn map_repository_error(error: CollaborationRepositoryError) -> CollaborationError {
    match error {
        CollaborationRepositoryError::Forbidden => CollaborationError::Forbidden,
        CollaborationRepositoryError::NotFound => CollaborationError::NotFound,
        CollaborationRepositoryError::Conflict => CollaborationError::Conflict,
        CollaborationRepositoryError::JoinRequestClosed => CollaborationError::JoinRequestClosed,
        CollaborationRepositoryError::ActivityNotJoinable => {
            CollaborationError::ActivityNotJoinable
        }
        CollaborationRepositoryError::InvalidInvitation => CollaborationError::InvalidInvitation,
        CollaborationRepositoryError::Unavailable => CollaborationError::Unavailable,
    }
}
