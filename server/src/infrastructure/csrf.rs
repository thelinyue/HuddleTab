use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use std::fmt;
use thiserror::Error;

use super::app_secret::AppSecret;

const NONCE_BYTES: usize = 32;
const SIGNATURE_BYTES: usize = 32;
type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Copy)]
pub enum CsrfContext<'a> {
    Session(&'a [u8; 32]),
    PreAuth(&'a str),
}

#[derive(Clone, Eq, PartialEq)]
pub struct CsrfToken {
    nonce: [u8; NONCE_BYTES],
    signature: [u8; SIGNATURE_BYTES],
    encoded: String,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CsrfTokenError {
    #[error("CSRF token 格式无效")]
    Invalid,
}

impl CsrfToken {
    #[must_use]
    pub fn mint(secret: &AppSecret, context: CsrfContext<'_>) -> Self {
        let mut nonce = [0_u8; NONCE_BYTES];
        OsRng.fill_bytes(&mut nonce);
        let signature = sign(secret, context, &nonce);
        let encoded = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(nonce),
            URL_SAFE_NO_PAD.encode(signature)
        );
        Self {
            nonce,
            signature,
            encoded,
        }
    }

    /// # Errors
    ///
    /// token 不是两个规范 base64url 片段或长度不正确时返回错误。
    pub fn parse(input: &str) -> Result<Self, CsrfTokenError> {
        let (nonce, signature) = input.split_once('.').ok_or(CsrfTokenError::Invalid)?;
        if signature.contains('.') {
            return Err(CsrfTokenError::Invalid);
        }
        let nonce_bytes = decode_canonical::<NONCE_BYTES>(nonce)?;
        let signature_bytes = decode_canonical::<SIGNATURE_BYTES>(signature)?;
        Ok(Self {
            nonce: nonce_bytes,
            signature: signature_bytes,
            encoded: input.to_owned(),
        })
    }

    #[must_use]
    pub fn verify(&self, secret: &AppSecret, context: CsrfContext<'_>) -> bool {
        let mut mac = new_mac(secret);
        update_context(&mut mac, context);
        mac.update(&self.nonce);
        mac.verify_slice(&self.signature).is_ok()
    }

    /// 只有 HTTP header DTO 可以取签名 token；不得写入日志。
    #[must_use]
    pub fn expose_for_header(&self) -> &str {
        &self.encoded
    }
}

impl fmt::Debug for CsrfToken {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CsrfToken([REDACTED])")
    }
}

fn sign(
    secret: &AppSecret,
    context: CsrfContext<'_>,
    nonce: &[u8; NONCE_BYTES],
) -> [u8; SIGNATURE_BYTES] {
    let mut mac = new_mac(secret);
    update_context(&mut mac, context);
    mac.update(nonce);
    mac.finalize().into_bytes().into()
}

fn new_mac(secret: &AppSecret) -> HmacSha256 {
    HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC-SHA256 接受任意长度密钥")
}

fn update_context(mac: &mut HmacSha256, context: CsrfContext<'_>) {
    mac.update(b"huddletab-csrf-v1\0");
    match context {
        CsrfContext::Session(hash) => {
            mac.update(b"session\0");
            mac.update(hash);
        }
        CsrfContext::PreAuth(value) => {
            mac.update(b"preauth\0");
            mac.update(value.as_bytes());
        }
    }
}

fn decode_canonical<const N: usize>(input: &str) -> Result<[u8; N], CsrfTokenError> {
    let decoded = URL_SAFE_NO_PAD
        .decode(input)
        .map_err(|_| CsrfTokenError::Invalid)?;
    if URL_SAFE_NO_PAD.encode(&decoded) != input {
        return Err(CsrfTokenError::Invalid);
    }
    decoded.try_into().map_err(|_| CsrfTokenError::Invalid)
}
