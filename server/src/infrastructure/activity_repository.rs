use async_trait::async_trait;
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::{
    application::activity::{
        ActivityDeletion, ActivityMemberView, ActivityMutationResult, ActivityRepository,
        ActivityRepositoryError, ActivityRestoration, ActivityTransition, ActivityUpdate,
        ActivityView, CreatedActivity, NewActivity,
    },
    domain::activity::{ActivityCapabilities, ActivityPeriod, ActivityStatus},
};

type ActivityRow = (
    Uuid,
    Uuid,
    String,
    Option<String>,
    String,
    Date,
    Option<Date>,
    String,
    i64,
    i64,
    Uuid,
    String,
    Option<OffsetDateTime>,
    Option<OffsetDateTime>,
    bool,
    Option<Date>,
);

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

// ActivityRepository 的事务实现集中在同一 trait impl，便于审计所有 mutation 的锁与副作用顺序。
#[allow(clippy::too_many_lines)]
#[async_trait]
impl ActivityRepository for PostgresActivityRepository {
    async fn create(
        &self,
        activity: NewActivity,
    ) -> Result<CreatedActivity, ActivityRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        sqlx::query(
            "INSERT INTO activities (id, name, location, base_currency, start_date, end_date, \
             owner_member_id, created_by_user_id, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)",
        )
        .bind(activity.activity_id)
        .bind(&activity.name)
        .bind(&activity.location)
        .bind(&activity.base_currency)
        .bind(activity.start_date)
        .bind(activity.end_date)
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
            location: activity.location,
            base_currency: activity.base_currency,
            start_date: activity.start_date,
            end_date: activity.end_date,
            version: 1,
            revision: 1,
        })
    }

    async fn list_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ActivityView>, ActivityRepositoryError> {
        let rows = sqlx::query_as::<_, ActivityRow>(
            "SELECT a.id, a.owner_member_id, a.name, a.location, a.base_currency, a.start_date, \
             a.end_date, a.status, a.version, a.revision, member.id, member.role, \
             a.deleted_at, a.purge_after, \
             (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
              OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)), \
             (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
              WHERE e.activity_id = a.id) FROM activities a \
             JOIN activity_members member ON member.activity_id = a.id \
             WHERE member.user_id = $1 AND member.status = 'ACTIVE' AND a.deleted_at IS NULL \
             ORDER BY a.updated_at DESC, a.id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(log_read_error)?;
        Ok(rows.into_iter().map(activity_from_row).collect())
    }

    async fn list_deleted_for_owner(
        &self,
        user_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<Vec<ActivityView>, ActivityRepositoryError> {
        let rows = sqlx::query_as::<_, ActivityRow>(
            "SELECT a.id, a.owner_member_id, a.name, a.location, a.base_currency, a.start_date, \
             a.end_date, a.status, a.version, a.revision, member.id, member.role, \
             a.deleted_at, a.purge_after, \
             (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
              OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)), \
             (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
              WHERE e.activity_id = a.id) FROM activities a \
             JOIN activity_members member ON member.activity_id = a.id \
             WHERE member.user_id = $1 AND member.status = 'ACTIVE' AND member.role = 'OWNER' \
             AND a.deleted_at IS NOT NULL AND a.purge_after > $2 \
             ORDER BY a.deleted_at DESC, a.id",
        )
        .bind(user_id)
        .bind(now)
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
            "SELECT a.id, a.owner_member_id, a.name, a.location, a.base_currency, a.start_date, \
             a.end_date, a.status, a.version, a.revision, member.id, member.role, \
             a.deleted_at, a.purge_after, \
             (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
              OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)), \
             (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
              WHERE e.activity_id = a.id) FROM activities a \
             JOIN activity_members member ON member.activity_id = a.id \
             WHERE a.id = $1 AND member.user_id = $2 AND member.status = 'ACTIVE' \
             AND a.deleted_at IS NULL",
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
            "SELECT EXISTS(SELECT 1 FROM activity_members member \
             JOIN activities activity ON activity.id = member.activity_id \
             WHERE member.activity_id = $1 AND member.user_id = $2 \
             AND member.status = 'ACTIVE' AND activity.deleted_at IS NULL)",
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

    async fn update(
        &self,
        update: ActivityUpdate,
    ) -> Result<ActivityMutationResult, ActivityRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let mut current =
            lock_activity(&mut transaction, update.activity_id, update.actor_user_id).await?;
        if current.current_member_role != "OWNER" {
            return Err(ActivityRepositoryError::Forbidden);
        }
        if current.version != update.expected_version {
            return Err(ActivityRepositoryError::VersionConflict);
        }

        let status = ActivityStatus::parse(&current.status)
            .map_err(|_| ActivityRepositoryError::Unavailable)?;
        let capabilities = ActivityCapabilities::for_actor(
            true,
            status,
            current.has_accounting_records,
            current.deleted_at.is_some(),
        );
        let next_name = update.name.unwrap_or_else(|| current.name.clone());
        let next_location = update.location.unwrap_or_else(|| current.location.clone());
        let next_currency = update
            .base_currency
            .unwrap_or_else(|| current.base_currency.clone());
        let next_start = update.start_date.unwrap_or(current.start_date);
        let next_end = update.end_date.unwrap_or(current.end_date);
        ActivityPeriod::new(next_start, next_end)
            .map_err(|_| ActivityRepositoryError::FieldLocked)?;

        let changed_name = next_name != current.name;
        let changed_location = next_location != current.location;
        let changed_currency = next_currency != current.base_currency;
        let changed_start = next_start != current.start_date;
        let changed_end = next_end != current.end_date;
        if changed_currency && current.has_accounting_records {
            return Err(ActivityRepositoryError::BaseCurrencyLocked);
        }
        if (changed_name && !capabilities.fields.name)
            || (changed_location && !capabilities.fields.location)
            || (changed_currency && !capabilities.fields.base_currency)
            || (changed_start && !capabilities.fields.start_date)
            || (changed_end && !capabilities.fields.end_date)
        {
            return Err(ActivityRepositoryError::FieldLocked);
        }
        if !changed_name && !changed_location && !changed_currency && !changed_start && !changed_end
        {
            transaction.commit().await.map_err(log_repository_error)?;
            return Ok(ActivityMutationResult {
                activity: current,
                warnings: Vec::new(),
            });
        }

        let details = serde_json::json!({
            "name": changed_name.then_some(serde_json::json!({"before": current.name, "after": next_name})),
            "location": changed_location.then_some(serde_json::json!({"before": current.location, "after": next_location})),
            "baseCurrency": changed_currency.then_some(serde_json::json!({"before": current.base_currency, "after": next_currency})),
            "startDate": changed_start.then_some(serde_json::json!({"before": current.start_date.to_string(), "after": next_start.to_string()})),
            "endDate": changed_end.then_some(serde_json::json!({"before": current.end_date.map(|value| value.to_string()), "after": next_end.map(|value| value.to_string())})),
        });
        let revision = sqlx::query_scalar::<_, i64>(
            "UPDATE activities SET name = $1, location = $2, base_currency = $3, \
             start_date = $4, end_date = $5, version = version + 1, revision = revision + 1, \
             updated_at = $6 WHERE id = $7 RETURNING revision",
        )
        .bind(&next_name)
        .bind(&next_location)
        .bind(&next_currency)
        .bind(next_start)
        .bind(next_end)
        .bind(update.now)
        .bind(update.activity_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query(
            "INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, \
             action, resource_type, resource_id, activity_revision, details, created_at) \
             VALUES ($1, $2, $3, $4, 'ACTIVITY_UPDATED', 'ACTIVITY', $2, $5, $6, $7)",
        )
        .bind(Uuid::new_v4())
        .bind(update.activity_id)
        .bind(update.actor_user_id)
        .bind(current.current_member_id)
        .bind(revision)
        .bind(details)
        .bind(update.now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let warnings = if changed_start
            && current
                .earliest_expense_date
                .is_some_and(|date| date < next_start)
        {
            vec!["EXPENSE_BEFORE_ACTIVITY_START".to_owned()]
        } else {
            Vec::new()
        };
        current.name = next_name;
        current.location = next_location;
        current.base_currency = next_currency;
        current.start_date = next_start;
        current.end_date = next_end;
        current.version += 1;
        current.revision = revision;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(ActivityMutationResult {
            activity: current,
            warnings,
        })
    }

    async fn transition(
        &self,
        transition: ActivityTransition,
    ) -> Result<ActivityView, ActivityRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let mut current = lock_activity(
            &mut transaction,
            transition.activity_id,
            transition.actor_user_id,
        )
        .await?;
        authorize_owner_version(&current, transition.expected_version)?;
        if current.deleted_at.is_some() {
            return Err(ActivityRepositoryError::InvalidTransition);
        }
        let status = ActivityStatus::parse(&current.status)
            .map_err(|_| ActivityRepositoryError::Unavailable)?;
        let next = status
            .transition(transition.action)
            .ok_or(ActivityRepositoryError::InvalidTransition)?;
        let revision = sqlx::query_scalar::<_, i64>(
            "UPDATE activities SET status = $1, version = version + 1, revision = revision + 1, \
             updated_at = $2 WHERE id = $3 RETURNING revision",
        )
        .bind(next.as_str())
        .bind(transition.now)
        .bind(transition.activity_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        insert_activity_audit(
            &mut transaction,
            &current,
            transition.actor_user_id,
            transition.action.audit_action(),
            revision,
            transition.now,
        )
        .await?;
        next.as_str().clone_into(&mut current.status);
        current.version += 1;
        current.revision = revision;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(current)
    }

    async fn delete(
        &self,
        deletion: ActivityDeletion,
    ) -> Result<ActivityView, ActivityRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let mut current = lock_activity(
            &mut transaction,
            deletion.activity_id,
            deletion.actor_user_id,
        )
        .await?;
        authorize_owner_version(&current, deletion.expected_version)?;
        if current.deleted_at.is_some() {
            return Err(ActivityRepositoryError::InvalidTransition);
        }
        let revision = sqlx::query_scalar::<_, i64>(
            "UPDATE activities SET deleted_at = $1, purge_after = $2, version = version + 1, \
             revision = revision + 1, updated_at = $1 WHERE id = $3 RETURNING revision",
        )
        .bind(deletion.deleted_at)
        .bind(deletion.purge_after)
        .bind(deletion.activity_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        insert_activity_audit(
            &mut transaction,
            &current,
            deletion.actor_user_id,
            "ACTIVITY_DELETED",
            revision,
            deletion.deleted_at,
        )
        .await?;
        current.deleted_at = Some(deletion.deleted_at);
        current.purge_after = Some(deletion.purge_after);
        current.version += 1;
        current.revision = revision;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(current)
    }

    async fn restore(
        &self,
        restoration: ActivityRestoration,
    ) -> Result<ActivityView, ActivityRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let mut current = lock_activity(
            &mut transaction,
            restoration.activity_id,
            restoration.actor_user_id,
        )
        .await?;
        authorize_owner_version(&current, restoration.expected_version)?;
        if current.deleted_at.is_none()
            || current
                .purge_after
                .is_none_or(|purge_after| restoration.now >= purge_after)
        {
            return Err(ActivityRepositoryError::RestoreExpired);
        }
        let revision = sqlx::query_scalar::<_, i64>(
            "UPDATE activities SET deleted_at = NULL, purge_after = NULL, \
             version = version + 1, revision = revision + 1, updated_at = $1 \
             WHERE id = $2 RETURNING revision",
        )
        .bind(restoration.now)
        .bind(restoration.activity_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        insert_activity_audit(
            &mut transaction,
            &current,
            restoration.actor_user_id,
            "ACTIVITY_RESTORED",
            revision,
            restoration.now,
        )
        .await?;
        current.deleted_at = None;
        current.purge_after = None;
        current.version += 1;
        current.revision = revision;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(current)
    }
}

