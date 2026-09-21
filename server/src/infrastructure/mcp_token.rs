//! MCP 个人访问令牌的生成与摘要工具。
//!
//! 原始令牌只允许出现在创建响应中；数据库、日志和后续请求只使用 SHA-256 摘要。

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::fmt;
use thiserror::Error;

const TOKEN_BYTES: usize = 32;
const TOKEN_PREFIX: &str = "ht_mcp_";

#[derive(Clone, Eq, PartialEq)]
pub struct McpAccessToken(String);

#[derive(Debug, Error, Eq, PartialEq)]
pub enum McpAccessTokenError {
    #[error("MCP 令牌格式无效")]
    Invalid,
}

impl McpAccessToken {
    /// 生成带有产品前缀的 256-bit MCP 令牌。
    #[must_use]
    pub fn generate() -> Self {
        let mut bytes = [0_u8; TOKEN_BYTES];
        OsRng.fill_bytes(&mut bytes);
        Self(format!("{TOKEN_PREFIX}{}", URL_SAFE_NO_PAD.encode(bytes)))
    }

    /// 解析 Bearer 令牌并拒绝非规范编码或错误长度。
    ///
    /// # Errors
    ///
    /// 令牌缺少固定前缀、不是规范 base64url 或不是 32 bytes 时返回错误。
    pub fn parse(input: &str) -> Result<Self, McpAccessTokenError> {
        let encoded = input
            .strip_prefix(TOKEN_PREFIX)
            .ok_or(McpAccessTokenError::Invalid)?;
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| McpAccessTokenError::Invalid)?;
        if bytes.len() != TOKEN_BYTES || URL_SAFE_NO_PAD.encode(&bytes) != encoded {
            return Err(McpAccessTokenError::Invalid);
        }
        Ok(Self(input.to_owned()))
    }

    /// 仅供创建响应和复制控件使用；禁止写入日志。
    #[must_use]
    pub fn expose_once(&self) -> &str {
        &self.0
    }

    /// 令牌存储摘要。
    #[must_use]
    pub fn sha256_hash(&self) -> [u8; 32] {
        Sha256::digest(self.0.as_bytes()).into()
    }

    /// 用于列表展示的非秘密前缀。
    #[must_use]
    pub fn display_prefix(&self) -> String {
        self.0.chars().take(15).collect()
    }
}

impl fmt::Debug for McpAccessToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("McpAccessToken([REDACTED])")
    }
}

#[cfg(test)]
mod tests {
    use super::McpAccessToken;

    #[test]
    fn generated_tokens_round_trip_and_never_display_the_secret_in_debug() {
        let token = McpAccessToken::generate();
        let parsed = McpAccessToken::parse(token.expose_once()).expect("generated token is valid");
        assert_eq!(parsed.sha256_hash(), token.sha256_hash());
        assert!(format!("{token:?}").contains("REDACTED"));
        assert_eq!(
            token.display_prefix(),
            "ht_mcp_".to_owned() + &token.expose_once()[7..15]
        );
    }

    #[test]
    fn parser_rejects_noncanonical_or_unprefixed_values() {
        assert!(McpAccessToken::parse("abc").is_err());
        assert!(McpAccessToken::parse("ht_mcp_====").is_err());
    }
}
