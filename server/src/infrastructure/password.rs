use argon2::{
    Algorithm, Argon2, Params, PasswordHash, PasswordHasher as _, PasswordVerifier as _, Version,
    password_hash::{Error as PasswordHashError, SaltString},
};
use rand_core::OsRng;

use crate::{
    application::ports::{PasswordHasher, PasswordHashingError, PasswordVerification},
    domain::identity::Password,
};

const MEMORY_COST_KIB: u32 = 65_536;
const TIME_COST: u32 = 3;
const PARALLELISM: u32 = 1;

#[derive(Clone, Copy, Debug, Default)]
pub struct Argon2PasswordHasher;

impl Argon2PasswordHasher {
    fn configured() -> Result<Argon2<'static>, PasswordHashingError> {
        let params = Params::new(MEMORY_COST_KIB, TIME_COST, PARALLELISM, None)
            .map_err(|_| PasswordHashingError::HashingFailed)?;
        Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
    }
}

impl PasswordHasher for Argon2PasswordHasher {
    fn hash(&self, password: &Password) -> Result<String, PasswordHashingError> {
        Self::configured()?
            .hash_password(
                password.as_str().as_bytes(),
                &SaltString::generate(&mut OsRng),
            )
            .map(|hash| hash.to_string())
            .map_err(|_| PasswordHashingError::HashingFailed)
    }

    fn verify(
        &self,
        password: &Password,
        encoded_hash: &str,
    ) -> Result<PasswordVerification, PasswordHashingError> {
        let parsed =
            PasswordHash::new(encoded_hash).map_err(|_| PasswordHashingError::InvalidHash)?;
        match Self::configured()?.verify_password(password.as_str().as_bytes(), &parsed) {
            Ok(()) => Ok(PasswordVerification {
                valid: true,
                needs_rehash: !uses_current_parameters(&parsed),
            }),
            Err(PasswordHashError::Password) => Ok(PasswordVerification {
                valid: false,
                needs_rehash: false,
            }),
            Err(_) => Err(PasswordHashingError::InvalidHash),
        }
    }
}

fn uses_current_parameters(hash: &PasswordHash<'_>) -> bool {
    hash.algorithm.as_str() == "argon2id"
        && hash.version == Some(19)
        && hash.params.get_decimal("m") == Some(MEMORY_COST_KIB)
        && hash.params.get_decimal("t") == Some(TIME_COST)
        && hash.params.get_decimal("p") == Some(PARALLELISM)
}
