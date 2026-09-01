use std::fmt;

use async_trait::async_trait;
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{
    application::{
        collaboration::InvitationTokenCodec,
        ports::{Clock, PasswordHasher},
    },
    domain::identity::{Password, Username},
    domain::session::{SessionState, evaluate_session},
    infrastructure::session::SessionToken,
};

const IDLE_TIMEOUT: Duration = Duration::days(30);
const ABSOLUTE_TIMEOUT: Duration = Duration::days(90);

#[derive(Clone, Debug)]
pub struct StoredCredentials {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub password_hash: String,
}

#[derive(Clone, Debug)]
pub struct NewSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: [u8; 32],
    pub created_at: OffsetDateTime,
    pub idle_expires_at: OffsetDateTime,
    pub absolute_expires_at: OffsetDateTime,
    pub replacement_password_hash: Option<String>,
}

#[derive(Clone, Debug)]
pub struct StoredSession {
    pub session_id: Uuid,
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub password_hash: String,
    pub created_at: OffsetDateTime,
    pub last_seen_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct PasswordRotation {
    pub user_id: Uuid,
    pub password_hash: String,
    pub revoked_at: OffsetDateTime,
    pub new_session: NewSession,
}

#[derive(Clone, Copy, Debug, Error)]
#[error("认证数据访问失败")]
pub struct AuthRepositoryError;

/// 登录用例只依赖凭据读取和原子 Session 写入，不接触 `SQLx` row。
#[async_trait]
pub trait AuthRepository: Send + Sync {
    async fn find_credentials(
        &self,
        username: &str,
    ) -> Result<Option<StoredCredentials>, AuthRepositoryError>;

    async fn create_session(&self, session: NewSession) -> Result<(), AuthRepositoryError>;

    async fn find_session(
        &self,
        token_hash: &[u8; 32],
    ) -> Result<Option<StoredSession>, AuthRepositoryError>;

    async fn refresh_session(
        &self,
        session_id: Uuid,
        last_seen_at: OffsetDateTime,
        idle_expires_at: OffsetDateTime,
    ) -> Result<(), AuthRepositoryError>;

    async fn revoke_session(
        &self,
        session_id: Uuid,
        revoked_at: OffsetDateTime,
    ) -> Result<(), AuthRepositoryError>;

