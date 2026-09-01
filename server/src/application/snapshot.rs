use async_trait::async_trait;
use thiserror::Error;
use uuid::Uuid;

use crate::{
    application::{
        accounting::{LedgerSnapshot, StoredLedgerFacts},
        activity::{ActivityMemberView, ActivityView},
        expense::ExpenseAggregate,
        settlement::SettlementRecord,
    },
    domain::{ledger::calculate_ledger, settlement::recommend_settlements},
};

#[derive(Clone, Debug)]
pub struct ActivitySnapshot {
    pub revision: i64,
    pub activity: ActivityView,
    pub members: Vec<ActivityMemberView>,
    pub expenses: Vec<ExpenseAggregate>,
    pub settlements: Vec<SettlementRecord>,
    pub ledger: LedgerSnapshot,
}

#[derive(Clone, Debug)]
pub struct StoredActivitySnapshot {
    pub activity: ActivityView,
    pub members: Vec<ActivityMemberView>,
    pub expenses: Vec<ExpenseAggregate>,
    pub settlements: Vec<SettlementRecord>,
    pub ledger_facts: StoredLedgerFacts,
}

#[derive(Clone, Debug)]
pub enum StoredSnapshotResult {
    NotModified { revision: i64 },
    Modified(Box<StoredActivitySnapshot>),
}

#[derive(Clone, Debug)]
pub enum SnapshotResult {
    NotModified { revision: i64 },
    Modified(Box<ActivitySnapshot>),
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum SnapshotRepositoryError {
    #[error("活动不存在或当前用户不可访问")]
    NotFound,
    #[error("活动快照读取失败")]
    Unavailable,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum SnapshotError {
    #[error("活动不存在或当前用户不可访问")]
    NotFound,
    #[error("活动账务事实不完整")]
    Integrity,
    #[error("活动快照暂时不可用")]
    Unavailable,
}

/// 条件请求由 HTTP 边界解释；Repository 只在授权后的事务快照中询问当前 revision 是否命中。
pub trait SnapshotCondition: Send + Sync {
    fn matches(&self, revision: i64) -> bool;
}

#[async_trait]
pub trait SnapshotRepository: Send + Sync {
    async fn load(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
        condition: &dyn SnapshotCondition,
    ) -> Result<StoredSnapshotResult, SnapshotRepositoryError>;
}

/// 在授权后的同一事务视图内读取 Activity Snapshot，并计算账本与推荐结果。
///
/// # Errors
///
/// Activity 不可访问、Repository 读取失败或账务事实不完整时返回对应错误。
pub async fn load_snapshot(
    repository: &dyn SnapshotRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
    condition: &dyn SnapshotCondition,
) -> Result<SnapshotResult, SnapshotError> {
    let stored = repository
        .load(activity_id, actor_user_id, condition)
        .await
        .map_err(|error| match error {
            SnapshotRepositoryError::NotFound => SnapshotError::NotFound,
            SnapshotRepositoryError::Unavailable => SnapshotError::Unavailable,
        })?;
    let stored = match stored {
        StoredSnapshotResult::NotModified { revision } => {
            return Ok(SnapshotResult::NotModified { revision });
        }
        StoredSnapshotResult::Modified(stored) => stored,
    };
    let revision = stored.activity.revision;
    if stored.ledger_facts.revision != revision
        || stored
            .expenses
            .iter()
            .any(|aggregate| aggregate.expense.revision != revision)
        || stored
            .settlements
            .iter()
            .any(|settlement| settlement.revision != revision)
    {
        return Err(SnapshotError::Integrity);
    }
    let balances = calculate_ledger(
        stored.ledger_facts.member_ids,
        stored.ledger_facts.payments,
        stored.ledger_facts.shares,
        stored.ledger_facts.settlements,
    )
    .map_err(|_| SnapshotError::Integrity)?;
    let recommendations = recommend_settlements(&balances).map_err(|_| SnapshotError::Integrity)?;
    Ok(SnapshotResult::Modified(Box::new(ActivitySnapshot {
        revision,
        activity: stored.activity,
        members: stored.members,
        expenses: stored.expenses,
        settlements: stored.settlements,
        ledger: LedgerSnapshot {
            base_currency: stored.ledger_facts.base_currency,
            revision,
            balances,
            recommendations,
        },
    })))
}
