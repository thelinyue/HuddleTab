use std::fmt;
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Username(String);

#[derive(Clone, Eq, PartialEq)]
pub struct Password(String);

#[derive(Debug, Error, Eq, PartialEq)]
pub enum IdentityError {
    #[error("用户名长度必须为 3 到 32 个字符")]
    InvalidUsernameLength,
    #[error("用户名只能包含小写字母、数字、点、下划线和连字符")]
    InvalidUsernameCharacters,
    #[error("密码长度必须为 8 到 128 个字符")]
    InvalidPasswordLength,
}

impl Username {
    /// 用户名在唯一性比较前统一执行 NFKC、trim 和 lowercase。
    ///
    /// # Errors
    ///
    /// 规范化结果长度不在 3–32 或包含 ASCII allowlist 外字符时返回错误。
    pub fn parse(input: &str) -> Result<Self, IdentityError> {
        let normalized = input.nfkc().collect::<String>().trim().to_lowercase();
        if !(3..=32).contains(&normalized.len()) {
            return Err(IdentityError::InvalidUsernameLength);
        }
        if !normalized.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        }) {
            return Err(IdentityError::InvalidUsernameCharacters);
        }
        Ok(Self(normalized))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Password {
    /// 密码只验证原始 UTF-8 的字符数，不执行 trim、大小写或 Unicode normalization。
    ///
    /// # Errors
    ///
    /// 原始密码少于 8 或多于 128 个 Unicode scalar 时返回错误。
    pub fn parse(input: &str) -> Result<Self, IdentityError> {
        let length = input.chars().count();
        if !(8..=128).contains(&length) {
            return Err(IdentityError::InvalidPasswordLength);
        }
        Ok(Self(input.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Password {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Password([REDACTED])")
    }
}
