use async_trait::async_trait;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::system_admin::{
    RegistrationPolicy, RegistrationPolicyView, SystemAdminError, SystemAdminRepository, SystemUser,
};

const ADMIN_INVARIANT_LOCK: &str = "huddletab-system-admin-invariant";

/// 平台账号写入在事务中维护历史引用及管理员保护，账号附属数据沿用数据库级联规则。
#[derive(Clone, Debug)]
pub struct PostgresSystemAdminRepository {
    pool: PgPool,
}

impl PostgresSystemAdminRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SystemAdminRepository for PostgresSystemAdminRepository {
    async fn list_users(&self) -> Result<Vec<SystemUser>, SystemAdminError> {
        sqlx::query_as::<_, (Uuid, String, String, i16, Option<Uuid>, Option<OffsetDateTime>, bool)>(
            "SELECT u.id, u.username, u.display_name, u.avatar_preset, avatar.image_id, u.disabled_at, \
             EXISTS (SELECT 1 FROM system_roles sr WHERE sr.user_id = u.id AND sr.role = 'SYSTEM_ADMIN') \
             FROM users u LEFT JOIN user_avatar_images avatar ON avatar.user_id = u.id ORDER BY u.created_at, u.id",
        )
        .fetch_all(&self.pool)
        .await
        .map(|rows| {
            rows.into_iter()
                .map(|(id, username, display_name, avatar_preset, avatar_image_id, disabled_at, is_system_admin)| SystemUser {
                    id,
                    username,
                    display_name,
                    avatar_preset,
                    avatar_image_id,
                    disabled: disabled_at.is_some(),
                    is_system_admin,
                })
                .collect()
        })
        .map_err(|error| log_error(&error))
    }

