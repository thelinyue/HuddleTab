//! 链接邀请令牌的加密存储；用途密钥与其他应用密文隔离。

use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use thiserror::Error;
use uuid::Uuid;

use super::app_secret::AppSecret;

const PREFIX: &[u8; 5] = b"HTIV1";
const SALT: &[u8] = b"huddletab-invitation-token-kdf-v1";
const INFO: &[u8] = b"huddletab/invitation/link-token/v1";

/// 邀请链接密文操作的内部错误；不包含令牌或底层 AEAD 细节。
#[derive(Debug, Error, Eq, PartialEq)]
pub enum InvitationSecretError {
    #[error("邀请链接密文格式无效")]
    InvalidEnvelope,
    #[error("邀请链接加密失败")]
    EncryptionFailed,
    #[error("邀请链接密文无法解密")]
    DecryptionFailed,
}

fn cipher(secret: &AppSecret) -> XChaCha20Poly1305 {
    let mut key = [0_u8; 32];
    Hkdf::<Sha256>::new(Some(SALT), secret.as_bytes())
        .expand(INFO, &mut key)
        .expect("固定长度的 HKDF 输出始终合法");
    XChaCha20Poly1305::new((&key).into())
}

/// 用邀请 ID 绑定密文，防止数据库中的密文被移到另一条邀请上。
///
/// # Errors
///
/// 加密器无法处理明文时返回错误，错误不包含令牌内容。
pub fn encrypt(
    secret: &AppSecret,
    invitation_id: Uuid,
    token: &str,
) -> Result<Vec<u8>, InvitationSecretError> {
    let mut nonce = [0_u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher(secret)
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: token.as_bytes(),
                aad: invitation_id.as_bytes(),
            },
        )
        .map_err(|_| InvitationSecretError::EncryptionFailed)?;
    let mut envelope = Vec::with_capacity(PREFIX.len() + nonce.len() + ciphertext.len());
    envelope.extend_from_slice(PREFIX);
    envelope.extend_from_slice(&nonce);
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

/// 解密时同时校验格式、邀请 ID 与认证标签，避免跨邀请替换密文。
///
/// # Errors
///
/// 密文格式错误、认证失败或明文不是 UTF-8 时返回错误。
pub fn decrypt(
    secret: &AppSecret,
    invitation_id: Uuid,
    envelope: &[u8],
) -> Result<String, InvitationSecretError> {
    if envelope.len() < PREFIX.len() + 24 + 16 || !envelope.starts_with(PREFIX) {
        return Err(InvitationSecretError::InvalidEnvelope);
    }
    let nonce_start = PREFIX.len();
    let ciphertext_start = nonce_start + 24;
    let plaintext = cipher(secret)
        .decrypt(
            XNonce::from_slice(&envelope[nonce_start..ciphertext_start]),
            Payload {
                msg: &envelope[ciphertext_start..],
                aad: invitation_id.as_bytes(),
            },
        )
        .map_err(|_| InvitationSecretError::DecryptionFailed)?;
    String::from_utf8(plaintext).map_err(|_| InvitationSecretError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ciphertext_is_bound_to_invitation_and_secret() {
        let secret = AppSecret::from_bytes([7; 32]);
        let id = Uuid::new_v4();
        let first = encrypt(&secret, id, "token").unwrap();
        assert_ne!(first, encrypt(&secret, id, "token").unwrap());
        assert_eq!(decrypt(&secret, id, &first).unwrap(), "token");
        assert!(decrypt(&secret, Uuid::new_v4(), &first).is_err());
        assert!(decrypt(&AppSecret::from_bytes([8; 32]), id, &first).is_err());
    }
}
