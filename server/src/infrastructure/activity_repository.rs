use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::application::activity::{
    ActivityMemberView, ActivityRepository, ActivityRepositoryError, ActivityView, CreatedActivity,
    NewActivity,
};

type ActivityRow = (Uuid, Uuid, String, String, String, i64, i64, Uuid, String);

#[derive(Clone, Debug)]
pub struct PostgresActivityRepository {
    pool: PgPool,
}

impl PostgresActivityRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ActivityRepository for PostgresActivityRepository {
    async fn create(
        &self,
        activity: NewActivity,
    ) -> Result<CreatedActivity, ActivityRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        sqlx::query(
            "INSERT INTO activities (id, name, base_currency, owner_member_id, \
             created_by_user_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)",
        )
        .bind(activity.activity_id)
        .bind(&activity.name)
        .bind(&activity.base_currency)
        .bind(activity.owner_member_id)
        .bind(activity.actor_user_id)
        .bind(activity.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query(
            "INSERT INTO activity_members (id, activity_id, user_id, display_name, role, joined_at) \
             VALUES ($1, $2, $3, $4, 'OWNER', $5)",
        )
        .bind(activity.owner_member_id)
        .bind(activity.activity_id)
        .bind(activity.actor_user_id)
        .bind(&activity.actor_display_name)
        .bind(activity.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query(
            "INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, \
             action, resource_type, resource_id, activity_revision, created_at) \
             VALUES ($1, $2, $3, $4, 'ACTIVITY_CREATED', 'ACTIVITY', $2, 1, $5)",
        )
        .bind(uuid::Uuid::new_v4())
        .bind(activity.activity_id)
        .bind(activity.actor_user_id)
        .bind(activity.owner_member_id)
        .bind(activity.created_at)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        transaction.commit().await.map_err(log_repository_error)?;

        Ok(CreatedActivity {
            activity_id: activity.activity_id,
            owner_member_id: activity.owner_member_id,
            name: activity.name,
            base_currency: activity.base_currency,
            version: 1,
            revision: 1,
        })
    }

    async fn list_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ActivityView>, ActivityRepositoryError> {
        let rows = sqlx::query_as::<_, ActivityRow>(
            "SELECT a.id, a.owner_member_id, a.name, a.base_currency, a.status, a.version, \
             a.revision, member.id, member.role FROM activities a \
             JOIN activity_members member ON member.activity_id = a.id \
             WHERE member.user_id = $1 AND member.status = 'ACTIVE' \
             ORDER BY a.updated_at DESC, a.id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(log_read_error)?;
        Ok(rows.into_iter().map(activity_from_row).collect())
    }

    async fn get_for_user(
        &self,
        activity_id: Uuid,
        user_id: Uuid,
    ) -> Result<ActivityView, ActivityRepositoryError> {
        let row = sqlx::query_as::<_, ActivityRow>(
            "SELECT a.id, a.owner_member_id, a.name, a.base_currency, a.status, a.version, \
             a.revision, member.id, member.role FROM activities a \
             JOIN activity_members member ON member.activity_id = a.id \
             WHERE a.id = $1 AND member.user_id = $2 AND member.status = 'ACTIVE'",
        )
        .bind(activity_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(log_read_error)?
        .ok_or(ActivityRepositoryError::NotFound)?;
        Ok(activity_from_row(row))
    }

    async fn list_members(
        &self,
        activity_id: Uuid,
        user_id: Uuid,
    ) -> Result<Vec<ActivityMemberView>, ActivityRepositoryError> {
        let is_member = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM activity_members \
             WHERE activity_id = $1 AND user_id = $2 AND status = 'ACTIVE')",
        )
        .bind(activity_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(log_read_error)?;
        if !is_member {
            return Err(ActivityRepositoryError::NotFound);
        }
        let rows = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, String, String, i64)>(
            "SELECT id, user_id, display_name, role, status, version FROM activity_members \
             WHERE activity_id = $1 ORDER BY CASE role WHEN 'OWNER' THEN 0 ELSE 1 END, joined_at, id",
        )
        .bind(activity_id)
        .fetch_all(&self.pool)
        .await
        .map_err(log_read_error)?;
        Ok(rows
            .into_iter()
            .map(
                |(member_id, member_user_id, display_name, role, status, version)| {
                    ActivityMemberView {
                        member_id,
                        activity_id,
                        user_id: member_user_id,
                        display_name,
                        role,
                        status,
                        version,
                    }
                },
            )
            .collect())
    }
}

fn log_repository_error(error: sqlx::Error) -> ActivityRepositoryError {
    tracing::error!(%error, "创建活动及 OWNER member 事务失败");
    drop(error);
    ActivityRepositoryError::Unavailable
}

fn log_read_error(error: sqlx::Error) -> ActivityRepositoryError {
    tracing::error!(%error, "读取活动或成员列表失败");
    drop(error);
    ActivityRepositoryError::Unavailable
}

fn activity_from_row(row: ActivityRow) -> ActivityView {
    ActivityView {
        activity_id: row.0,
        owner_member_id: row.1,
        name: row.2,
        base_currency: row.3,
        status: row.4,
        version: row.5,
        revision: row.6,
        current_member_id: row.7,
        current_member_role: row.8,
    }
}
