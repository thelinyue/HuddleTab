use std::fmt;

use async_trait::async_trait;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    application::ports::{PasswordHasher, PasswordHashingError},
    domain::identity::{IdentityError, Password},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SystemUser {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub disabled: bool,
    pub is_system_admin: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistrationPolicyView {
    pub policy: RegistrationPolicy,
    pub version: i64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RegistrationPolicy {
    InviteOnly,
    Open,
}

impl RegistrationPolicy {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InviteOnly => "INVITE_ONLY",
            Self::Open => "OPEN",
        }
    }
}

#[derive(Clone, Copy, Debug, Error)]
pub enum SystemAdminError {
    #[error("用户不存在")]
    UserNotFound,
    #[error("系统必须至少保留一个能够正常登录的系统管理员。")]
    LastActiveAdmin,
    #[error("资源状态已变化，请刷新后重试。")]
    VersionConflict,
    #[error("新密码格式无效")]
    InvalidPassword,
    #[error("系统管理数据访问失败")]
    Unavailable,
}

impl From<PasswordHashingError> for SystemAdminError {
    fn from(_: PasswordHashingError) -> Self {
        Self::Unavailable
    }
}

impl From<IdentityError> for SystemAdminError {
    fn from(_: IdentityError) -> Self {
        Self::InvalidPassword
    }
}

/// 平台管理用例的数据库端口。权限守卫和事务不下沉到前端，也不复用 Activity Owner。
#[async_trait]
pub trait SystemAdminRepository: Send + Sync {
    async fn list_users(&self) -> Result<Vec<SystemUser>, SystemAdminError>;
    async fn is_system_admin(&self, user_id: Uuid) -> Result<bool, SystemAdminError>;
    async fn set_user_disabled(
        &self,
        user_id: Uuid,
        disabled: bool,
        now: OffsetDateTime,
    ) -> Result<(), SystemAdminError>;
    async fn set_system_admin(
        &self,
        user_id: Uuid,
        granted: bool,
        granted_by: Uuid,
        now: OffsetDateTime,
    ) -> Result<(), SystemAdminError>;
    async fn reset_password(
        &self,
        user_id: Uuid,
        password_hash: String,
        now: OffsetDateTime,
    ) -> Result<(), SystemAdminError>;
    async fn get_registration_policy(&self) -> Result<RegistrationPolicyView, SystemAdminError>;
    async fn set_registration_policy(
        &self,
        policy: RegistrationPolicy,
        expected_version: i64,
        actor: Uuid,
        now: OffsetDateTime,
    ) -> Result<RegistrationPolicyView, SystemAdminError>;
}

/// 读取平台用户及其系统管理员标记。
///
/// # Errors
///
/// Repository 无法读取时返回 `SystemAdminError::Unavailable`。
pub async fn list_users(
    repository: &dyn SystemAdminRepository,
) -> Result<Vec<SystemUser>, SystemAdminError> {
    repository.list_users().await
}

/// 检查账号是否处于启用状态且拥有系统管理员角色。
///
/// # Errors
///
/// Repository 无法读取时返回 `SystemAdminError::Unavailable`。
pub async fn is_system_admin(
    repository: &dyn SystemAdminRepository,
    user_id: Uuid,
) -> Result<bool, SystemAdminError> {
    repository.is_system_admin(user_id).await
}

/// 修改账号禁用状态，并由 Repository 维护最后一个管理员不变量。
///
/// # Errors
///
/// 目标不存在、违反最后管理员保护或数据库失败时返回对应错误。
pub async fn set_user_disabled(
    repository: &dyn SystemAdminRepository,
    user_id: Uuid,
    disabled: bool,
    now: OffsetDateTime,
) -> Result<(), SystemAdminError> {
    repository.set_user_disabled(user_id, disabled, now).await
}

/// 授予或撤销系统管理员角色。
///
/// # Errors
///
/// 目标不存在、违反最后管理员保护或数据库失败时返回对应错误。
pub async fn set_system_admin(
    repository: &dyn SystemAdminRepository,
    user_id: Uuid,
    granted: bool,
    granted_by: Uuid,
    now: OffsetDateTime,
) -> Result<(), SystemAdminError> {
    repository
        .set_system_admin(user_id, granted, granted_by, now)
        .await
}

/// 校验并散列管理员设置的新密码，再原子撤销目标账号全部 Session。
///
/// # Errors
///
/// 密码不符合身份规则、目标不存在、散列失败或数据库失败时返回对应错误。
pub async fn reset_password(
    repository: &dyn SystemAdminRepository,
    hasher: &dyn PasswordHasher,
    user_id: Uuid,
    password: &str,
    now: OffsetDateTime,
) -> Result<(), SystemAdminError> {
    let password = Password::parse(password).map_err(|_| SystemAdminError::InvalidPassword)?;
    let hash = hasher.hash(&password)?;
    repository.reset_password(user_id, hash, now).await
}

/// 读取单例注册策略及其乐观锁版本。
///
/// # Errors
///
/// 策略单例缺失或数据库失败时返回 `SystemAdminError::Unavailable`。
pub async fn get_registration_policy(
    repository: &dyn SystemAdminRepository,
) -> Result<RegistrationPolicyView, SystemAdminError> {
    repository.get_registration_policy().await
}

/// 使用期望版本更新单例注册策略。
///
/// # Errors
///
/// 期望版本过期时返回 `VersionConflict`，单例缺失或数据库失败时返回 `Unavailable`。
pub async fn set_registration_policy(
    repository: &dyn SystemAdminRepository,
    policy: RegistrationPolicy,
    expected_version: i64,
    actor: Uuid,
    now: OffsetDateTime,
) -> Result<RegistrationPolicyView, SystemAdminError> {
    repository
        .set_registration_policy(policy, expected_version, actor, now)
        .await
}

#[derive(Clone, Eq, PartialEq)]
pub struct AdminPasswordResetInput {
    pub user_id: Uuid,
    pub password: String,
}

impl fmt::Debug for AdminPasswordResetInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AdminPasswordResetInput")
            .field("user_id", &self.user_id)
            .field("password", &"[REDACTED]")
            .finish()
    }
}
