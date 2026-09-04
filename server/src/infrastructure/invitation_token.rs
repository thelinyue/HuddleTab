use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};

use crate::application::collaboration::{InvitationTokenCodec, IssuedInvitationToken};

const TOKEN_BYTES: usize = 32;

#[derive(Clone, Copy, Debug, Default)]
pub struct SecureInvitationTokenCodec;

impl InvitationTokenCodec for SecureInvitationTokenCodec {
    fn generate(&self) -> IssuedInvitationToken {
        let mut bytes = [0_u8; TOKEN_BYTES];
        OsRng.fill_bytes(&mut bytes);
        let raw = URL_SAFE_NO_PAD.encode(bytes);
        let hash = Sha256::digest(raw.as_bytes()).into();
        IssuedInvitationToken::new(raw, hash)
    }

    fn hash(&self, raw: &str) -> Option<[u8; 32]> {
        let bytes = URL_SAFE_NO_PAD.decode(raw).ok()?;
        if bytes.len() != TOKEN_BYTES || URL_SAFE_NO_PAD.encode(bytes) != raw {
            return None;
        }
        Some(Sha256::digest(raw.as_bytes()).into())
    }
}
