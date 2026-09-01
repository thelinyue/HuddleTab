use async_trait::async_trait;
use sqlx::PgPool;
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::{
    application::{
        accounting::StoredLedgerFacts,
        activity::{ActivityMemberView, ActivityView},
        snapshot::{
            SnapshotCondition, SnapshotRepository, SnapshotRepositoryError, StoredActivitySnapshot,
            StoredSnapshotResult,
        },
    },
    domain::ledger::{LedgerEntry, SettlementFact},
    infrastructure::{
        expense_repository::load_aggregate, settlement_repository::load as load_settlement,
    },
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
pub struct PostgresSnapshotRepository {
    pool: PgPool,
}

impl PostgresSnapshotRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SnapshotRepository for PostgresSnapshotRepository {
    #[allow(clippy::too_many_lines)]
    async fn load(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
        condition: &dyn SnapshotCondition,
    ) -> Result<StoredSnapshotResult, SnapshotRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        // 授权、revision 与全部工作台事实必须来自同一个数据库视图，禁止拼接多个读事务。
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
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
        .bind(actor_user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(SnapshotRepositoryError::NotFound)?;
        let activity = activity_from_row(row);
        if condition.matches(activity.revision) {
            transaction.commit().await.map_err(log_repository_error)?;
            return Ok(StoredSnapshotResult::NotModified {
                revision: activity.revision,
            });
        }

        let members = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, String, String, i64)>(
            "SELECT id, user_id, display_name, role, status, version FROM activity_members \
             WHERE activity_id = $1 ORDER BY CASE role WHEN 'OWNER' THEN 0 ELSE 1 END, joined_at, id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .into_iter()
        .map(|row| ActivityMemberView {
            member_id: row.0,
            activity_id,
            user_id: row.1,
            display_name: row.2,
            role: row.3,
            status: row.4,
            version: row.5,
        })
        .collect::<Vec<_>>();

        let expense_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM expenses WHERE activity_id = $1 AND deleted_at IS NULL \
             ORDER BY occurred_at DESC, id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let mut expenses = Vec::with_capacity(expense_ids.len());
        for expense_id in expense_ids {
            expenses.push(
                load_aggregate(&mut transaction, expense_id, true)
                    .await
                    .map_err(|_| SnapshotRepositoryError::Unavailable)?,
            );
        }

        let settlement_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM settlements WHERE activity_id = $1 ORDER BY created_at DESC, id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let mut settlements = Vec::with_capacity(settlement_ids.len());
        for settlement_id in settlement_ids {
            settlements.push(
                load_settlement(&mut transaction, settlement_id)
                    .await
                    .map_err(|_| SnapshotRepositoryError::Unavailable)?,
            );
        }

        let payments = expenses
            .iter()
            .flat_map(|aggregate| {
                aggregate
                    .payments
                    .iter()
                    .map(|fact| LedgerEntry::new(fact.member_id, fact.base_amount_minor))
            })
            .collect();
        let shares = expenses
            .iter()
            .flat_map(|aggregate| {
                aggregate
                    .shares
                    .iter()
                    .map(|fact| LedgerEntry::new(fact.member_id, fact.base_amount_minor))
            })
            .collect();
        let settlement_facts = settlements
            .iter()
            .filter(|settlement| settlement.status == "ACTIVE")
            .map(|settlement| {
                SettlementFact::new(
                    settlement.payer_member_id,
                    settlement.receiver_member_id,
                    settlement.amount_minor,
                )
            })
            .collect();
        let ledger_facts = StoredLedgerFacts {
            base_currency: activity.base_currency.clone(),
            revision: activity.revision,
            member_ids: members.iter().map(|member| member.member_id).collect(),
            payments,
            shares,
            settlements: settlement_facts,
        };
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(StoredSnapshotResult::Modified(Box::new(
            StoredActivitySnapshot {
                activity,
                members,
                expenses,
                settlements,
                ledger_facts,
            },
        )))
    }
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

fn log_repository_error(error: sqlx::Error) -> SnapshotRepositoryError {
    tracing::error!(%error, "读取 Activity Revision Snapshot 失败");
    drop(error);
    SnapshotRepositoryError::Unavailable
}
