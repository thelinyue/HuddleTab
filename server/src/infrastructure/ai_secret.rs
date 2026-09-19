//! AI Provider 密钥的专用加密封装。
//!
//! 这里故意不复用 app-secret 作为 AEAD 密钥：app-secret 只作为 HKDF 的输入，
//! 通过固定用途上下文派生出 AI API Key 专用子密钥，避免不同用途之间密钥复用。

use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use thiserror::Error;

use super::app_secret::AppSecret;

const MAGIC: &[u8; 4] = b"HTAI";
const FORMAT_VERSION: u8 = 1;
const NONCE_BYTES: usize = 24;
const KEY_BYTES: usize = 32;
const KDF_SALT: &[u8] = b"huddletab-ai-api-key-kdf-v1";
const KDF_INFO: &[u8] = b"huddletab/ai-expense-draft/api-key/v1";
const AAD: &[u8] = b"huddletab:system-settings:ai-api-key:v1";

#[derive(Debug, Error, Eq, PartialEq)]
pub enum AiSecretError {
    #[error("AI API Key 为空或长度超限")]
    InvalidPlaintext,
    #[error("AI API Key 密文格式或版本无效")]
    InvalidEnvelope,
    #[error("AI API Key 密文无法解密")]
    DecryptionFailed,
    #[error("AI API Key 加密失败")]
    EncryptionFailed,
}

/// 使用 HKDF 派生 AI API Key 专用的 XChaCha20-Poly1305 密钥。
fn derive_key(app_secret: &AppSecret) -> [u8; KEY_BYTES] {
    let hkdf = Hkdf::<Sha256>::new(Some(KDF_SALT), app_secret.as_bytes());
    let mut key = [0_u8; KEY_BYTES];
    // 固定长度输出和常量上下文不会失败；若密码学库未来改变行为，宁可 panic 也不降级。
    hkdf.expand(KDF_INFO, &mut key)
        .expect("HKDF 固定 32-byte 输出始终合法");
    key
}

/// 加密写入数据库的 API Key。返回值包含格式版本和 nonce，不额外保存 nonce 列。
///
/// # Errors
///
/// 明文为空或超过 512 字节时返回错误。
pub fn encrypt_api_key(app_secret: &AppSecret, api_key: &str) -> Result<Vec<u8>, AiSecretError> {
    if api_key.is_empty() || api_key.len() > 512 {
        return Err(AiSecretError::InvalidPlaintext);
    }
    let cipher = XChaCha20Poly1305::new((&derive_key(app_secret)).into());
    let mut nonce = [0_u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: api_key.as_bytes(),
                aad: AAD,
            },
        )
        .map_err(|_| AiSecretError::EncryptionFailed)?;
    let mut envelope = Vec::with_capacity(MAGIC.len() + 1 + NONCE_BYTES + ciphertext.len());
    envelope.extend_from_slice(MAGIC);
    envelope.push(FORMAT_VERSION);
    envelope.extend_from_slice(&nonce);
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

/// 解密数据库中的 API Key；任何格式或认证失败都统一为可重配状态。
///
/// # Errors
///
/// 密文格式未知或 AEAD 认证失败时返回错误，不向 HTTP 层暴露细节。
pub fn decrypt_api_key(app_secret: &AppSecret, envelope: &[u8]) -> Result<String, AiSecretError> {
    if envelope.len() < MAGIC.len() + 1 + NONCE_BYTES + 16
        || &envelope[..MAGIC.len()] != MAGIC
        || envelope[MAGIC.len()] != FORMAT_VERSION
    {
        return Err(AiSecretError::InvalidEnvelope);
    }
    let nonce_start = MAGIC.len() + 1;
    let ciphertext_start = nonce_start + NONCE_BYTES;
    let cipher = XChaCha20Poly1305::new((&derive_key(app_secret)).into());
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&envelope[nonce_start..ciphertext_start]),
            Payload {
                msg: &envelope[ciphertext_start..],
                aad: AAD,
            },
        )
        .map_err(|_| AiSecretError::DecryptionFailed)?;
    String::from_utf8(plaintext).map_err(|_| AiSecretError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_random_nonce() {
        let secret = AppSecret::from_bytes([7; 32]);
        let first = encrypt_api_key(&secret, "sk-test").unwrap();
        let second = encrypt_api_key(&secret, "sk-test").unwrap();
        assert_ne!(first, second);
        assert_eq!(decrypt_api_key(&secret, &first).unwrap(), "sk-test");
    }

    #[test]
    fn wrong_secret_requires_reconfiguration() {
        let first = encrypt_api_key(&AppSecret::from_bytes([7; 32]), "sk-test").unwrap();
        assert!(decrypt_api_key(&AppSecret::from_bytes([8; 32]), &first).is_err());
    }
}
