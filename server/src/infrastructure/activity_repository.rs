use async_trait::async_trait;
use serde_json::Value;
use sqlx::PgPool;
use time::{Date, OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::{
    application::activity::{
        ActivityAuditChange, ActivityAuditEntry, ActivityAuditExpense, ActivityAuditPage,
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
    cover_preset: Option<i16>,
    cover_image_id: Option<Uuid>,
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

#[derive(sqlx::FromRow)]
struct ActivityAuditRow {
    id: Uuid,
    action: String,
    resource_type: String,
    resource_id: Uuid,
    actor_user_id: Option<Uuid>,
    actor_member_id: Option<Uuid>,
    actor_display_name: String,
    actor_avatar_preset: Option<i16>,
    actor_avatar_image_id: Option<Uuid>,
    activity_revision: i64,
    details: Value,
    created_at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct ActivityAuditCursorRow {
    created_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct PostgresActivityRepository {
    pool: PgPool,
}

/// 活动封面元数据；数据库只保存私有存储键，HTTP 层永远通过 `image_id` 授权读取。
#[derive(Clone, Debug)]
pub struct ActivityCoverImage {
    pub image_id: Uuid,
    pub storage_key: String,
    pub width: i32,
    pub height: i32,
    pub byte_size: i64,
}

impl PostgresActivityRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// 保存默认封面，并清除当前自定义图片。版本、Owner 和 ACTIVE 状态在行锁内校验。
    ///
    /// # Errors
    ///
    /// 当数据库不可用、活动不存在、版本冲突或操作者无权修改封面时返回错误。
    pub async fn set_cover_preset(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
        expected_version: i64,
        preset: i16,
        now: OffsetDateTime,
    ) -> Result<(ActivityView, Option<String>), ActivityRepositoryError> {
        if !(1..=12).contains(&preset) {
            return Err(ActivityRepositoryError::FieldLocked);
        }
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let mut current = lock_activity(&mut transaction, activity_id, actor_user_id).await?;
        authorize_cover_change(&current, expected_version)?;
        let old_storage_key = sqlx::query_scalar::<_, String>(
            "DELETE FROM activity_cover_images WHERE activity_id = $1 RETURNING storage_key",
        )
        .bind(activity_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let revision = sqlx::query_scalar::<_, i64>(
            "UPDATE activities SET cover_preset = $1, version = version + 1, revision = revision + 1, updated_at = $2 WHERE id = $3 RETURNING revision",
        )
        .bind(preset)
        .bind(now)
        .bind(activity_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let details = serde_json::json!({
            "coverPreset": {"before": current.cover_preset, "after": preset}
        });
        insert_activity_audit_details(
            &mut transaction,
            &current,
            actor_user_id,
            revision,
            details,
            now,
        )
        .await?;
        current.cover_preset = Some(preset);
        current.cover_image_id = None;
        current.version += 1;
        current.revision = revision;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok((current, old_storage_key))
    }

    /// 原子替换自定义封面元数据；调用方应在提交后删除返回的旧存储键。
    ///
    /// # Errors
    ///
    /// 当数据库不可用、活动不存在、版本冲突或操作者无权修改封面时返回错误。
    pub async fn replace_cover_image(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
        expected_version: i64,
        image: ActivityCoverImage,
        now: OffsetDateTime,
    ) -> Result<(ActivityView, Option<String>), ActivityRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let mut current = lock_activity(&mut transaction, activity_id, actor_user_id).await?;
        authorize_cover_change(&current, expected_version)?;
        let old_storage_key = sqlx::query_scalar::<_, String>(
            "SELECT storage_key FROM activity_cover_images WHERE activity_id = $1",
        )
        .bind(activity_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query(
            "INSERT INTO activity_cover_images (activity_id, image_id, storage_key, width, height, byte_size, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
             ON CONFLICT (activity_id) DO UPDATE SET image_id = EXCLUDED.image_id, storage_key = EXCLUDED.storage_key,
                 width = EXCLUDED.width, height = EXCLUDED.height, byte_size = EXCLUDED.byte_size, updated_at = EXCLUDED.updated_at",
        )
        .bind(activity_id)
        .bind(image.image_id)
        .bind(&image.storage_key)
        .bind(image.width)
        .bind(image.height)
        .bind(image.byte_size)
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let revision = sqlx::query_scalar::<_, i64>(
            "UPDATE activities SET version = version + 1, revision = revision + 1, updated_at = $1 WHERE id = $2 RETURNING revision",
        )
        .bind(now)
        .bind(activity_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let details = serde_json::json!({"cover": {"before": current.cover_image_id.map(|value| value.to_string()), "after": image.image_id.to_string()}});
        insert_activity_audit_details(
            &mut transaction,
            &current,
            actor_user_id,
            revision,
            details,
            now,
        )
        .await?;
        current.cover_image_id = Some(image.image_id);
        current.version += 1;
        current.revision = revision;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok((current, old_storage_key))
    }

    /// 只有活动成员能读取当前封面，且 `image_id` 必须仍是当前元数据。
    ///
    /// # Errors
    ///
    /// 当数据库不可用或封面不存在、已被替换、活动已删除时返回错误。
    pub async fn cover_image_for_user(
        &self,
        activity_id: Uuid,
        user_id: Uuid,
        image_id: Uuid,
    ) -> Result<ActivityCoverImage, ActivityRepositoryError> {
        sqlx::query_as::<_, ActivityCoverImageRow>(
            "SELECT cover.image_id, cover.storage_key, cover.width, cover.height, cover.byte_size
             FROM activity_cover_images cover
             JOIN activities activity ON activity.id = cover.activity_id
             JOIN activity_members member ON member.activity_id = activity.id
             WHERE cover.activity_id = $1 AND cover.image_id = $2 AND member.user_id = $3
               AND member.status = 'ACTIVE' AND activity.deleted_at IS NULL",
        )
        .bind(activity_id)
        .bind(image_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(log_read_error)?
        .map(ActivityCoverImage::from)
        .ok_or(ActivityRepositoryError::NotFound)
    }
}

#[derive(sqlx::FromRow)]
struct ActivityCoverImageRow {
    image_id: Uuid,
    storage_key: String,
    width: i32,
    height: i32,
    byte_size: i64,
}

impl From<ActivityCoverImageRow> for ActivityCoverImage {
    fn from(row: ActivityCoverImageRow) -> Self {
        Self {
            image_id: row.image_id,
            storage_key: row.storage_key,
            width: row.width,
            height: row.height,
            byte_size: row.byte_size,
        }
    }
}

fn authorize_cover_change(
    activity: &ActivityView,
    expected_version: i64,
) -> Result<(), ActivityRepositoryError> {
    if activity.current_member_role != "OWNER" {
        return Err(ActivityRepositoryError::Forbidden);
    }
    if activity.version != expected_version {
        return Err(ActivityRepositoryError::VersionConflict);
    }
    if activity.status != "ACTIVE" || activity.deleted_at.is_some() {
        return Err(ActivityRepositoryError::FieldLocked);
    }
    Ok(())
}

async fn insert_activity_audit_details(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    current: &ActivityView,
    actor_user_id: Uuid,
    revision: i64,
    details: Value,
    now: OffsetDateTime,
) -> Result<(), ActivityRepositoryError> {
    sqlx::query(
        "INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, actor_member_id,
         action, resource_type, resource_id, activity_revision, details, created_at)
         VALUES ($1, $2, $3, $4, 'ACTIVITY_UPDATED', 'ACTIVITY', $2, $5, $6, $7)",
    )
    .bind(Uuid::new_v4())
    .bind(current.activity_id)
    .bind(actor_user_id)
    .bind(current.current_member_id)
    .bind(revision)
    .bind(details)
    .bind(now)
    .execute(&mut **transaction)
    .await
    .map_err(log_repository_error)?;
    Ok(())
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
            "INSERT INTO activities (id, name, location, base_currency, start_date, end_date, cover_preset, \
             owner_member_id, created_by_user_id, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)",
        )
        .bind(activity.activity_id)
        .bind(&activity.name)
        .bind(&activity.location)
        .bind(&activity.base_currency)
        .bind(activity.start_date)
        .bind(activity.end_date)
        .bind(activity.cover_preset.or(Some(12)))
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
            cover_preset: activity.cover_preset.or(Some(12)),
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
             a.end_date, a.cover_preset, cover.image_id AS cover_image_id, a.status, a.version, a.revision, member.id AS current_member_id, member.role AS current_member_role, \
             a.deleted_at, a.purge_after, \
             (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
              OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)) AS has_accounting_records, \
             (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
              WHERE e.activity_id = a.id) AS earliest_expense_date, a.invite_mode FROM activities a \
             LEFT JOIN activity_cover_images cover ON cover.activity_id = a.id \
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
             a.end_date, a.cover_preset, cover.image_id AS cover_image_id, a.status, a.version, a.revision, member.id AS current_member_id, member.role AS current_member_role, \
             a.deleted_at, a.purge_after, \
             (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
              OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)) AS has_accounting_records, \
             (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
              WHERE e.activity_id = a.id) AS earliest_expense_date, a.invite_mode FROM activities a \
             LEFT JOIN activity_cover_images cover ON cover.activity_id = a.id \
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
             a.end_date, a.cover_preset, cover.image_id AS cover_image_id, a.status, a.version, a.revision, member.id AS current_member_id, member.role AS current_member_role, \
             a.deleted_at, a.purge_after, \
             (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
              OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)) AS has_accounting_records, \
             (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
              WHERE e.activity_id = a.id) AS earliest_expense_date, a.invite_mode FROM activities a \
             LEFT JOIN activity_cover_images cover ON cover.activity_id = a.id \
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
            (
                Uuid,
                Option<Uuid>,
                String,
                String,
                String,
                i64,
                Option<i16>,
                Option<Uuid>,
            ),
        >(
            "SELECT member.id, member.user_id, member.display_name, member.role, member.status, \
             member.version, users.avatar_preset, avatar.image_id FROM activity_members member \
             LEFT JOIN users ON users.id = member.user_id \
             LEFT JOIN user_avatar_images avatar ON avatar.user_id = member.user_id \
             WHERE member.activity_id = $1 \
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
                    avatar_image_id,
                )| {
                    ActivityMemberView {
                        member_id,
                        activity_id,
                        user_id: member_user_id,
                        display_name,
                        avatar_preset,
                        avatar_image_id,
                        role,
                        status,
                        version,
                    }
                },
            )
            .collect())
    }

    async fn list_audit_logs(
        &self,
        activity_id: Uuid,
        user_id: Uuid,
        cursor: Option<Uuid>,
    ) -> Result<ActivityAuditPage, ActivityRepositoryError> {
        const PAGE_SIZE: i64 = 30;

        let visible = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
                 SELECT 1 FROM activities activity
                 JOIN activity_members viewer ON viewer.activity_id = activity.id
                 WHERE activity.id = $1 AND activity.deleted_at IS NULL
                   AND viewer.user_id = $2 AND viewer.status = 'ACTIVE'
             )",
        )
        .bind(activity_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await
        .map_err(log_read_error)?;
        if !visible {
            return Err(ActivityRepositoryError::NotFound);
        }

        let boundary = if let Some(cursor_id) = cursor {
            Some(
                sqlx::query_as::<_, ActivityAuditCursorRow>(
                    "SELECT created_at FROM activity_audit_logs
                     WHERE id = $1 AND activity_id = $2",
                )
                .bind(cursor_id)
                .bind(activity_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(log_read_error)?
                .ok_or(ActivityRepositoryError::InvalidAuditCursor)?,
            )
        } else {
            None
        };

        let rows = sqlx::query_as::<_, ActivityAuditRow>(
            "SELECT log.id, log.action, log.resource_type, log.resource_id,
                    log.actor_user_id, log.actor_member_id,
                    COALESCE(actor_member.display_name, actor_user.display_name, '系统') AS actor_display_name,
                    actor_user.avatar_preset AS actor_avatar_preset,
                    actor_avatar.image_id AS actor_avatar_image_id,
                    log.activity_revision, log.details, log.created_at
             FROM activity_audit_logs log
             JOIN activities activity ON activity.id = log.activity_id
             LEFT JOIN activity_members actor_member
               ON actor_member.id = log.actor_member_id
              AND actor_member.activity_id = log.activity_id
             LEFT JOIN users actor_user
               ON actor_user.id = COALESCE(log.actor_user_id, actor_member.user_id)
             LEFT JOIN user_avatar_images actor_avatar
               ON actor_avatar.user_id = actor_user.id
             WHERE log.activity_id = $1 AND activity.deleted_at IS NULL
               AND ($2::timestamptz IS NULL
                    OR log.created_at < $2
                    OR (log.created_at = $2 AND log.id > $3))
             ORDER BY log.created_at DESC, log.id ASC
             LIMIT $4",
        )
        .bind(activity_id)
        .bind(boundary.as_ref().map(|value| value.created_at))
        .bind(cursor)
        .bind(PAGE_SIZE + 1)
        .fetch_all(&self.pool)
        .await
        .map_err(log_read_error)?;

        let mut entries = rows
            .into_iter()
            .map(activity_audit_from_row)
            .collect::<Vec<_>>();
        let page_size = usize::try_from(PAGE_SIZE).expect("活动记录页大小应可转换为 usize");
        let next_cursor = if entries.len() > page_size {
            entries.pop().map(|entry| entry.id)
        } else {
            None
        };
        Ok(ActivityAuditPage {
            entries,
            next_cursor,
        })
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
         a.end_date, a.cover_preset, cover.image_id AS cover_image_id, a.status, a.version, a.revision, member.id AS current_member_id, member.role AS current_member_role, \
         a.deleted_at, a.purge_after, \
         (EXISTS(SELECT 1 FROM expenses e WHERE e.activity_id = a.id) \
          OR EXISTS(SELECT 1 FROM settlements s WHERE s.activity_id = a.id)) AS has_accounting_records, \
         (SELECT min((e.occurred_at AT TIME ZONE 'UTC')::date) FROM expenses e \
          WHERE e.activity_id = a.id) AS earliest_expense_date, a.invite_mode FROM activities a \
         LEFT JOIN activity_cover_images cover ON cover.activity_id = a.id \
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

fn activity_audit_from_row(row: ActivityAuditRow) -> ActivityAuditEntry {
    let expense = activity_audit_expense(
        &row.action,
        &row.resource_type,
        row.resource_id,
        &row.details,
    );
    ActivityAuditEntry {
        id: row.id,
        action: row.action,
        source: activity_audit_source(&row.details),
        actor_user_id: row.actor_user_id,
        actor_member_id: row.actor_member_id,
        actor_display_name: row.actor_display_name,
        actor_avatar_preset: row.actor_avatar_preset,
        actor_avatar_image_id: row.actor_avatar_image_id,
        revision: row.activity_revision,
        changes: activity_audit_changes(&row.details),
        expense,
        created_at: row.created_at,
    }
}

/// 来源只允许当前已定义的 MCP 标识，未知值和任意 JSON 字段一律不向客户端透传。
fn activity_audit_source(details: &Value) -> Option<String> {
    matches!(details.get("source").and_then(Value::as_str), Some("MCP")).then(|| "MCP".to_owned())
}

/// 只读取账单审计详情的固定字段；历史脏数据或未知结构直接忽略，不能把任意 JSON 送到客户端。
fn activity_audit_expense(
    action: &str,
    resource_type: &str,
    resource_id: Uuid,
    details: &Value,
) -> Option<ActivityAuditExpense> {
    if resource_type != "EXPENSE" || !matches!(action, "EXPENSE_CREATED" | "EXPENSE_UPDATED") {
        return None;
    }
    let expense = details.get("expense")?.as_object()?;
    let title = audit_text(expense.get("title"), 120)?;
    let category = audit_text(expense.get("category"), 64)?;
    let original_currency = audit_text(expense.get("originalCurrency"), 3)?;
    if !original_currency
        .chars()
        .all(|value| value.is_ascii_uppercase())
    {
        return None;
    }
    let original_amount_minor = audit_integer(expense.get("originalAmountMinor"))?;
    if original_amount_minor <= 0 {
        return None;
    }
    let occurred_at = audit_text(expense.get("occurredAt"), 64)
        .and_then(|value| OffsetDateTime::parse(&value, &Rfc3339).ok())?;
    Some(ActivityAuditExpense {
        expense_id: resource_id,
        title,
        category,
        original_currency,
        original_amount_minor,
        occurred_at,
    })
}

fn audit_text(value: Option<&Value>, max_chars: usize) -> Option<String> {
    let value = value?.as_str()?.trim();
    (!value.is_empty() && value.chars().count() <= max_chars).then(|| value.to_owned())
}

fn audit_integer(value: Option<&Value>) -> Option<i64> {
    match value? {
        Value::String(value) => value.parse().ok(),
        Value::Number(value) => value.as_i64(),
        _ => None,
    }
}

fn activity_audit_changes(details: &Value) -> Vec<ActivityAuditChange> {
    let mut changes = Vec::new();
    if let Some(fields) = details.as_object() {
        append_audit_changes(
            fields,
            &[
                "name",
                "location",
                "baseCurrency",
                "startDate",
                "endDate",
                "inviteMode",
                "coverPreset",
                "cover",
            ],
            &mut changes,
        );
    }
    if let Some(fields) = details.get("expenseChanges").and_then(Value::as_object) {
        append_audit_changes(
            fields,
            &[
                "title",
                "category",
                "note",
                "originalCurrency",
                "originalAmountMinor",
                "occurredAt",
                "splitMode",
            ],
            &mut changes,
        );
    }
    changes
}

fn append_audit_changes(
    fields: &serde_json::Map<String, Value>,
    allowed_fields: &[&str],
    changes: &mut Vec<ActivityAuditChange>,
) {
    for field in allowed_fields {
        let Some(change) = fields.get(*field).and_then(Value::as_object) else {
            continue;
        };
        let before_value = audit_detail_value(change.get("before"));
        let after_value = audit_detail_value(change.get("after"));
        if before_value.is_none() && after_value.is_none() {
            continue;
        }
        changes.push(ActivityAuditChange {
            field: (*field).to_owned(),
            before_value,
            after_value,
        });
    }
}

fn audit_detail_value(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) if !value.is_empty() => Some(value.clone()),
        Value::Bool(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
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
        cover_preset: row.cover_preset,
        cover_image_id: row.cover_image_id,
        invite_mode: row.invite_mode,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn expense_audit_summary_reads_only_the_whitelisted_shape() {
        let expense_id = Uuid::new_v4();
        let details = json!({
            "expense": {
                "title": "西湖午餐",
                "category": "餐饮",
                "originalCurrency": "CNY",
                "originalAmountMinor": "12800",
                "occurredAt": "2026-09-21T07:30:00Z",
                "note": "不应透传",
            },
            "unknown": {"after": "不应透传"},
        });

        let summary = activity_audit_expense("EXPENSE_CREATED", "EXPENSE", expense_id, &details)
            .expect("合法账单摘要应可读取");
        assert_eq!(summary.expense_id, expense_id);
        assert_eq!(summary.title, "西湖午餐");
        assert_eq!(summary.original_amount_minor, 12800);

        let changes = activity_audit_changes(&json!({
            "expenseChanges": {
                "title": {"before": "杭州午餐", "after": "西湖午餐"},
                "unknown": {"before": "不应透传", "after": "仍不应透传"},
            },
        }));
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].field, "title");
        assert_eq!(changes[0].before_value.as_deref(), Some("杭州午餐"));
        assert_eq!(changes[0].after_value.as_deref(), Some("西湖午餐"));

        assert_eq!(
            activity_audit_source(&json!({"source": "MCP"})).as_deref(),
            Some("MCP")
        );
        assert!(activity_audit_source(&json!({"source": "other"})).is_none());
    }

    #[test]
    fn malformed_expense_audit_details_are_ignored() {
        let expense_id = Uuid::new_v4();
        let details = json!({
            "expense": {
                "title": "账单",
                "category": "餐饮",
                "originalCurrency": "cny",
                "originalAmountMinor": "not-a-number",
                "occurredAt": "not-a-time",
            },
        });

        assert!(
            activity_audit_expense("EXPENSE_CREATED", "EXPENSE", expense_id, &details).is_none()
        );
    }
}
