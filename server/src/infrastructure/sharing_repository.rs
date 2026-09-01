use async_trait::async_trait;
use sqlx::{FromRow, PgPool};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    application::sharing::{
        CsvExpenseRow, CsvNamedAmount, SharingRepository, SharingRepositoryError, SharingSnapshot,
        SnapshotLedgerEntry, SnapshotMember,
    },
    domain::ledger::SettlementFact,
};

/// `PostgreSQL` 分享快照仓储只读取已授权账务事实，不查询用户邮箱、附件或审计记录。
#[derive(Clone, Debug)]
pub struct PostgresSharingRepository {
    pool: PgPool,
    time_zone: String,
}

impl PostgresSharingRepository {
    #[must_use]
    pub fn new(pool: PgPool, time_zone: String) -> Self {
        Self { pool, time_zone }
    }
}

#[derive(FromRow)]
struct ExpenseRow {
    id: Uuid,
    occurred_at: String,
    title: String,
    category: String,
    original_amount_minor: i64,
    original_currency: String,
    exchange_rate: String,
    base_amount_minor: i64,
    split_mode: String,
    creator_name: String,
    created_at: String,
    note: Option<String>,
}

// 单一可重复读事务内的查询顺序和过滤条件共同定义快照，拆分会削弱这一关键边界的可审阅性。
#[allow(clippy::too_many_lines)]
#[async_trait]
impl SharingRepository for PostgresSharingRepository {
    async fn load_snapshot(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<SharingSnapshot, SharingRepositoryError> {
        let mut transaction = self.pool.begin().await.map_err(log_repository_error)?;
        // 账务摘要和下载必须从同一个只读快照生成，避免并发记账让同一份结果内的总额与行项目不一致。
        sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
        sqlx::query("SELECT set_config('TimeZone', $1, true)")
            .bind(&self.time_zone)
            .execute(&mut *transaction)
            .await
            .map_err(log_repository_error)?;
        let activity = sqlx::query_as::<_, (String, String, i64, Uuid)>(
            "SELECT a.name, a.base_currency, a.revision, m.id FROM activities a \
             JOIN activity_members m ON m.activity_id = a.id \
             WHERE a.id = $1 AND a.deleted_at IS NULL AND m.user_id = $2 AND m.status = 'ACTIVE'",
        )
        .bind(activity_id)
        .bind(actor_user_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .ok_or(SharingRepositoryError::Forbidden)?;
        let members = sqlx::query_as::<_, (Uuid, String)>(
            "SELECT id, display_name FROM activity_members WHERE activity_id = $1 ORDER BY id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .into_iter()
        .map(|(member_id, display_name)| SnapshotMember {
            member_id,
            display_name,
        })
        .collect();
        let total_expense_minor = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(SUM(base_amount_minor), 0)::BIGINT FROM expenses \
             WHERE activity_id = $1 AND deleted_at IS NULL",
        )
        .bind(activity_id)
        .fetch_one(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let payments = sqlx::query_as::<_, (Uuid, i64)>(
            "SELECT p.payer_member_id, p.base_amount_minor FROM expense_payments p \
             JOIN expenses e ON e.id = p.expense_id WHERE e.activity_id = $1 AND e.deleted_at IS NULL",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .into_iter()
        .map(|(member_id, amount)| SnapshotLedgerEntry::new(member_id, amount))
        .collect();
        let shares = sqlx::query_as::<_, (Uuid, i64)>(
            "SELECT s.member_id, s.base_amount_minor FROM expense_shares s \
             JOIN expenses e ON e.id = s.expense_id WHERE e.activity_id = $1 AND e.deleted_at IS NULL",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?
        .into_iter()
        .map(|(member_id, amount)| SnapshotLedgerEntry::new(member_id, amount))
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
        let expense_rows = sqlx::query_as::<_, ExpenseRow>(
            "SELECT e.id, to_char(e.occurred_at, 'YYYY-MM-DD\"T\"HH24:MI:SS.MSTZH:TZM') AS occurred_at, \
             e.title, e.category, e.original_amount_minor, e.original_currency, \
             e.exchange_rate::text AS exchange_rate, e.base_amount_minor, e.split_mode, \
             creator.display_name AS creator_name, \
             to_char(e.created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS.MSTZH:TZM') AS created_at, e.note FROM expenses e \
             JOIN activity_members creator ON creator.id = (SELECT id FROM activity_members \
               WHERE activity_id = e.activity_id AND user_id = e.created_by_user_id) \
             WHERE e.activity_id = $1 AND e.deleted_at IS NULL ORDER BY e.occurred_at, e.id",
        )
        .bind(activity_id)
        .fetch_all(&mut *transaction)
        .await
        .map_err(log_repository_error)?;
        let payments_by_expense =
            named_amounts_by_expense(&mut transaction, activity_id, true).await?;
        let shares_by_expense =
            named_amounts_by_expense(&mut transaction, activity_id, false).await?;
        let expenses = expense_rows
            .into_iter()
            .map(|expense| CsvExpenseRow {
                occurred_at: expense.occurred_at,
                title: expense.title,
                category: expense.category,
                original_amount_minor: expense.original_amount_minor,
                original_currency: expense.original_currency.trim().to_owned(),
                exchange_rate: normalize_numeric_text(&expense.exchange_rate),
                base_amount_minor: expense.base_amount_minor,
                payers: payments_by_expense
                    .get(&expense.id)
                    .cloned()
                    .unwrap_or_default(),
                participants: shares_by_expense
                    .get(&expense.id)
                    .cloned()
                    .unwrap_or_default(),
                split_mode: expense.split_mode,
                creator_name: expense.creator_name,
                created_at: expense.created_at,
                note: expense.note,
            })
            .collect();
        transaction.commit().await.map_err(log_repository_error)?;
        Ok(SharingSnapshot {
            activity_name: activity.0,
            base_currency: activity.1.trim().to_owned(),
            revision: activity.2,
            current_user_member_id: activity.3,
            members,
            total_expense_minor,
            payments,
            shares,
            settlements,
            expenses,
        })
    }
}

async fn named_amounts_by_expense(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    activity_id: Uuid,
    payments: bool,
) -> Result<HashMap<Uuid, Vec<CsvNamedAmount>>, SharingRepositoryError> {
    let query = if payments {
        "SELECT p.expense_id, m.display_name, p.original_amount_minor FROM expense_payments p \
         JOIN expenses e ON e.id = p.expense_id JOIN activity_members m ON m.id = p.payer_member_id \
         WHERE e.activity_id = $1 AND e.deleted_at IS NULL ORDER BY p.expense_id, p.payer_member_id"
    } else {
        "SELECT s.expense_id, m.display_name, s.original_amount_minor FROM expense_shares s \
         JOIN expenses e ON e.id = s.expense_id JOIN activity_members m ON m.id = s.member_id \
         WHERE e.activity_id = $1 AND e.deleted_at IS NULL ORDER BY s.expense_id, s.member_id"
    };
    let rows = sqlx::query_as::<_, (Uuid, String, i64)>(query)
        .bind(activity_id)
        .fetch_all(&mut **transaction)
        .await
        .map_err(log_repository_error)?;
    let mut values = HashMap::<Uuid, Vec<CsvNamedAmount>>::new();
    for (expense_id, display_name, amount_minor) in rows {
        values.entry(expense_id).or_default().push(CsvNamedAmount {
            display_name,
            amount_minor,
        });
    }
    Ok(values)
}

fn normalize_numeric_text(value: &str) -> String {
    value.trim_end_matches('0').trim_end_matches('.').to_owned()
}

fn log_repository_error(error: sqlx::Error) -> SharingRepositoryError {
    tracing::error!(%error, "读取活动分享快照失败");
    drop(error);
    SharingRepositoryError::Unavailable
}
