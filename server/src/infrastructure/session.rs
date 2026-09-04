use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::fmt;
use thiserror::Error;

const TOKEN_BYTES: usize = 32;

#[derive(Clone, Eq, PartialEq)]
pub struct SessionToken(String);

#[derive(Debug, Error, Eq, PartialEq)]
pub enum SessionTokenError {
    #[error("Session token 格式无效")]
    Invalid,
}

impl SessionToken {
    #[must_use]
    pub fn generate() -> Self {
        let mut bytes = [0_u8; TOKEN_BYTES];
        OsRng.fill_bytes(&mut bytes);
        Self(URL_SAFE_NO_PAD.encode(bytes))
    }

    /// 解析 Cookie 中的原 token，并拒绝非规范 base64url 或错误长度。
    ///
    /// # Errors
    ///
    /// token 不是 32-byte CSPRNG 值的规范 base64url 表示时返回错误。
    pub fn parse(input: &str) -> Result<Self, SessionTokenError> {
        let bytes = URL_SAFE_NO_PAD
            .decode(input)
            .map_err(|_| SessionTokenError::Invalid)?;
        if bytes.len() != TOKEN_BYTES || URL_SAFE_NO_PAD.encode(&bytes) != input {
            return Err(SessionTokenError::Invalid);
        }
        Ok(Self(input.to_owned()))
    }

    /// 只有 HTTP Cookie 边界可以取原 token；禁止记录或持久化该返回值。
    #[must_use]
    pub fn expose_for_cookie(&self) -> &str {
        &self.0
    }

    /// Repository 只接收该摘要，不接收原 token。
    #[must_use]
    pub fn sha256_hash(&self) -> [u8; 32] {
        Sha256::digest(self.0.as_bytes()).into()
    }
}

impl fmt::Debug for SessionToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionToken([REDACTED])")
    }
}
