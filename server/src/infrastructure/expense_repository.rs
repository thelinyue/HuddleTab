use std::collections::BTreeSet;

use async_trait::async_trait;
use sqlx::{FromRow, PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::expense::{
    ActivityExpenseContext, CreatedExpense, ExpenseAggregate, ExpenseDelete, ExpensePayment,
    ExpenseRecord, ExpenseRepository, ExpenseRepositoryError, ExpenseShare, ExpenseUpdate,
    NewExpense,
};
use crate::domain::expense::{ExpenseFactRow, PreparedExpense};

#[derive(Clone, Debug)]
pub struct PostgresExpenseRepository {
    pool: PgPool,
}

impl PostgresExpenseRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[derive(FromRow)]
struct ExpenseRow {
    id: Uuid,
    activity_id: Uuid,
    created_by_user_id: Uuid,
    client_mutation_id: Uuid,
    title: String,
    category: String,
    note: Option<String>,
    occurred_at: OffsetDateTime,
    original_currency: String,
    original_amount_minor: i64,
    base_currency: String,
    base_amount_minor: i64,
    exchange_rate_kind: String,
    exchange_rate: String,
    split_mode: String,
    version: i64,
    revision: i64,
    deleted_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

#[derive(FromRow)]
struct FactRow {
    id: Uuid,
    member_id: Uuid,
    original_amount_minor: i64,
    base_amount_minor: i64,
}

#[async_trait]
impl ExpenseRepository for PostgresExpenseRepository {
    async fn activity_context(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<ActivityExpenseContext, ExpenseRepositoryError> {
        sqlx::query_as::<_, (String, Uuid, String)>(
            "SELECT a.base_currency, m.id, m.role FROM activities a \
             JOIN activity_members m ON m.activity_id = a.id \
             WHERE a.id = $1 AND a.deleted_at IS NULL AND m.user_id = $2 AND m.status = 'ACTIVE'",
        )
        .bind(activity_id)
        .bind(actor_user_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(log_repository_error)?
        .map(
            |(base_currency, actor_member_id, role)| ActivityExpenseContext {
                base_currency: base_currency.trim().to_owned(),
                actor_member_id,
                actor_is_owner: role == "OWNER",
            },
        )
        .ok_or(ExpenseRepositoryError::Forbidden)
    }

    async fn create(&self, expense: NewExpense) -> Result<CreatedExpense, ExpenseRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let context =
            lock_activity_context(&mut transaction, expense.activity_id, expense.actor_user_id)
                .await?;
        if context.actor_member_id != expense.actor_member_id {
            return Err(ExpenseRepositoryError::Forbidden);
        }
        if let Some((existing_id, existing_activity_id)) = sqlx::query_as::<_, (Uuid, Uuid)>(
            "SELECT id, activity_id FROM expenses \
                 WHERE created_by_user_id = $1 AND client_mutation_id = $2 FOR UPDATE",
        )
        .bind(expense.actor_user_id)
        .bind(expense.client_mutation_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        {
            if existing_activity_id != expense.activity_id {
                return Err(ExpenseRepositoryError::MutationConflict);
            }
            let aggregate = load_aggregate(&mut transaction, existing_id, false).await?;
            transaction.commit().await.map_err(log_repository_error)?;
            return Ok(CreatedExpense {
                aggregate,
                idempotent_replay: true,
            });
        }
        require_active_members(&mut transaction, expense.activity_id, &expense.prepared).await?;
        sqlx::query(
            "INSERT INTO expenses (id, activity_id, created_by_user_id, client_mutation_id, title, \
             category, note, occurred_at, original_currency, original_amount_minor, base_currency, \
             base_amount_minor, exchange_rate_kind, exchange_rate, split_mode, created_at, updated_at) \
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, \
                     CAST($14 AS NUMERIC), $15, $16, $16)",
        )
        .bind(expense.id)
        .bind(expense.activity_id)
        .bind(expense.actor_user_id)
        .bind(expense.client_mutation_id)
        .bind(&expense.title)
        .bind(&expense.category)
        .bind(&expense.note)
        .bind(expense.occurred_at)
        .bind(&expense.prepared.original_currency)
        .bind(expense.prepared.original_amount_minor)
        .bind(&expense.prepared.base_currency)
        .bind(expense.prepared.base_amount_minor)
        .bind(&expense.prepared.exchange_rate_kind)
        .bind(&expense.prepared.exchange_rate)
        .bind(&expense.prepared.split_mode)
        .bind(expense.now)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        insert_facts(
            &mut transaction,
            expense.activity_id,
            expense.id,
            &expense.prepared,
        )
        .await?;
        revise_and_audit(
            &mut transaction,
            ExpenseAudit {
                activity_id: expense.activity_id,
                actor_user_id: expense.actor_user_id,
                actor_member_id: expense.actor_member_id,
                action: "EXPENSE_CREATED",
                expense_id: expense.id,
                now: expense.now,
            },
        )
        .await?;
        let aggregate = load_aggregate(&mut transaction, expense.id, false).await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(CreatedExpense {
            aggregate,
            idempotent_replay: false,
        })
    }

    async fn list(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Vec<ExpenseAggregate>, ExpenseRepositoryError> {
        self.activity_context(activity_id, actor_user_id).await?;
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM expenses WHERE activity_id = $1 AND deleted_at IS NULL \
             ORDER BY occurred_at DESC, id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let mut expenses = Vec::with_capacity(ids.len());
        for id in ids {
            expenses.push(load_aggregate(&mut transaction, id, true).await?);
        }
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(expenses)
    }

    async fn get(
        &self,
        activity_id: Uuid,
        expense_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<ExpenseAggregate, ExpenseRepositoryError> {
        self.activity_context(activity_id, actor_user_id).await?;
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let aggregate = load_aggregate(&mut transaction, expense_id, true).await?;
        if aggregate.expense.activity_id != activity_id {
            return Err(ExpenseRepositoryError::NotFound);
        }
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(aggregate)
    }

    async fn update(
        &self,
        expense: ExpenseUpdate,
    ) -> Result<ExpenseAggregate, ExpenseRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let context =
            lock_activity_context(&mut transaction, expense.activity_id, expense.actor_user_id)
                .await?;
        if context.actor_member_id != expense.actor_member_id {
            return Err(ExpenseRepositoryError::Forbidden);
        }
        let owner = sqlx::query_as::<_, (Uuid, i64, Option<OffsetDateTime>)>(
            "SELECT created_by_user_id, version, deleted_at FROM expenses \
             WHERE id = $1 AND activity_id = $2 FOR UPDATE",
        )
        .bind(expense.expense_id)
        .bind(expense.activity_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(ExpenseRepositoryError::NotFound)?;
        if owner.2.is_some() {
            return Err(ExpenseRepositoryError::NotFound);
        }
        if owner.0 != expense.actor_user_id && !expense.actor_is_owner {
            return Err(ExpenseRepositoryError::Forbidden);
        }
        if owner.1 != expense.expected_version {
            return Err(ExpenseRepositoryError::VersionConflict);
        }
        require_active_members(&mut transaction, expense.activity_id, &expense.prepared).await?;
        sqlx::query(
            "UPDATE expenses SET title = $1, category = $2, note = $3, occurred_at = $4, \
             original_currency = $5, original_amount_minor = $6, base_currency = $7, \
             base_amount_minor = $8, exchange_rate_kind = $9, \
             exchange_rate = CAST($10 AS NUMERIC), split_mode = $11, \
             version = version + 1, updated_at = $12 WHERE id = $13",
        )
        .bind(&expense.title)
        .bind(&expense.category)
        .bind(&expense.note)
        .bind(expense.occurred_at)
        .bind(&expense.prepared.original_currency)
        .bind(expense.prepared.original_amount_minor)
        .bind(&expense.prepared.base_currency)
        .bind(expense.prepared.base_amount_minor)
        .bind(&expense.prepared.exchange_rate_kind)
        .bind(&expense.prepared.exchange_rate)
        .bind(&expense.prepared.split_mode)
        .bind(expense.now)
        .bind(expense.expense_id)
        .execute(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        sqlx::query("DELETE FROM expense_payments WHERE expense_id = $1")
            .bind(expense.expense_id)
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
        sqlx::query("DELETE FROM expense_shares WHERE expense_id = $1")
            .bind(expense.expense_id)
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
        insert_facts(
            &mut transaction,
            expense.activity_id,
            expense.expense_id,
            &expense.prepared,
        )
        .await?;
        revise_and_audit(
            &mut transaction,
            ExpenseAudit {
                activity_id: expense.activity_id,
                actor_user_id: expense.actor_user_id,
                actor_member_id: expense.actor_member_id,
                action: "EXPENSE_UPDATED",
                expense_id: expense.expense_id,
                now: expense.now,
            },
        )
        .await?;
        let aggregate = load_aggregate(&mut transaction, expense.expense_id, true).await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(aggregate)
    }

    async fn delete(&self, expense: ExpenseDelete) -> Result<(i64, i64), ExpenseRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let context =
            lock_activity_context(&mut transaction, expense.activity_id, expense.actor_user_id)
                .await?;
        if context.actor_member_id != expense.actor_member_id {
            return Err(ExpenseRepositoryError::Forbidden);
        }
        let owner = sqlx::query_as::<_, (Uuid, i64, Option<OffsetDateTime>)>(
            "SELECT created_by_user_id, version, deleted_at FROM expenses \
             WHERE id = $1 AND activity_id = $2 FOR UPDATE",
        )
        .bind(expense.expense_id)
        .bind(expense.activity_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(ExpenseRepositoryError::NotFound)?;
        if owner.2.is_some() {
            return Err(ExpenseRepositoryError::NotFound);
        }
        if owner.0 != expense.actor_user_id && !expense.actor_is_owner {
            return Err(ExpenseRepositoryError::Forbidden);
        }
        if owner.1 != expense.expected_version {
            return Err(ExpenseRepositoryError::VersionConflict);
        }
        let version = sqlx::query_scalar::<_, i64>(
            "UPDATE expenses SET deleted_at = $1, version = version + 1, updated_at = $1 \
             WHERE id = $2 RETURNING version",
        )
        .bind(expense.now)
        .bind(expense.expense_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let revision = revise_and_audit(
            &mut transaction,
            ExpenseAudit {
                activity_id: expense.activity_id,
                actor_user_id: expense.actor_user_id,
                actor_member_id: expense.actor_member_id,
                action: "EXPENSE_DELETED",
                expense_id: expense.expense_id,
                now: expense.now,
            },
        )
        .await?;
        transaction.commit().await.map_err(log_repository_error)?;
        Ok((version, revision))
    }
}

async fn lock_activity_context(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<ActivityExpenseContext, ExpenseRepositoryError> {
    sqlx::query_as::<_, (String, Uuid, String)>(
        "SELECT a.base_currency, m.id, m.role FROM activities a \
         JOIN activity_members m ON m.activity_id = a.id \
         WHERE a.id = $1 AND a.status = 'ACTIVE' AND a.deleted_at IS NULL \
         AND m.user_id = $2 AND m.status = 'ACTIVE' \
         FOR UPDATE OF a",
    )
    .bind(activity_id)
    .bind(actor_user_id)
    .fetch_optional(&mut **transaction)
    .await
    .map_err(log_repository_error)?
    .map(
        |(base_currency, actor_member_id, role)| ActivityExpenseContext {
            base_currency: base_currency.trim().to_owned(),
            actor_member_id,
            actor_is_owner: role == "OWNER",
        },
    )
    .ok_or(ExpenseRepositoryError::Forbidden)
}

async fn require_active_members(
    connection: &mut PgConnection,
    activity_id: Uuid,
    prepared: &PreparedExpense,
) -> Result<(), ExpenseRepositoryError> {
    let member_ids = prepared
        .payments
        .iter()
        .chain(&prepared.shares)
        .map(|row| row.member_id)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM activity_members \
         WHERE activity_id = $1 AND id = ANY($2) AND status = 'ACTIVE'",
    )
    .bind(activity_id)
    .bind(&member_ids)
    .fetch_one(connection)
    .await
    .map_err(log_repository_error)?;
    if usize::try_from(count).ok() != Some(member_ids.len()) {
        return Err(ExpenseRepositoryError::InvalidMember);
    }
    Ok(())
}

async fn insert_facts(
    connection: &mut PgConnection,
    activity_id: Uuid,
    expense_id: Uuid,
    prepared: &PreparedExpense,
) -> Result<(), ExpenseRepositoryError> {
    for payment in &prepared.payments {
        insert_payment(connection, activity_id, expense_id, payment, prepared).await?;
    }
    for share in &prepared.shares {
        insert_share(connection, activity_id, expense_id, share, prepared).await?;
    }
    Ok(())
}

async fn insert_payment(
    connection: &mut PgConnection,
    activity_id: Uuid,
    expense_id: Uuid,
    payment: &ExpenseFactRow,
    prepared: &PreparedExpense,
) -> Result<(), ExpenseRepositoryError> {
    sqlx::query(
        "INSERT INTO expense_payments (id, activity_id, expense_id, payer_member_id, \
         original_currency, original_amount_minor, base_currency, base_amount_minor) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(expense_id)
    .bind(payment.member_id)
    .bind(&prepared.original_currency)
    .bind(payment.original_amount_minor)
    .bind(&prepared.base_currency)
    .bind(payment.base_amount_minor)
    .execute(connection)
    .await
    .map_err(log_repository_error)?;
    Ok(())
}

async fn insert_share(
    connection: &mut PgConnection,
    activity_id: Uuid,
    expense_id: Uuid,
    share: &ExpenseFactRow,
    prepared: &PreparedExpense,
) -> Result<(), ExpenseRepositoryError> {
    sqlx::query(
        "INSERT INTO expense_shares (id, activity_id, expense_id, member_id, original_currency, \
         original_amount_minor, base_currency, base_amount_minor) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::new_v4())
    .bind(activity_id)
    .bind(expense_id)
    .bind(share.member_id)
    .bind(&prepared.original_currency)
    .bind(share.original_amount_minor)
    .bind(&prepared.base_currency)
    .bind(share.base_amount_minor)
    .execute(connection)
    .await
    .map_err(log_repository_error)?;
    Ok(())
}

async fn load_aggregate(
    connection: &mut PgConnection,
    expense_id: Uuid,
    require_active: bool,
) -> Result<ExpenseAggregate, ExpenseRepositoryError> {
    let row = sqlx::query_as::<_, ExpenseRow>(
        "SELECT e.id, e.activity_id, e.created_by_user_id, e.client_mutation_id, e.title, \
         e.category, e.note, e.occurred_at, e.original_currency, e.original_amount_minor, \
         e.base_currency, e.base_amount_minor, e.exchange_rate_kind, \
         e.exchange_rate::text AS exchange_rate, e.split_mode, e.version, a.revision, e.deleted_at, \
         e.created_at, e.updated_at FROM expenses e JOIN activities a ON a.id = e.activity_id \
         WHERE e.id = $1 AND a.deleted_at IS NULL AND ($2 = FALSE OR e.deleted_at IS NULL)",
    )
    .bind(expense_id)
    .bind(require_active)
    .fetch_optional(&mut *connection)
    .await
    .map_err(log_repository_error)?
    .ok_or(ExpenseRepositoryError::NotFound)?;
    let payments = sqlx::query_as::<_, FactRow>(
        "SELECT id, payer_member_id AS member_id, original_amount_minor, base_amount_minor \
         FROM expense_payments WHERE expense_id = $1 ORDER BY payer_member_id",
    )
    .bind(expense_id)
    .fetch_all(&mut *connection)
    .await
    .map_err(log_repository_error)?
    .into_iter()
    .map(|fact| ExpensePayment {
        id: fact.id,
        member_id: fact.member_id,
        original_amount_minor: fact.original_amount_minor,
        base_amount_minor: fact.base_amount_minor,
    })
    .collect();
    let shares = sqlx::query_as::<_, FactRow>(
        "SELECT id, member_id, original_amount_minor, base_amount_minor \
         FROM expense_shares WHERE expense_id = $1 ORDER BY member_id",
    )
    .bind(expense_id)
    .fetch_all(&mut *connection)
    .await
    .map_err(log_repository_error)?
    .into_iter()
    .map(|fact| ExpenseShare {
        id: fact.id,
        member_id: fact.member_id,
        original_amount_minor: fact.original_amount_minor,
        base_amount_minor: fact.base_amount_minor,
    })
    .collect();
    Ok(ExpenseAggregate {
        expense: ExpenseRecord {
            id: row.id,
            activity_id: row.activity_id,
            created_by_user_id: row.created_by_user_id,
            client_mutation_id: row.client_mutation_id,
            title: row.title,
            category: row.category,
            note: row.note,
            occurred_at: row.occurred_at,
            original_currency: row.original_currency.trim().to_owned(),
            original_amount_minor: row.original_amount_minor,
            base_currency: row.base_currency.trim().to_owned(),
            base_amount_minor: row.base_amount_minor,
            exchange_rate_kind: row.exchange_rate_kind,
            exchange_rate: normalize_numeric_text(&row.exchange_rate),
            split_mode: row.split_mode,
            version: row.version,
            revision: row.revision,
            deleted: row.deleted_at.is_some(),
            created_at: row.created_at,
            updated_at: row.updated_at,
        },
        payments,
        shares,
    })
}

struct ExpenseAudit {
    activity_id: Uuid,
    actor_user_id: Uuid,
    actor_member_id: Uuid,
    action: &'static str,
    expense_id: Uuid,
    now: OffsetDateTime,
}

async fn revise_and_audit(
    connection: &mut PgConnection,
    audit: ExpenseAudit,
) -> Result<i64, ExpenseRepositoryError> {
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
         VALUES ($1, $2, $3, $4, $5, 'EXPENSE', $6, $7, $8)",
    )
    .bind(Uuid::new_v4())
    .bind(audit.activity_id)
    .bind(audit.actor_user_id)
    .bind(audit.actor_member_id)
    .bind(audit.action)
    .bind(audit.expense_id)
    .bind(revision)
    .bind(audit.now)
    .execute(connection)
    .await
    .map_err(log_repository_error)?;
    Ok(revision)
}

fn normalize_numeric_text(value: &str) -> String {
    value.trim_end_matches('0').trim_end_matches('.').to_owned()
}

fn log_repository_error(error: sqlx::Error) -> ExpenseRepositoryError {
    tracing::error!(%error, "Expense 聚合事务执行失败");
    drop(error);
    ExpenseRepositoryError::Unavailable
}