    async fn is_system_admin(&self, user_id: Uuid) -> Result<bool, SystemAdminError> {
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM users u JOIN system_roles sr ON sr.user_id = u.id \
             WHERE u.id = $1 AND u.disabled_at IS NULL AND sr.role = 'SYSTEM_ADMIN')",
        )
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(|error| log_error(&error))
    }

    async fn delete_user(&self, user_id: Uuid) -> Result<Option<String>, SystemAdminError> {
        let mut transaction = self.pool.begin().await.map_err(|error| log_error(&error))?;
        lock_admin_invariant(&mut transaction).await?;
        // FOR UPDATE 与引用用户的外键检查互斥，确保检查后不会插入新的入群申请并被级联误删。
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM users WHERE id = $1 FOR UPDATE")
            .bind(user_id)
            .fetch_optional(&mut *transaction)
            .await
            .map_err(|error| log_error(&error))?
            .ok_or(SystemAdminError::UserNotFound)?;
        // 不按活动、成员或账目状态过滤；退出、结清、拒绝、软删除也都是仍保留的历史。
        let has_history = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (
                SELECT 1 FROM activities WHERE created_by_user_id = $1
                UNION ALL SELECT 1 FROM activity_members WHERE user_id = $1
                UNION ALL SELECT 1 FROM activity_join_requests WHERE applicant_user_id = $1
                UNION ALL SELECT 1 FROM expenses WHERE created_by_user_id = $1
                UNION ALL SELECT 1 FROM settlements WHERE created_by_user_id = $1 OR voided_by_user_id = $1
                UNION ALL SELECT 1 FROM activity_audit_logs WHERE actor_user_id = $1
                UNION ALL SELECT 1 FROM system_admin_audit_logs WHERE actor_user_id = $1
             )",
        )
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(|error| log_error(&error))?;
        if has_history {
            return Err(SystemAdminError::UserHasBusinessRecords);
        }
        let avatar_storage_key = sqlx::query_scalar::<_, String>(
            "SELECT storage_key FROM user_avatar_images WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| log_error(&error))?;
        sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(user_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| {
                // 保留 RESTRICT 外键作为最终保护，约束冲突应给出可理解的业务提示。
                if error
                    .as_database_error()
                    .is_some_and(sqlx::error::DatabaseError::is_foreign_key_violation)
                {
                    SystemAdminError::UserHasBusinessRecords
                } else {
                    log_error(&error)
                }
            })?;
        ensure_login_capable_admin_remains(&mut transaction).await?;
        transaction
            .commit()
            .await
            .map_err(|error| log_error(&error))?;
        Ok(avatar_storage_key)
    }

    async fn set_user_disabled(
        &self,
        user_id: Uuid,
        disabled: bool,
        now: OffsetDateTime,
    ) -> Result<(), SystemAdminError> {
        let mut transaction = self.pool.begin().await.map_err(|error| log_error(&error))?;
        lock_admin_invariant(&mut transaction).await?;
        let changed = sqlx::query(
            "UPDATE users SET disabled_at = CASE WHEN $2 THEN $3 ELSE NULL END, updated_at = $3 \
             WHERE id = $1",
        )
        .bind(user_id)
        .bind(disabled)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| log_error(&error))?;
        if changed.rows_affected() == 0 {
            return Err(SystemAdminError::UserNotFound);
        }
        if disabled {
            ensure_login_capable_admin_remains(&mut transaction).await?;
            sqlx::query(
                "UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
            )
            .bind(user_id)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(|error| log_error(&error))?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| log_error(&error))
    }

    async fn set_system_admin(
        &self,
        user_id: Uuid,
        granted: bool,
        granted_by: Uuid,
        now: OffsetDateTime,
    ) -> Result<(), SystemAdminError> {
        let mut transaction = self.pool.begin().await.map_err(|error| log_error(&error))?;
        lock_admin_invariant(&mut transaction).await?;
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)")
                .bind(user_id)
                .fetch_one(&mut *transaction)
                .await
                .map_err(|error| log_error(&error))?;
        if !exists {
            return Err(SystemAdminError::UserNotFound);
        }
        if granted {
            sqlx::query(
                "INSERT INTO system_roles (user_id, role, granted_by_user_id, granted_at) \
                 VALUES ($1, 'SYSTEM_ADMIN', $2, $3) ON CONFLICT (user_id, role) DO NOTHING",
            )
            .bind(user_id)
            .bind(granted_by)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(|error| log_error(&error))?;
        } else {
            sqlx::query("DELETE FROM system_roles WHERE user_id = $1 AND role = 'SYSTEM_ADMIN'")
                .bind(user_id)
                .execute(&mut *transaction)
                .await
                .map_err(|error| log_error(&error))?;
            ensure_login_capable_admin_remains(&mut transaction).await?;
            sqlx::query(
                "UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
            )
            .bind(user_id)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(|error| log_error(&error))?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| log_error(&error))
    }

    async fn reset_password(
        &self,
        user_id: Uuid,
        password_hash: String,
        now: OffsetDateTime,
    ) -> Result<(), SystemAdminError> {
        let mut transaction = self.pool.begin().await.map_err(|error| log_error(&error))?;
        let changed = sqlx::query(
            "UPDATE users SET password_hash = $2, version = version + 1, updated_at = $3 WHERE id = $1",
        )
        .bind(user_id)
        .bind(password_hash)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| log_error(&error))?;
        if changed.rows_affected() == 0 {
            return Err(SystemAdminError::UserNotFound);
        }
        sqlx::query(
            "UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL",
        )
        .bind(user_id)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|error| log_error(&error))?;
        transaction
            .commit()
            .await
            .map_err(|error| log_error(&error))
    }

    async fn get_registration_policy(&self) -> Result<RegistrationPolicyView, SystemAdminError> {
        let row = sqlx::query_as::<_, (String, i64)>(
            "SELECT registration_policy, version FROM system_settings WHERE id = 'singleton'",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| log_error(&error))?
        .ok_or(SystemAdminError::Unavailable)?;
        Ok(map_policy(&row.0, row.1))
    }

    async fn set_registration_policy(
        &self,
        policy: RegistrationPolicy,
        expected_version: i64,
        actor: Uuid,
        now: OffsetDateTime,
    ) -> Result<RegistrationPolicyView, SystemAdminError> {
        let row = sqlx::query_as::<_, (String, i64)>(
            "UPDATE system_settings SET registration_policy = $1, version = version + 1, \
             updated_at = $2, updated_by_user_id = $3 WHERE id = 'singleton' AND version = $4 \
             RETURNING registration_policy, version",
        )
        .bind(policy.as_str())
        .bind(now)
        .bind(actor)
        .bind(expected_version)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| log_error(&error))?
        .ok_or(SystemAdminError::VersionConflict)?;
        Ok(map_policy(&row.0, row.1))
    }
}

async fn lock_admin_invariant(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), SystemAdminError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1))")
        .bind(ADMIN_INVARIANT_LOCK)
        .execute(&mut **transaction)
        .await
        .map_err(|error| log_error(&error))?;
    Ok(())
}

async fn ensure_login_capable_admin_remains(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), SystemAdminError> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM users u JOIN system_roles sr ON sr.user_id = u.id \
         WHERE u.disabled_at IS NULL AND u.password_hash <> '' AND sr.role = 'SYSTEM_ADMIN'",
    )
    .fetch_one(&mut **transaction)
    .await
    .map_err(|error| log_error(&error))?;
    if count == 0 {
        return Err(SystemAdminError::LastActiveAdmin);
    }
    Ok(())
}

fn map_policy(policy: &str, version: i64) -> RegistrationPolicyView {
    RegistrationPolicyView {
        policy: if policy == "OPEN" {
            RegistrationPolicy::Open
        } else {
            RegistrationPolicy::InviteOnly
        },
        version,
    }
}

fn log_error(error: &sqlx::Error) -> SystemAdminError {
    tracing::error!(%error, "系统管理数据库操作失败");
    SystemAdminError::Unavailable
}
