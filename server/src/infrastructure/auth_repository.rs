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

/// 用户自定义头像元数据；图片本体始终保存在私有存储。
#[derive(Clone, Debug)]
pub struct UserAvatarImage {
    pub image_id: uuid::Uuid,
    pub storage_key: String,
    pub width: i32,
    pub height: i32,
    pub byte_size: i64,
}

impl PostgresAuthRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// 原子替换头像元数据并推进所有相关活动 revision，返回旧存储键供提交后清理。
    ///
    /// # Errors
    ///
    /// 当数据库不可用或头像元数据无法保存时返回错误。
    pub async fn replace_avatar_image(
        &self,
        user_id: uuid::Uuid,
        image: UserAvatarImage,
    ) -> Result<Option<String>, AuthRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let old_storage_key = sqlx::query_scalar::<_, String>(
            "SELECT storage_key FROM user_avatar_images WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let result = sqlx::query(
            "INSERT INTO user_avatar_images (user_id, image_id, storage_key, width, height, byte_size, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
             ON CONFLICT (user_id) DO UPDATE SET image_id = EXCLUDED.image_id, storage_key = EXCLUDED.storage_key,
                 width = EXCLUDED.width, height = EXCLUDED.height, byte_size = EXCLUDED.byte_size, updated_at = NOW()",
        )
        .bind(user_id)
        .bind(image.image_id)
        .bind(&image.storage_key)
        .bind(image.width)
        .bind(image.height)
        .bind(image.byte_size)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        if result.rows_affected() != 1 {
            return Err(AuthRepositoryError);
        }
        sqlx::query(
            "UPDATE activities SET revision = revision + 1, updated_at = NOW()
             WHERE id IN (SELECT DISTINCT activity_id FROM activity_members WHERE user_id = $1 AND status = 'ACTIVE')",
        )
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(old_storage_key)
    }

    ///
    /// # Errors
    ///
    /// 当数据库不可用或指定头像不存在时返回错误。
    pub async fn avatar_image_for_user(
        &self,
        user_id: uuid::Uuid,
        image_id: uuid::Uuid,
    ) -> Result<UserAvatarImage, AuthRepositoryError> {
        sqlx::query_as::<_, UserAvatarImageRow>(
            "SELECT image_id, storage_key, width, height, byte_size FROM user_avatar_images
             WHERE user_id = $1 AND image_id = $2",
        )
        .bind(user_id)
        .bind(image_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(log_repository_error)?
        .map(UserAvatarImage::from)
        .ok_or(AuthRepositoryError)
    }
}

#[derive(sqlx::FromRow)]
struct UserAvatarImageRow {
    image_id: uuid::Uuid,
    storage_key: String,
    width: i32,
    height: i32,
    byte_size: i64,
}

impl From<UserAvatarImageRow> for UserAvatarImage {
    fn from(row: UserAvatarImageRow) -> Self {
        Self {
            image_id: row.image_id,
            storage_key: row.storage_key,
            width: row.width,
            height: row.height,
            byte_size: row.byte_size,
        }
    }
}

#[async_trait]
impl AuthRepository for PostgresAuthRepository {
    async fn find_credentials(
        &self,
        username: &str,
    ) -> Result<Option<StoredCredentials>, AuthRepositoryError> {
        let row = sqlx::query_as::<_, (uuid::Uuid, String, String, i16, Option<uuid::Uuid>, String, bool)>(
            "SELECT u.id, u.username, u.display_name, u.avatar_preset, avatar.image_id, u.password_hash, \
             EXISTS (SELECT 1 FROM system_roles sr WHERE sr.user_id = u.id AND sr.role = 'SYSTEM_ADMIN') \
             FROM users u LEFT JOIN user_avatar_images avatar ON avatar.user_id = u.id WHERE u.username = $1 AND u.disabled_at IS NULL",
        )
        .bind(username)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            tracing::error!(%error, "读取登录凭据失败");
            AuthRepositoryError
        })?;
        Ok(row.map(
            |(
                user_id,
                username,
                display_name,
                avatar_preset,
                avatar_image_id,
                password_hash,
                is_system_admin,
            )| {
                StoredCredentials {
                    user_id,
                    username,
                    display_name,
                    avatar_preset,
                    avatar_image_id,
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
                Option<uuid::Uuid>,
                String,
                time::OffsetDateTime,
                time::OffsetDateTime,
                bool,
            ),
        >(
            "SELECT s.id, u.id, u.username, u.display_name, u.avatar_preset, avatar.image_id, u.password_hash, \
             s.created_at, s.last_seen_at, \
             EXISTS (SELECT 1 FROM system_roles sr WHERE sr.user_id = u.id AND sr.role = 'SYSTEM_ADMIN') \
             FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN user_avatar_images avatar ON avatar.user_id = u.id \
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
                avatar_image_id,
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
                    avatar_image_id,
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
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let result = sqlx::query(
            "UPDATE users SET avatar_preset = $2, version = version + 1, updated_at = NOW() \
             WHERE id = $1",
        )
        .bind(user_id)
        .bind(avatar_preset)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        if result.rows_affected() != 1 {
            tracing::error!(%user_id, "保存头像失败：用户不存在");
            return Err(AuthRepositoryError);
        }
        sqlx::query("DELETE FROM user_avatar_images WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
        sqlx::query(
            "UPDATE activities SET revision = revision + 1, updated_at = NOW()
             WHERE id IN (SELECT DISTINCT activity_id FROM activity_members WHERE user_id = $1 AND status = 'ACTIVE')",
        )
        .bind(user_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(())
    }

    /// 昵称、成员副本和活动 Snapshot revision 必须在同一事务内完成，避免 PWA
    /// 通过旧 `ETag` 继续读取旧成员名称。临时成员没有 `user_id`，不会被匹配。
    async fn update_display_name(
        &self,
        user_id: uuid::Uuid,
        display_name: &str,
    ) -> Result<(), AuthRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let result = sqlx::query(
            "UPDATE users SET display_name = $2, version = version + 1, updated_at = NOW() \
             WHERE id = $1",
        )
        .bind(user_id)
        .bind(display_name)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        if result.rows_affected() != 1 {
            tracing::error!(%user_id, "保存昵称失败：用户不存在");
            return Err(AuthRepositoryError);
        }

        sqlx::query(
            "WITH changed_members AS ( \
                 UPDATE activity_members SET display_name = $2, version = version + 1 \
                 WHERE user_id = $1 AND display_name IS DISTINCT FROM $2 \
                 RETURNING activity_id \
             ), changed_activities AS ( \
                 SELECT DISTINCT activity_id FROM changed_members \
             ) \
             UPDATE activities SET revision = revision + 1, updated_at = NOW() \
             WHERE id IN (SELECT activity_id FROM changed_activities)",
        )
        .bind(user_id)
        .bind(display_name)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;

        transaction.commit().await.map_err(log_repository_error)?;
        Ok(())
    }
}

fn log_repository_error(error: sqlx::Error) -> AuthRepositoryError {
    tracing::error!(%error, "写入认证数据失败");
    drop(error);
    AuthRepositoryError
}
