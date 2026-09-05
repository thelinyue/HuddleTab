use async_trait::async_trait;
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::{
    application::activity::{
        ActivityDeletion, ActivityMemberView, ActivityMutationResult, ActivityOwnershipTransfer,
        ActivityRepository, ActivityRepositoryError, ActivityRestoration, ActivityTransition,
        ActivityUpdate, ActivityView, CreatedActivity, NewActivity,
    },
    domain::activity::{ActivityCapabilities, ActivityPeriod, ActivityStatus},
};

#[derive(sqlx::FromRow)]
struct ActivityRow {
    activity_id: Uuid,
    owner_member_id: Uuid,
    name: String,
    location: Option<String>,
    base_currency: String,
    start_date: Date,
    end_date: Option<Date>,
    status: String,
    version: i64,
    revision: i64,
    current_member_id: Uuid,
    current_member_role: String,
    deleted_at: Option<OffsetDateTime>,
    purge_after: Option<OffsetDateTime>,
    has_accounting_records: bool,
    earliest_expense_date: Option<Date>,
    invite_mode: String,
}

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
            invite_mode: "DIRECT_JOIN".to_owned(),
            version: 1,
            revision: 1,
        })
    }

    async fn list_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ActivityView>, ActivityRepositoryError> {
        let rows = sqlx::query_as::<_, ActivityRow>(
            "SELECT a.id AS activity_id, a.owner_member_id, a.name, a.location, a.base_currency, a.start_date, \
             a.end_date, a.status, a.version, a.revision, member.id AS current_member_id, member.role AS current_member_role, \
             a.deleted_at, a.purge_after, \
             (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
              OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)) AS has_accounting_records, \
             (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
              WHERE e.activity_id = a.id) AS earliest_expense_date, a.invite_mode FROM activities a \
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
            "SELECT a.id AS activity_id, a.owner_member_id, a.name, a.location, a.base_currency, a.start_date, \
             a.end_date, a.status, a.version, a.revision, member.id AS current_member_id, member.role AS current_member_role, \
             a.deleted_at, a.purge_after, \
             (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
              OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)) AS has_accounting_records, \
             (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
              WHERE e.activity_id = a.id) AS earliest_expense_date, a.invite_mode FROM activities a \
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
            "SELECT a.id AS activity_id, a.owner_member_id, a.name, a.location, a.base_currency, a.start_date, \
             a.end_date, a.status, a.version, a.revision, member.id AS current_member_id, member.role AS current_member_role, \
             a.deleted_at, a.purge_after, \
             (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
              OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)) AS has_accounting_records, \
             (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
              WHERE e.activity_id = a.id) AS earliest_expense_date, a.invite_mode FROM activities a \
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
        let rows = sqlx::query_as::<
            _,
            (Uuid, Option<Uuid>, String, String, String, i64, Option<i16>),
        >(
            "SELECT member.id, member.user_id, member.display_name, member.role, member.status, \
             member.version, users.avatar_preset FROM activity_members member \
             LEFT JOIN users ON users.id = member.user_id WHERE member.activity_id = $1 \
             ORDER BY CASE member.role WHEN 'OWNER' THEN 0 ELSE 1 END, member.joined_at, member.id",
        )
        .bind(activity_id)
        .fetch_all(&self.pool)
        .await
        .map_err(log_read_error)?;
        Ok(rows
            .into_iter()
            .map(
                |(
                    member_id,
                    member_user_id,
                    display_name,
                    role,
                    status,
                    version,
                    avatar_preset,
                )| {
                    ActivityMemberView {
                        member_id,
                        activity_id,
                        user_id: member_user_id,
                        display_name,
                        avatar_preset,
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
        let next_invite_mode = update
            .invite_mode
            .unwrap_or_else(|| current.invite_mode.clone());
        ActivityPeriod::new(next_start, next_end)
            .map_err(|_| ActivityRepositoryError::FieldLocked)?;

        let changed_name = next_name != current.name;
        let changed_location = next_location != current.location;
        let changed_currency = next_currency != current.base_currency;
        let changed_start = next_start != current.start_date;
        let changed_end = next_end != current.end_date;
        let changed_invite_mode = next_invite_mode != current.invite_mode;
        if changed_currency && current.has_accounting_records {
            return Err(ActivityRepositoryError::BaseCurrencyLocked);
        }
        if (changed_name && !capabilities.fields.name)
            || (changed_location && !capabilities.fields.location)
            || (changed_currency && !capabilities.fields.base_currency)
            || (changed_start && !capabilities.fields.start_date)
            || (changed_end && !capabilities.fields.end_date)
            || (changed_invite_mode && !capabilities.fields.invite_mode)
        {
            return Err(ActivityRepositoryError::FieldLocked);
        }
        if !changed_name
            && !changed_location
            && !changed_currency
            && !changed_start
            && !changed_end
            && !changed_invite_mode
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
            "inviteMode": changed_invite_mode.then_some(serde_json::json!({"before": current.invite_mode, "after": next_invite_mode})),
        });
        let revision = sqlx::query_scalar::<_, i64>(
            "UPDATE activities SET name = $1, location = $2, base_currency = $3, \
             start_date = $4, end_date = $5, invite_mode = $6, version = version + 1, \
             revision = revision + 1, updated_at = $7 WHERE id = $8 RETURNING revision",
        )
        .bind(&next_name)
        .bind(&next_location)
        .bind(&next_currency)
        .bind(next_start)
        .bind(next_end)
        .bind(&next_invite_mode)
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
        current.invite_mode = next_invite_mode;
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
        notify_activity_members(
            &mut transaction,
            &current,
            transition.actor_user_id,
            next.as_str(),
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
        notify_activity_members(
            &mut transaction,
            &current,
            deletion.actor_user_id,
            "DELETED",
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
        notify_activity_members(
            &mut transaction,
            &current,
            restoration.actor_user_id,
            "RESTORED",
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

    async fn transfer_ownership(
        &self,
        transfer: ActivityOwnershipTransfer,
    ) -> Result<ActivityView, ActivityRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let mut current = lock_activity(
            &mut transaction,
            transfer.activity_id,
            transfer.actor_user_id,
        )
        .await?;
        // 转让竞争中旧 Owner 会被降级；先比较版本，确保并发败方稳定返回 VERSION_CONFLICT。
        if current.version != transfer.expected_version {
            return Err(ActivityRepositoryError::VersionConflict);
        }
        if current.current_member_role != "OWNER" {
            return Err(ActivityRepositoryError::Forbidden);
        }
        if current.deleted_at.is_some() {
            return Err(ActivityRepositoryError::InvalidTransition);
        }
        if transfer.new_owner_member_id == current.owner_member_id {
            return Err(ActivityRepositoryError::FieldLocked);
        }

        // Activity 行先锁定，再按 member UUID 排序锁定双方，避免并发转让产生循环等待。
        let mut member_ids = [current.owner_member_id, transfer.new_owner_member_id];
        member_ids.sort_unstable();
        sqlx::query("SELECT id FROM activity_members WHERE id = ANY($1) ORDER BY id FOR UPDATE")
            .bind(member_ids.as_slice())
            .fetch_all(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
        let new_owner = sqlx::query_as::<_, (Uuid, String)>(
            "SELECT user_id, display_name FROM activity_members
             WHERE id = $1 AND activity_id = $2 AND status = 'ACTIVE'
               AND user_id IS NOT NULL AND role = 'MEMBER'",
        )
        .bind(transfer.new_owner_member_id)
        .bind(transfer.activity_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(ActivityRepositoryError::FieldLocked)?;

        sqlx::query(
            "UPDATE activity_members SET role = 'MEMBER', version = version + 1 WHERE id = $1",
        )
        .bind(current.owner_member_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query(
            "UPDATE activity_members SET role = 'OWNER', version = version + 1 WHERE id = $1",
        )
        .bind(transfer.new_owner_member_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let revision = sqlx::query_scalar::<_, i64>(
            "UPDATE activities SET owner_member_id = $1, version = version + 1,
             revision = revision + 1, updated_at = $2 WHERE id = $3 RETURNING revision",
        )
        .bind(transfer.new_owner_member_id)
        .bind(transfer.now)
        .bind(transfer.activity_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        insert_activity_audit(
            &mut transaction,
            &current,
            transfer.actor_user_id,
            "OWNER_TRANSFERRED",
            revision,
            transfer.now,
        )
        .await?;
        sqlx::query(
            "INSERT INTO notifications (
                id, recipient_user_id, type, target_type, target_id, activity_id, payload, created_at
             ) VALUES ($1, $2, 'OWNERSHIP_CHANGED', 'ACTIVITY', $3, $3,
                jsonb_build_object('activityName', $4::text, 'displayName', $5::text), $6)",
        )
        .bind(Uuid::new_v4())
        .bind(new_owner.0)
        .bind(transfer.activity_id)
        .bind(&current.name)
        .bind(&new_owner.1)
        .bind(transfer.now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;

        current.owner_member_id = transfer.new_owner_member_id;
        "MEMBER".clone_into(&mut current.current_member_role);
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

async fn notify_activity_members(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    activity: &ActivityView,
    actor_user_id: Uuid,
    status: &str,
    now: OffsetDateTime,
) -> Result<(), ActivityRepositoryError> {
    let recipients = sqlx::query_scalar::<_, Uuid>(
        "SELECT DISTINCT user_id FROM activity_members
         WHERE activity_id = $1 AND status = 'ACTIVE' AND user_id IS NOT NULL AND user_id <> $2",
    )
    .bind(activity.activity_id)
    .bind(actor_user_id)
    .fetch_all(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    for recipient in recipients {
        sqlx::query(
            "INSERT INTO notifications (
                id, recipient_user_id, type, target_type, target_id, activity_id, payload, created_at
             ) VALUES ($1, $2, 'ACTIVITY_STATUS_CHANGED', 'ACTIVITY', $3, $3,
                jsonb_build_object('activityName', $4::text, 'status', $5::text), $6)",
        )
        .bind(Uuid::new_v4())
        .bind(recipient)
        .bind(activity.activity_id)
        .bind(&activity.name)
        .bind(status)
        .bind(now)
        .execute(&mut **transaction)
        .await
        .map_err(log_repository_error)?;
    }
    Ok(())
}

async fn lock_activity(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<ActivityView, ActivityRepositoryError> {
    let row = sqlx::query_as::<_, ActivityRow>(
        "SELECT a.id AS activity_id, a.owner_member_id, a.name, a.location, a.base_currency, a.start_date, \
         a.end_date, a.status, a.version, a.revision, member.id AS current_member_id, member.role AS current_member_role, \
         a.deleted_at, a.purge_after, \
         (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
          OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)) AS has_accounting_records, \
         (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
          WHERE e.activity_id = a.id) AS earliest_expense_date, a.invite_mode FROM activities a \
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
        activity_id: row.activity_id,
        owner_member_id: row.owner_member_id,
        name: row.name,
        location: row.location,
        base_currency: row.base_currency.trim().to_owned(),
        start_date: row.start_date,
        end_date: row.end_date,
        status: row.status,
        version: row.version,
        revision: row.revision,
        current_member_id: row.current_member_id,
        current_member_role: row.current_member_role,
        deleted_at: row.deleted_at,
        purge_after: row.purge_after,
        has_accounting_records: row.has_accounting_records,
        earliest_expense_date: row.earliest_expense_date,
        invite_mode: row.invite_mode,
    }
}
