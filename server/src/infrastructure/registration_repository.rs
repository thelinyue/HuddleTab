use async_trait::async_trait;
use sqlx::PgPool;

use crate::application::auth::{
    NewRegistration, RegistrationRepository, RegistrationRepositoryError,
};

#[derive(Clone, Debug)]
pub struct PostgresRegistrationRepository {
    pool: PgPool,
}

impl PostgresRegistrationRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl RegistrationRepository for PostgresRegistrationRepository {
    async fn register(
        &self,
        registration: NewRegistration,
    ) -> Result<(), RegistrationRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let invitation_valid = sqlx::query_scalar::<_, uuid::Uuid>(
            "SELECT i.id FROM activity_invites i \
             JOIN activities a ON a.id = i.activity_id \
             WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > $2 \
               AND (i.max_uses IS NULL OR i.use_count < i.max_uses) AND a.status = 'ACTIVE' \
               AND (i.kind = 'LINK' OR i.target_username = $3) FOR SHARE OF i, a",
        )
        .bind(registration.invitation_hash.as_slice())
        .bind(registration.created_at)
        .bind(&registration.username)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        if invitation_valid.is_none() {
            return Err(RegistrationRepositoryError::InvalidInvitation);
        }
        sqlx::query(
            "INSERT INTO users (id, username, password_hash, display_name, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $5)",
        )
        .bind(registration.user_id)
        .bind(&registration.username)
        .bind(&registration.password_hash)
        .bind(&registration.display_name)
        .bind(registration.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(map_user_insert_error)?;
        sqlx::query(
            "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
             idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
        )
        .bind(registration.session.id)
        .bind(registration.session.user_id)
        .bind(registration.session.token_hash.as_slice())
        .bind(registration.session.created_at)
        .bind(registration.session.idle_expires_at)
        .bind(registration.session.absolute_expires_at)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(())
    }
}

fn map_user_insert_error(error: sqlx::Error) -> RegistrationRepositoryError {
    if error
        .as_database_error()
        .and_then(|database_error| database_error.constraint())
        == Some("users_username_key")
    {
        return RegistrationRepositoryError::UsernameTaken;
    }
    log_repository_error(error)
}

fn log_repository_error(error: sqlx::Error) -> RegistrationRepositoryError {
    tracing::error!(%error, "邀请注册事务执行失败");
    drop(error);
    RegistrationRepositoryError::Unavailable
}
