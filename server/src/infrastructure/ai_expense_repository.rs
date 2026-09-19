//! AI 设置和草稿所需活动上下文的 `PostgreSQL` 实现。
//!
//! 这里不保存草稿；文字识别请求只读取活动成员和系统配置，最终 Expense 仍走既有接口。

use async_trait::async_trait;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::ai_expense::{
    AiActivityContext, AiActivityMember, AiExpenseRepository, AiRepositoryError, AiSettings,
    AiSettingsWrite,
};

#[derive(Clone, Debug)]
pub struct PostgresAiExpenseRepository {
    pool: PgPool,
}

impl PostgresAiExpenseRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AiExpenseRepository for PostgresAiExpenseRepository {
    async fn get_settings(&self) -> Result<AiSettings, AiRepositoryError> {
        sqlx::query_as::<
            _,
            (
                bool,
                Option<String>,
                Option<String>,
                bool,
                i32,
                bool,
                i32,
                Option<String>,
                Option<Vec<u8>>,
                i64,
            ),
        >(
            "SELECT ai_expense_draft_enabled, ai_provider_base_url, ai_provider_model, \
             ai_provider_json_mode, ai_provider_timeout_seconds, ai_image_enabled, \
             ai_provider_max_image_bytes, ai_provider_image_model, ai_provider_api_key_envelope, version \
             FROM system_settings WHERE id = 'singleton'",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| log_error(&error))?
        .map(|row| AiSettings {
            enabled: row.0,
            base_url: row.1,
            model: row.2,
            json_mode: row.3,
            timeout_seconds: row.4,
            image_enabled: row.5,
            max_image_bytes: row.6,
            image_model: row.7,
            api_key_envelope: row.8,
            version: row.9,
        })
        .ok_or(AiRepositoryError::Unavailable)
    }

    async fn update_settings(
        &self,
        actor_user_id: Uuid,
        expected_version: i64,
        write: AiSettingsWrite,
        now: OffsetDateTime,
    ) -> Result<AiSettings, AiRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(|error| log_error(&error))?;
        let row = sqlx::query_as::<_, (bool, Option<String>, Option<String>, bool, i32, bool, i32, Option<String>, Option<Vec<u8>>, i64)>(
            "UPDATE system_settings SET ai_expense_draft_enabled = $1, ai_provider_base_url = $2, \
             ai_provider_model = $3, ai_provider_json_mode = $4, ai_provider_timeout_seconds = $5, \
             ai_image_enabled = $6, ai_provider_max_image_bytes = $7, ai_provider_image_model = $8, \
             ai_provider_api_key_envelope = $9, version = version + 1, updated_at = $10, updated_by_user_id = $11 \
             WHERE id = 'singleton' AND version = $12 \
             RETURNING ai_expense_draft_enabled, ai_provider_base_url, ai_provider_model, \
             ai_provider_json_mode, ai_provider_timeout_seconds, ai_image_enabled, \
             ai_provider_max_image_bytes, ai_provider_image_model, ai_provider_api_key_envelope, version",
        )
        .bind(write.enabled)
        .bind(&write.base_url)
        .bind(&write.model)
        .bind(write.json_mode)
        .bind(write.timeout_seconds)
        .bind(write.image_enabled)
        .bind(write.max_image_bytes)
        .bind(&write.image_model)
        .bind(&write.api_key_envelope)
        .bind(now)
        .bind(actor_user_id)
        .bind(expected_version)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|error| log_error(&error))?
        .ok_or(AiRepositoryError::VersionConflict)?;

        if !write.changed_fields.is_empty() || write.secret_action.is_some() {
            sqlx::query(
                "INSERT INTO system_admin_audit_logs \
                 (id, actor_user_id, event_type, resource_type, resource_key, changed_fields, secret_action, created_at) \
                 VALUES ($1, $2, 'AI_EXPENSE_DRAFT_SETTINGS_UPDATED', 'SYSTEM_SETTINGS', 'singleton', $3, $4, $5)",
            )
            .bind(Uuid::new_v4())
            .bind(actor_user_id)
            .bind(&write.changed_fields)
            .bind(&write.secret_action)
            .bind(now)
            .execute(&mut *transaction)
            .await
            .map_err(|error| log_error(&error))?;
        }
        transaction
            .commit()
            .await
            .map_err(|error| log_error(&error))?;
        Ok(AiSettings {
            enabled: row.0,
            base_url: row.1,
            model: row.2,
            json_mode: row.3,
            timeout_seconds: row.4,
            image_enabled: row.5,
            max_image_bytes: row.6,
            image_model: row.7,
            api_key_envelope: row.8,
            version: row.9,
        })
    }

    async fn activity_context(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<AiActivityContext, AiRepositoryError> {
        let activity = sqlx::query_as::<_, (String, Uuid, String)>(
            "SELECT a.base_currency, actor.id, actor.display_name FROM activities a \
             JOIN activity_members actor ON actor.activity_id = a.id \
             WHERE a.id = $1 AND a.status = 'ACTIVE' AND a.deleted_at IS NULL \
             AND actor.user_id = $2 AND actor.status = 'ACTIVE'",
        )
        .bind(activity_id)
        .bind(actor_user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| log_error(&error))?
        .ok_or(AiRepositoryError::Forbidden)?;
        let members = sqlx::query_as::<_, (Uuid, String)>(
            "SELECT id, display_name FROM activity_members WHERE activity_id = $1 AND status = 'ACTIVE' \
             ORDER BY CASE role WHEN 'OWNER' THEN 0 ELSE 1 END, joined_at, id",
        )
        .bind(activity_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|error| log_error(&error))?;
        Ok(AiActivityContext {
            base_currency: activity.0,
            actor_member_id: activity.1,
            actor_display_name: activity.2,
            members: members
                .into_iter()
                .map(|(member_id, display_name)| AiActivityMember {
                    member_id,
                    display_name,
                })
                .collect(),
        })
    }
}

fn log_error(error: &sqlx::Error) -> AiRepositoryError {
    tracing::error!(error = %error, "AI 设置或活动成员数据库操作失败");
    AiRepositoryError::Unavailable
}
