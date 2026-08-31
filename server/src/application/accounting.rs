use async_trait::async_trait;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    ledger::{Balance, LedgerEntry, SettlementFact, calculate_ledger},
    settlement::{SettlementRecommendation, recommend_settlements},
};

#[derive(Clone, Debug)]
pub struct StoredLedgerFacts {
    pub base_currency: String,
    pub revision: i64,
    pub member_ids: Vec<Uuid>,
    pub payments: Vec<LedgerEntry>,
    pub shares: Vec<LedgerEntry>,
    pub settlements: Vec<SettlementFact>,
}

#[derive(Clone, Debug)]
pub struct LedgerSnapshot {
    pub base_currency: String,
    pub revision: i64,
    pub balances: Vec<Balance>,
    pub recommendations: Vec<SettlementRecommendation>,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum AccountingRepositoryError {
    #[error("没有账本读取权限")]
    Forbidden,
    #[error("账本数据读取失败")]
    Unavailable,
}

#[async_trait]
pub trait AccountingRepository: Send + Sync {
    async fn load_facts(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<StoredLedgerFacts, AccountingRepositoryError>;
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum AccountingError {
    #[error("没有账本读取权限")]
    Forbidden,
    #[error("账本事实不完整")]
    Integrity,
    #[error("账本服务暂时不可用")]
    Unavailable,
}

/// 从 `PostgreSQL` 中已固化的 base facts 计算权威 Ledger 和确定性结算建议。
///
/// # Errors
///
/// 操作者无权读取、账务事实不守恒或存储不可用时返回对应错误。
pub async fn load_ledger(
    repository: &dyn AccountingRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<LedgerSnapshot, AccountingError> {
    let facts = repository
        .load_facts(activity_id, actor_user_id)
        .await
        .map_err(|error| match error {
            AccountingRepositoryError::Forbidden => AccountingError::Forbidden,
            AccountingRepositoryError::Unavailable => AccountingError::Unavailable,
        })?;
    let balances = calculate_ledger(
        facts.member_ids,
        facts.payments,
        facts.shares,
        facts.settlements,
    )
    .map_err(|_| AccountingError::Integrity)?;
    let recommendations =
        recommend_settlements(&balances).map_err(|_| AccountingError::Integrity)?;
    Ok(LedgerSnapshot {
        base_currency: facts.base_currency,
        revision: facts.revision,
        balances,
        recommendations,
    })
}
