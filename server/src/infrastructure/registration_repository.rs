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
        let policy = sqlx::query_scalar::<_, String>(
            "SELECT registration_policy FROM system_settings WHERE id = 'singleton' FOR SHARE",
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or_else(|| {
            log_repository_error(sqlx::Error::Protocol(
                "缺少 system_settings 单例".to_owned(),
            ))
        })?;
        if policy == "INVITE_ONLY" && registration.invitation_hash.is_none() {
            return Err(RegistrationRepositoryError::InviteRequired);
        }
        if let Some(invitation_hash) = registration.invitation_hash.as_ref() {
            let invitation = sqlx::query_as::<_, (Option<String>, Option<uuid::Uuid>)>(
                "SELECT i.target_display_name, i.guest_member_id FROM activity_invites i \
                 JOIN activities a ON a.id = i.activity_id \
                 WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > $2 \
                   AND (i.max_uses IS NULL OR i.use_count < i.max_uses) AND a.status = 'ACTIVE' \
                   AND a.deleted_at IS NULL \
                   FOR SHARE OF i, a",
            )
            .bind(invitation_hash.as_slice())
            .bind(registration.created_at)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
            let (target_username, guest_member_id) =
                invitation.ok_or(RegistrationRepositoryError::InvalidInvitation)?;
            if guest_member_id.is_some()
                && target_username.as_deref() != Some(&registration.username)
            {
                return Err(RegistrationRepositoryError::InvitationTargetMismatch);
            }
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
