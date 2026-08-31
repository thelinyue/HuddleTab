use async_trait::async_trait;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    application::accounting::{AccountingRepository, AccountingRepositoryError, StoredLedgerFacts},
    domain::ledger::{LedgerEntry, SettlementFact},
};

#[derive(Clone, Debug)]
pub struct PostgresAccountingRepository {
    pool: PgPool,
}

impl PostgresAccountingRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl AccountingRepository for PostgresAccountingRepository {
    async fn load_facts(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<StoredLedgerFacts, AccountingRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        let activity = sqlx::query_as::<_, (String, i64)>(
            "SELECT a.base_currency, a.revision FROM activities a \
             WHERE a.id = $1 AND EXISTS(SELECT 1 FROM activity_members m \
               WHERE m.activity_id = a.id AND m.user_id = $2 AND m.status = 'ACTIVE')",
        )
        .bind(activity_id)
        .bind(actor_user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(AccountingRepositoryError::Forbidden)?;
        let member_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM activity_members WHERE activity_id = $1 ORDER BY id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let payments = sqlx::query_as::<_, (Uuid, i64)>(
            "SELECT p.payer_member_id, p.base_amount_minor FROM expense_payments p \
             JOIN expenses e ON e.id = p.expense_id \
             WHERE e.activity_id = $1 AND e.deleted_at IS NULL",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .into_iter()
        .map(|(member_id, amount)| LedgerEntry::new(member_id, amount))
        .collect();
        let shares = sqlx::query_as::<_, (Uuid, i64)>(
            "SELECT s.member_id, s.base_amount_minor FROM expense_shares s \
             JOIN expenses e ON e.id = s.expense_id \
             WHERE e.activity_id = $1 AND e.deleted_at IS NULL",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .into_iter()
        .map(|(member_id, amount)| LedgerEntry::new(member_id, amount))
        .collect();
        let settlements = sqlx::query_as::<_, (Uuid, Uuid, i64)>(
            "SELECT payer_member_id, receiver_member_id, amount_minor FROM settlements \
             WHERE activity_id = $1 AND status = 'ACTIVE'",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .into_iter()
        .map(|(payer, receiver, amount)| SettlementFact::new(payer, receiver, amount))
        .collect();
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(StoredLedgerFacts {
            base_currency: activity.0.trim().to_owned(),
            revision: activity.1,
            member_ids,
            payments,
            shares,
            settlements,
        })
    }
}

fn log_repository_error(error: sqlx::Error) -> AccountingRepositoryError {
    tracing::error!(%error, "读取权威 Ledger facts 失败");
    drop(error);
    AccountingRepositoryError::Unavailable
}
