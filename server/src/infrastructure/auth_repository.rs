use async_trait::async_trait;
use sqlx::PgPool;

use crate::application::auth::{
    AuthRepository, AuthRepositoryError, NewSession, PasswordRotation, StoredCredentials,
    StoredSession,
};

#[derive(Clone, Debug)]
pub struct PostgresAuthRepository {
    pool: PgPool,
}

impl PostgresAuthRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AuthRepository for PostgresAuthRepository {
    async fn find_credentials(
        &self,
        username: &str,
    ) -> Result<Option<StoredCredentials>, AuthRepositoryError> {
        let row = sqlx::query_as::<_, (uuid::Uuid, String, String, i16, String, bool)>(
            "SELECT u.id, u.username, u.display_name, u.avatar_preset, u.password_hash, \
             EXISTS (SELECT 1 FROM system_roles sr WHERE sr.user_id = u.id AND sr.role = 'SYSTEM_ADMIN') \
             FROM users u WHERE u.username = $1 AND u.disabled_at IS NULL",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            tracing::error!(%error, "读取登录凭据失败");
            AuthRepositoryError
        })?;
        Ok(row.map(
            |(user_id, username, display_name, avatar_preset, password_hash, is_system_admin)| {
                StoredCredentials {
                    user_id,
                    username,
                    display_name,
                    avatar_preset,
                    password_hash,
                    is_system_admin,
                }
            },
        ))
    }

    async fn create_session(&self, session: NewSession) -> Result<(), AuthRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        if let Some(password_hash) = session.replacement_password_hash {
            sqlx::query(
                "UPDATE users SET password_hash = $1, version = version + 1, updated_at = $2 \
                 WHERE id = $3",
            )
            .bind(password_hash)
            .bind(session.created_at)
            .bind(session.user_id)
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
        }
        sqlx::query(
            "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
             idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
        )
        .bind(session.id)
        .bind(session.user_id)
        .bind(session.token_hash.as_slice())
        .bind(session.created_at)
        .bind(session.idle_expires_at)
        .bind(session.absolute_expires_at)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(())
    }

    async fn find_session(
        &self,
        token_hash: &[u8; 32],
    ) -> Result<Option<StoredSession>, AuthRepositoryError> {
        let row = sqlx::query_as::<
            _,
            (
                uuid::Uuid,
                uuid::Uuid,
                String,
                String,
                i16,
                String,
                time::OffsetDateTime,
                time::OffsetDateTime,
                bool,
            ),
        >(
            "SELECT s.id, u.id, u.username, u.display_name, u.avatar_preset, u.password_hash, \
             s.created_at, s.last_seen_at, \
             EXISTS (SELECT 1 FROM system_roles sr WHERE sr.user_id = u.id AND sr.role = 'SYSTEM_ADMIN') \
             FROM sessions s JOIN users u ON u.id = s.user_id \
             WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND u.disabled_at IS NULL",
        )
        .bind(token_hash.as_slice())
        .fetch_optional(&self.pool)
        .await
        .map_err(log_repository_error)?;
        Ok(row.map(
            |(
                session_id,
                user_id,
                username,
                display_name,
                avatar_preset,
                password_hash,
                created_at,
                last_seen_at,
                is_system_admin,
            )| {
                StoredSession {
                    session_id,
                    user_id,
                    username,
                    display_name,
                    avatar_preset,
                    password_hash,
                    created_at,
                    last_seen_at,
                    is_system_admin,
                }
            },
        ))
    }

    async fn refresh_session(
        &self,
        session_id: uuid::Uuid,
        last_seen_at: time::OffsetDateTime,
        idle_expires_at: time::OffsetDateTime,
    ) -> Result<(), AuthRepositoryError> {
        sqlx::query(
            "UPDATE sessions SET last_seen_at = $1, idle_expires_at = $2 \
             WHERE id = $3 AND revoked_at IS NULL",
        )
        .bind(last_seen_at)
        .bind(idle_expires_at)
        .bind(session_id)
        .execute(&self.pool)
        .await
        .map_err(log_repository_error)?;
        Ok(())
    }

    async fn revoke_session(
        &self,
        session_id: uuid::Uuid,
        revoked_at: time::OffsetDateTime,
    ) -> Result<(), AuthRepositoryError> {
        sqlx::query("UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL")
            .bind(revoked_at)
            .bind(session_id)
            .execute(&self.pool)
            .await
            .map_err(log_repository_error)?;
        Ok(())
    }

    async fn rotate_password_and_session(
        &self,
        rotation: PasswordRotation,
    ) -> Result<(), AuthRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        sqlx::query(
            "UPDATE users SET password_hash = $1, version = version + 1, updated_at = $2 \
             WHERE id = $3",
        )
        .bind(rotation.password_hash)
        .bind(rotation.revoked_at)
        .bind(rotation.user_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query(
            "UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL",
        )
        .bind(rotation.revoked_at)
        .bind(rotation.user_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query(
            "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, \
             idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $4, $5, $6)",
        )
        .bind(rotation.new_session.id)
        .bind(rotation.new_session.user_id)
        .bind(rotation.new_session.token_hash.as_slice())
        .bind(rotation.new_session.created_at)
        .bind(rotation.new_session.idle_expires_at)
        .bind(rotation.new_session.absolute_expires_at)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(())
    }

    async fn update_avatar_preset(
        &self,
        user_id: uuid::Uuid,
        avatar_preset: i16,
    ) -> Result<(), AuthRepositoryError> {
        let result = sqlx::query(
            "UPDATE users SET avatar_preset = $2, version = version + 1, updated_at = NOW() \
             WHERE id = $1",
        )
        .bind(user_id)
        .bind(avatar_preset)
        .execute(&self.pool)
        .await
        .map_err(log_repository_error)?;
        if result.rows_affected() != 1 {
            tracing::error!(%user_id, "保存头像失败：用户不存在");
            return Err(AuthRepositoryError);
        }
        Ok(())
    }
}

fn log_repository_error(error: sqlx::Error) -> AuthRepositoryError {
    tracing::error!(%error, "写入认证数据失败");
    drop(error);
    AuthRepositoryError
}