    async fn rotate_password_and_session(
        &self,
        rotation: PasswordRotation,
    ) -> Result<(), AuthRepositoryError>;
}

#[derive(Clone, Debug)]
pub struct NewRegistration {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub password_hash: String,
    pub invitation_hash: [u8; 32],
    pub created_at: OffsetDateTime,
    pub session: NewSession,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum RegistrationRepositoryError {
    #[error("邀请无效或已失效")]
    InvalidInvitation,
    #[error("用户名已存在")]
    UsernameTaken,
    #[error("注册数据写入失败")]
    Unavailable,
}

#[async_trait]
pub trait RegistrationRepository: Send + Sync {
    async fn register(
        &self,
        registration: NewRegistration,
    ) -> Result<(), RegistrationRepositoryError>;
}

#[derive(Clone, Eq, PartialEq)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}

impl fmt::Debug for LoginInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LoginInput")
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct LoginOutput {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub session_token: SessionToken,
}

#[derive(Clone, Eq, PartialEq)]
pub struct RegisterInput {
    pub username: String,
    pub password: String,
    pub display_name: String,
    pub invitation_token: String,
}

impl fmt::Debug for RegisterInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RegisterInput")
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .field("display_name", &self.display_name)
            .field("invitation_token", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct RegisterOutput {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub session_token: SessionToken,
}

#[derive(Debug, Error)]
pub enum RegisterError {
    #[error("注册信息无效")]
    InvalidInput,
    #[error("邀请无效或已失效")]
    InvalidInvitation,
    #[error("用户名已存在")]
    UsernameTaken,
    #[error("注册服务暂时不可用")]
    Unavailable,
}

#[derive(Debug, Error)]
pub enum LoginError {
    #[error("用户名或密码错误")]
    InvalidCredentials,
    #[error("登录服务暂时不可用")]
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentSession {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
}

#[derive(Debug, Error)]
pub enum CurrentSessionError {
    #[error("当前登录已失效")]
    Unauthenticated,
    #[error("Session 服务暂时不可用")]
    Unavailable,
}

#[derive(Debug, Error)]
#[error("注销服务暂时不可用")]
pub struct LogoutError;

#[derive(Clone, Eq, PartialEq)]
pub struct ChangePasswordInput {
    pub current_password: String,
    pub new_password: String,
}

impl fmt::Debug for ChangePasswordInput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ChangePasswordInput")
            .field("current_password", &"[REDACTED]")
            .field("new_password", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone, Debug)]
pub struct ChangePasswordOutput {
    pub session_token: SessionToken,
}

#[derive(Debug, Error)]
pub enum ChangePasswordError {
    #[error("当前密码错误")]
    InvalidCurrentPassword,
    #[error("新密码格式无效")]
    InvalidNewPassword,
    #[error("改密服务暂时不可用")]
    Unavailable,
}

/// 邀请注册只创建账号和 Session；Repository 在写事务内重新验证邀请，加入活动仍需单独消费邀请。
///
/// # Errors
///
/// 用户名、密码、昵称或邀请格式无效时返回稳定业务错误；存储与散列异常不暴露内部细节。
pub async fn register(
    repository: &dyn RegistrationRepository,
    password_hasher: &dyn PasswordHasher,
    invitation_codec: &dyn InvitationTokenCodec,
    clock: &dyn Clock,
    input: RegisterInput,
) -> Result<RegisterOutput, RegisterError> {
    let username = Username::parse(&input.username).map_err(|_| RegisterError::InvalidInput)?;
    let password = Password::parse(&input.password).map_err(|_| RegisterError::InvalidInput)?;
    let display_name = input.display_name.trim();
    if !(1..=80).contains(&display_name.chars().count()) {
        return Err(RegisterError::InvalidInput);
    }
    let invitation_hash = invitation_codec
        .hash(&input.invitation_token)
        .ok_or(RegisterError::InvalidInvitation)?;
    let password_hash = password_hasher
        .hash(&password)
        .map_err(|_| RegisterError::Unavailable)?;
    let now = clock.now();
    let idle_expires_at = now
        .checked_add(IDLE_TIMEOUT)
        .ok_or(RegisterError::Unavailable)?;
    let absolute_expires_at = now
        .checked_add(ABSOLUTE_TIMEOUT)
        .ok_or(RegisterError::Unavailable)?;
    let user_id = Uuid::new_v4();
    let session_token = SessionToken::generate();
    repository
        .register(NewRegistration {
            user_id,
            username: username.as_str().to_owned(),
            display_name: display_name.to_owned(),
            password_hash,
            invitation_hash,
            created_at: now,
            session: NewSession {
                id: Uuid::new_v4(),
                user_id,
                token_hash: session_token.sha256_hash(),
                created_at: now,
                idle_expires_at,
                absolute_expires_at,
                replacement_password_hash: None,
            },
        })
        .await
        .map_err(|error| match error {
            RegistrationRepositoryError::InvalidInvitation => RegisterError::InvalidInvitation,
            RegistrationRepositoryError::UsernameTaken => RegisterError::UsernameTaken,
            RegistrationRepositoryError::Unavailable => RegisterError::Unavailable,
        })?;
    Ok(RegisterOutput {
        user_id,
        username: username.as_str().to_owned(),
        display_name: display_name.to_owned(),
        session_token,
    })
}

/// 校验凭据，并在同一 Repository 事务内完成可选 rehash 与新 Session 写入。
///
/// # Errors
///
/// 用户不存在或密码不匹配时统一返回 `InvalidCredentials`；存储或散列异常返回 `Unavailable`。
pub async fn login(
    repository: &dyn AuthRepository,
    password_hasher: &dyn PasswordHasher,
    clock: &dyn Clock,
    input: LoginInput,
) -> Result<LoginOutput, LoginError> {
    let username = Username::parse(&input.username).map_err(|_| LoginError::InvalidCredentials)?;
    let password = Password::parse(&input.password).map_err(|_| LoginError::InvalidCredentials)?;
    let credentials = repository
        .find_credentials(username.as_str())
        .await
        .map_err(|_| LoginError::Unavailable)?
        .ok_or(LoginError::InvalidCredentials)?;
    let verification = password_hasher
        .verify(&password, &credentials.password_hash)
        .map_err(|_| LoginError::Unavailable)?;
    if !verification.valid {
        return Err(LoginError::InvalidCredentials);
    }

    let replacement_password_hash = verification
        .needs_rehash
        .then(|| password_hasher.hash(&password))
        .transpose()
        .map_err(|_| LoginError::Unavailable)?;
    let now = clock.now();
    let idle_expires_at = now
        .checked_add(IDLE_TIMEOUT)
        .ok_or(LoginError::Unavailable)?;
    let absolute_expires_at = now
        .checked_add(ABSOLUTE_TIMEOUT)
        .ok_or(LoginError::Unavailable)?;
    let session_token = SessionToken::generate();
    repository
        .create_session(NewSession {
            id: Uuid::new_v4(),
            user_id: credentials.user_id,
            token_hash: session_token.sha256_hash(),
            created_at: now,
            idle_expires_at,
            absolute_expires_at,
            replacement_password_hash,
        })
        .await
        .map_err(|_| LoginError::Unavailable)?;

    Ok(LoginOutput {
        user_id: credentials.user_id,
        username: credentials.username,
        display_name: credentials.display_name,
        session_token,
    })
}

/// 读取并验证 Session；过期时撤销，活跃满 24 小时时节流刷新 last-seen。
///
/// # Errors
///
/// token 不存在或已过期时返回 `Unauthenticated`，Repository 异常返回 `Unavailable`。
pub async fn current_session(
    repository: &dyn AuthRepository,
    clock: &dyn Clock,
    token: &SessionToken,
) -> Result<CurrentSession, CurrentSessionError> {
    let stored = repository
        .find_session(&token.sha256_hash())
        .await
        .map_err(|_| CurrentSessionError::Unavailable)?
        .ok_or(CurrentSessionError::Unauthenticated)?;
    let now = clock.now();
    match evaluate_session(stored.created_at, stored.last_seen_at, now) {
        SessionState::Expired => {
            repository
                .revoke_session(stored.session_id, now)
                .await
                .map_err(|_| CurrentSessionError::Unavailable)?;
            Err(CurrentSessionError::Unauthenticated)
        }
        SessionState::Active { refresh_last_seen } => {
            if refresh_last_seen {
                let idle_expires_at = now
                    .checked_add(IDLE_TIMEOUT)
                    .ok_or(CurrentSessionError::Unavailable)?;
                repository
                    .refresh_session(stored.session_id, now, idle_expires_at)
                    .await
                    .map_err(|_| CurrentSessionError::Unavailable)?;
            }
            Ok(CurrentSession {
                user_id: stored.user_id,
                username: stored.username,
                display_name: stored.display_name,
            })
        }
    }
}

/// 按 Session token hash 撤销当前登录；找不到对应 Session 时保持幂等成功。
///
/// # Errors
///
/// Repository 读写失败时返回 `LogoutError`。
pub async fn logout(
    repository: &dyn AuthRepository,
    clock: &dyn Clock,
    token: &SessionToken,
) -> Result<(), LogoutError> {
    let stored = repository
        .find_session(&token.sha256_hash())
        .await
        .map_err(|_| LogoutError)?;
    if let Some(stored) = stored {
        repository
            .revoke_session(stored.session_id, clock.now())
            .await
            .map_err(|_| LogoutError)?;
    }
    Ok(())
}

/// 验证当前密码，并原子更新密码、撤销全部旧 Session、创建轮换后的当前 Session。
///
/// # Errors
///
/// 当前密码错误、新密码不合法或 Repository/Hasher 异常时返回对应稳定错误。
pub async fn change_password(
    repository: &dyn AuthRepository,
    password_hasher: &dyn PasswordHasher,
    clock: &dyn Clock,
    current_token: &SessionToken,
    input: ChangePasswordInput,
) -> Result<ChangePasswordOutput, ChangePasswordError> {
    let current_password = Password::parse(&input.current_password)
        .map_err(|_| ChangePasswordError::InvalidCurrentPassword)?;
    let new_password = Password::parse(&input.new_password)
        .map_err(|_| ChangePasswordError::InvalidNewPassword)?;
    let stored = repository
        .find_session(&current_token.sha256_hash())
        .await
        .map_err(|_| ChangePasswordError::Unavailable)?
        .ok_or(ChangePasswordError::InvalidCurrentPassword)?;
    let verification = password_hasher
        .verify(&current_password, &stored.password_hash)
        .map_err(|_| ChangePasswordError::Unavailable)?;
    if !verification.valid {
        return Err(ChangePasswordError::InvalidCurrentPassword);
    }
    let password_hash = password_hasher
        .hash(&new_password)
        .map_err(|_| ChangePasswordError::Unavailable)?;
    let now = clock.now();
    let idle_expires_at = now
        .checked_add(IDLE_TIMEOUT)
        .ok_or(ChangePasswordError::Unavailable)?;
    let absolute_expires_at = now
        .checked_add(ABSOLUTE_TIMEOUT)
        .ok_or(ChangePasswordError::Unavailable)?;
    let session_token = SessionToken::generate();
    repository
        .rotate_password_and_session(PasswordRotation {
            user_id: stored.user_id,
            password_hash,
            revoked_at: now,
            new_session: NewSession {
                id: Uuid::new_v4(),
                user_id: stored.user_id,
                token_hash: session_token.sha256_hash(),
                created_at: now,
                idle_expires_at,
                absolute_expires_at,
                replacement_password_hash: None,
            },
        })
        .await
        .map_err(|_| ChangePasswordError::Unavailable)?;
    Ok(ChangePasswordOutput { session_token })
}
