use async_trait::async_trait;
use sqlx::{FromRow, PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::settlement::{
    ActivitySettlementContext, CreatedSettlement, NewSettlement, SettlementRecord,
    SettlementRepository, SettlementRepositoryError, SettlementUpdate, SettlementVoid,
};

#[derive(Clone, Debug)]
pub struct PostgresSettlementRepository {
    pool: PgPool,
}

impl PostgresSettlementRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[derive(FromRow)]
struct SettlementRow {
    id: Uuid,
    activity_id: Uuid,
    created_by_user_id: Uuid,
    client_mutation_id: Uuid,
    payer_member_id: Uuid,
    receiver_member_id: Uuid,
    currency: String,
    amount_minor: i64,
    status: String,
    version: i64,
    revision: i64,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    voided_at: Option<OffsetDateTime>,
}

#[async_trait]
impl SettlementRepository for PostgresSettlementRepository {
    async fn activity_context(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<ActivitySettlementContext, SettlementRepositoryError> {
        sqlx::query_as::<_, (String, Uuid, String)>(
            "SELECT a.base_currency, m.id, m.role FROM activities a \
             JOIN activity_members m ON m.activity_id = a.id \
             WHERE a.id = $1 AND a.status IN ('ACTIVE', 'ENDED') AND a.deleted_at IS NULL \
             AND m.user_id = $2 AND m.status = 'ACTIVE'",
        )
        .bind(activity_id)
        .bind(actor_user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(log_repository_error)?
        .as_ref()
        .map(context_from_row)
        .ok_or(SettlementRepositoryError::Forbidden)
    }

    async fn create(
        &self,
        settlement: NewSettlement,
    ) -> Result<CreatedSettlement, SettlementRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let context = lock_context(
            &mut transaction,
            settlement.activity_id,
            settlement.actor_user_id,
        )
        .await?;
        if context.actor_member_id != settlement.actor_member_id
            || context.base_currency != settlement.currency
        {
            return Err(SettlementRepositoryError::Forbidden);
        }
        if let Some((id, activity_id)) = sqlx::query_as::<_, (Uuid, Uuid)>(
            "SELECT id, activity_id FROM settlements \
             WHERE created_by_user_id = $1 AND client_mutation_id = $2 FOR UPDATE",
        )
        .bind(settlement.actor_user_id)
        .bind(settlement.client_mutation_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        {
            if activity_id != settlement.activity_id {
                return Err(SettlementRepositoryError::MutationConflict);
            }
            let record = load(&mut transaction, id).await?;
            transaction.commit().await.map_err(log_repository_error)?;
            return Ok(CreatedSettlement {
                settlement: record,
                idempotent_replay: true,
            });
        }
        require_members(
            &mut transaction,
            settlement.activity_id,
            settlement.payer_member_id,
            settlement.receiver_member_id,
        )
        .await?;
        sqlx::query(
            "INSERT INTO settlements (id, activity_id, created_by_user_id, client_mutation_id, \
             payer_member_id, receiver_member_id, currency, amount_minor, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)",
        )
        .bind(settlement.id)
        .bind(settlement.activity_id)
        .bind(settlement.actor_user_id)
        .bind(settlement.client_mutation_id)
        .bind(settlement.payer_member_id)
        .bind(settlement.receiver_member_id)
        .bind(&settlement.currency)
        .bind(settlement.amount_minor)
        .bind(settlement.now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        revise_and_audit(
            &mut transaction,
            SettlementAudit {
                activity_id: settlement.activity_id,
                actor_user_id: settlement.actor_user_id,
                actor_member_id: settlement.actor_member_id,
                action: "SETTLEMENT_CREATED",
                settlement_id: settlement.id,
                now: settlement.now,
            },
        )
        .await?;
        let record = load(&mut transaction, settlement.id).await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(CreatedSettlement {
            settlement: record,
            idempotent_replay: false,
        })
    }

    async fn list(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Vec<SettlementRecord>, SettlementRepositoryError> {
        authorize_read(&self.pool, activity_id, actor_user_id).await?;
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM settlements WHERE activity_id = $1 ORDER BY created_at DESC, id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let mut records = Vec::with_capacity(ids.len());
        for id in ids {
            records.push(load(&mut transaction, id).await?);
        }
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(records)
    }

    async fn get(
        &self,
        activity_id: Uuid,
        settlement_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<SettlementRecord, SettlementRepositoryError> {
        authorize_read(&self.pool, activity_id, actor_user_id).await?;
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let record = load(&mut transaction, settlement_id).await?;
        if record.activity_id != activity_id {
            return Err(SettlementRepositoryError::NotFound);
        }
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(record)
    }

    async fn update(
        &self,
        settlement: SettlementUpdate,
    ) -> Result<SettlementRecord, SettlementRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let context = lock_context(
            &mut transaction,
            settlement.activity_id,
            settlement.actor_user_id,
        )
        .await?;
        if context.actor_member_id != settlement.actor_member_id {
            return Err(SettlementRepositoryError::Forbidden);
        }
        let current = lock_settlement(
            &mut transaction,
            settlement.activity_id,
            settlement.settlement_id,
        )
        .await?;
        authorize_mutation(
            &current,
            settlement.actor_user_id,
            settlement.actor_is_owner,
            settlement.expected_version,
        )?;
        require_members(
            &mut transaction,
            settlement.activity_id,
            settlement.payer_member_id,
            settlement.receiver_member_id,
        )
        .await?;
        if current.payer_member_id == settlement.payer_member_id
            && current.receiver_member_id == settlement.receiver_member_id
            && current.amount_minor == settlement.amount_minor
        {
            transaction.commit().await.map_err(log_repository_error)?;
            return Ok(current);
        }
        sqlx::query(
            "UPDATE settlements SET payer_member_id = $1, receiver_member_id = $2, \
             amount_minor = $3, version = version + 1, updated_at = $4 WHERE id = $5",
        )
        .bind(settlement.payer_member_id)
        .bind(settlement.receiver_member_id)
        .bind(settlement.amount_minor)
        .bind(settlement.now)
        .bind(settlement.settlement_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        revise_and_audit(
            &mut transaction,
            SettlementAudit {
                activity_id: settlement.activity_id,
                actor_user_id: settlement.actor_user_id,
                actor_member_id: settlement.actor_member_id,
                action: "SETTLEMENT_UPDATED",
                settlement_id: settlement.settlement_id,
                now: settlement.now,
            },
        )
        .await?;
        let record = load(&mut transaction, settlement.settlement_id).await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(record)
    }

    async fn void(
        &self,
        settlement: SettlementVoid,
    ) -> Result<SettlementRecord, SettlementRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let context = lock_context(
            &mut transaction,
            settlement.activity_id,
            settlement.actor_user_id,
        )
        .await?;
        if context.actor_member_id != settlement.actor_member_id {
            return Err(SettlementRepositoryError::Forbidden);
        }
        let current = lock_settlement(
            &mut transaction,
            settlement.activity_id,
            settlement.settlement_id,
        )
        .await?;
        authorize_mutation(
            &current,
            settlement.actor_user_id,
            settlement.actor_is_owner,
            settlement.expected_version,
        )?;
        sqlx::query(
            "UPDATE settlements SET status = 'VOID', voided_at = $1, voided_by_user_id = $2, \
             version = version + 1, updated_at = $1 WHERE id = $3",
        )
        .bind(settlement.now)
        .bind(settlement.actor_user_id)
        .bind(settlement.settlement_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        revise_and_audit(
            &mut transaction,
            SettlementAudit {
                activity_id: settlement.activity_id,
                actor_user_id: settlement.actor_user_id,
                actor_member_id: settlement.actor_member_id,
                action: "SETTLEMENT_VOIDED",
                settlement_id: settlement.settlement_id,
                now: settlement.now,
            },
        )
        .await?;
        let record = load(&mut transaction, settlement.settlement_id).await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(record)
    }
}

fn context_from_row(row: &(String, Uuid, String)) -> ActivitySettlementContext {
    ActivitySettlementContext {
        base_currency: row.0.trim().to_owned(),
        actor_member_id: row.1,
        actor_is_owner: row.2 == "OWNER",
    }
}

async fn lock_context(
    connection: &mut PgConnection,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<ActivitySettlementContext, SettlementRepositoryError> {
    sqlx::query_as::<_, (String, Uuid, String)>(
        "SELECT a.base_currency, m.id, m.role FROM activities a \
         JOIN activity_members m ON m.activity_id = a.id \
         WHERE a.id = $1 AND a.status IN ('ACTIVE', 'ENDED') AND a.deleted_at IS NULL \
         AND m.user_id = $2 AND m.status = 'ACTIVE' \
         FOR UPDATE OF a",
    )
    .bind(activity_id)
    .bind(actor_user_id)
    .fetch_optional(connection)
    .await
    .map_err(log_repository_error)?
    .as_ref()
    .map(context_from_row)
    .ok_or(SettlementRepositoryError::Forbidden)
}

async fn authorize_read(
    pool: &PgPool,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<(), SettlementRepositoryError> {
    let allowed = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM activities a JOIN activity_members m ON m.activity_id = a.id \
         WHERE a.id = $1 AND a.deleted_at IS NULL AND m.user_id = $2 AND m.status = 'ACTIVE')",
    )
    .bind(activity_id)
    .bind(actor_user_id)
    .fetch_one(pool)
    .await
    .map_err(log_repository_error)?;
    if !allowed {
        return Err(SettlementRepositoryError::Forbidden);
    }
    Ok(())
}

async fn lock_settlement(
    connection: &mut PgConnection,
    activity_id: Uuid,
    settlement_id: Uuid,
) -> Result<SettlementRecord, SettlementRepositoryError> {
    let record = load(connection, settlement_id).await?;
    if record.activity_id != activity_id || record.status != "ACTIVE" {
        return Err(SettlementRepositoryError::NotFound);
    }
    sqlx::query("SELECT id FROM settlements WHERE id = $1 FOR UPDATE")
        .bind(settlement_id)
        .execute(connection)
        .await
        .map_err(log_repository_error)?;
    Ok(record)
}

fn authorize_mutation(
    current: &SettlementRecord,
    actor_user_id: Uuid,
    actor_is_owner: bool,
    expected_version: i64,
) -> Result<(), SettlementRepositoryError> {
    if current.created_by_user_id != actor_user_id && !actor_is_owner {
        return Err(SettlementRepositoryError::Forbidden);
    }
    if current.version != expected_version {
        return Err(SettlementRepositoryError::VersionConflict);
    }
    Ok(())
}

async fn require_members(
    connection: &mut PgConnection,
    activity_id: Uuid,
    payer_member_id: Uuid,
    receiver_member_id: Uuid,
) -> Result<(), SettlementRepositoryError> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM activity_members WHERE activity_id = $1 \
         AND id = ANY($2) AND status = 'ACTIVE'",
    )
    .bind(activity_id)
    .bind(vec![payer_member_id, receiver_member_id])
    .fetch_one(connection)
    .await
    .map_err(log_repository_error)?;
    if count != 2 {
        return Err(SettlementRepositoryError::InvalidMember);
    }
    Ok(())
}

pub(crate) async fn load(
    connection: &mut PgConnection,
    settlement_id: Uuid,
) -> Result<SettlementRecord, SettlementRepositoryError> {
    let row = sqlx::query_as::<_, SettlementRow>(
        "SELECT s.id, s.activity_id, s.created_by_user_id, s.client_mutation_id, \
         s.payer_member_id, s.receiver_member_id, s.currency, s.amount_minor, s.status, \
         s.version, a.revision, s.created_at, s.updated_at, s.voided_at \
         FROM settlements s JOIN activities a ON a.id = s.activity_id \
         WHERE s.id = $1 AND a.deleted_at IS NULL",
    )
    .bind(settlement_id)
    .fetch_optional(connection)
    .await
    .map_err(log_repository_error)?
    .ok_or(SettlementRepositoryError::NotFound)?;
    Ok(SettlementRecord {
        id: row.id,
        activity_id: row.activity_id,
        created_by_user_id: row.created_by_user_id,
        client_mutation_id: row.client_mutation_id,
        payer_member_id: row.payer_member_id,
        receiver_member_id: row.receiver_member_id,
        currency: row.currency.trim().to_owned(),
        amount_minor: row.amount_minor,
        status: row.status,
        version: row.version,
        revision: row.revision,
        created_at: row.created_at,
        updated_at: row.updated_at,
        voided_at: row.voided_at,
    })
}

struct SettlementAudit {
    activity_id: Uuid,
    actor_user_id: Uuid,
    actor_member_id: Uuid,
    action: &'static str,
    settlement_id: Uuid,
    now: OffsetDateTime,
}

async fn revise_and_audit(
    connection: &mut PgConnection,
    audit: SettlementAudit,
) -> Result<i64, SettlementRepositoryError> {
    let revision = sqlx::query_scalar::<_, i64>(
        "UPDATE activities SET revision = revision + 1, updated_at = $1 \
         WHERE id = $2 RETURNING revision",
    )
    .bind(audit.now)
    .bind(audit.activity_id)
    .fetch_one(&mut *connection)
    .await
    .map_err(log_repository_error)?;
    sqlx::query(
        "INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, actor_member_id, \
         action, resource_type, resource_id, activity_revision, created_at) \
         VALUES ($1, $2, $3, $4, $5, 'SETTLEMENT', $6, $7, $8)",
    )
    .bind(Uuid::new_v4())
    .bind(audit.activity_id)
    .bind(audit.actor_user_id)
    .bind(audit.actor_member_id)
    .bind(audit.action)
    .bind(audit.settlement_id)
    .bind(revision)
    .bind(audit.now)
    .execute(connection)
    .await
    .map_err(log_repository_error)?;
    Ok(revision)
}

fn log_repository_error(error: sqlx::Error) -> SettlementRepositoryError {
    tracing::error!(%error, "Settlement 事务执行失败");
    drop(error);
    SettlementRepositoryError::Unavailable
}