fn authorize_owner_version(
    activity: &ActivityView,
    expected_version: i64,
) -> Result<(), ActivityRepositoryError> {
    if activity.current_member_role != "OWNER" {
        return Err(ActivityRepositoryError::Forbidden);
    }
    if activity.version != expected_version {
        return Err(ActivityRepositoryError::VersionConflict);
    }
    Ok(())
}

async fn insert_activity_audit(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    activity: &ActivityView,
    actor_user_id: Uuid,
    action: &'static str,
    revision: i64,
    now: OffsetDateTime,
) -> Result<(), ActivityRepositoryError> {
    sqlx::query(
        "INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, \
         action, resource_type, resource_id, activity_revision, created_at) \
         VALUES ($1, $2, $3, $4, $5, 'ACTIVITY', $2, $6, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(activity.activity_id)
    .bind(actor_user_id)
    .bind(activity.current_member_id)
    .bind(action)
    .bind(revision)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    Ok(())
}

async fn lock_activity(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<ActivityView, ActivityRepositoryError> {
    let row = sqlx::query_as::<_, ActivityRow>(
        "SELECT a.id, a.owner_member_id, a.name, a.location, a.base_currency, a.start_date, \
         a.end_date, a.status, a.version, a.revision, member.id, member.role, \
         a.deleted_at, a.purge_after, \
         (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
          OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)), \
         (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
          WHERE e.activity_id = a.id) FROM activities a \
         JOIN activity_members member ON member.activity_id = a.id \
         WHERE a.id = $1 AND member.user_id = $2 AND member.status = 'ACTIVE' FOR UPDATE OF a",
    )
    .bind(activity_id)
    .bind(actor_user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(log_read_error)?
    .ok_or(ActivityRepositoryError::NotFound)?;
    Ok(activity_from_row(row))
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
        location: row.3,
        base_currency: row.4.trim().to_owned(),
        start_date: row.5,
        end_date: row.6,
        status: row.7,
        version: row.8,
        revision: row.9,
        current_member_id: row.10,
        current_member_role: row.11,
        deleted_at: row.12,
        purge_after: row.13,
        has_accounting_records: row.14,
        earliest_expense_date: row.15,
    }
}
