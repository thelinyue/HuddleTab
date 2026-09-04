use thiserror::Error;
use time::OffsetDateTime;

use crate::domain::identity::Password;

/// 时间是认证过期、审计和并发测试都需要替换的真实边界。
pub trait Clock: Send + Sync {
    fn now(&self) -> OffsetDateTime;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PasswordVerification {
    pub valid: bool,
    pub needs_rehash: bool,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum PasswordHashingError {
    #[error("无法安全处理密码")]
    HashingFailed,
    #[error("数据库中的密码摘要格式无效")]
    InvalidHash,
}

/// 密码散列是可替换基础设施边界，Application 只依赖验证与 rehash 语义。
pub trait PasswordHasher: Send + Sync {
    /// # Errors
    ///
    /// 随机盐生成或密码散列失败时返回安全的非敏感错误。
    fn hash(&self, password: &Password) -> Result<String, PasswordHashingError>;

    /// # Errors
    ///
    /// 已存摘要损坏或底层验证器异常时返回错误；密码不匹配不是系统错误。
    fn verify(
        &self,
        password: &Password,
        encoded_hash: &str,
    ) -> Result<PasswordVerification, PasswordHashingError>;
}
