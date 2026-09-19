use async_trait::async_trait;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    ledger::{Balance, LedgerEntry, SettlementFact, calculate_ledger},
    settlement::{
        RecommendationStrategy, SettlementRecommendation, recommend_settlements,
        recommend_settlements_with_strategy,
    },
};

/// 推荐策略判断所需的成员元数据；它只存在于本次读取快照，不会写入账务模型。
#[derive(Clone, Debug)]
pub struct LedgerMember {
    pub member_id: Uuid,
    pub user_id: Option<Uuid>,
    pub status: String,
}

#[derive(Clone, Debug)]
pub struct StoredLedgerFacts {
    pub base_currency: String,
    pub revision: i64,
    pub member_ids: Vec<Uuid>,
    pub members: Vec<LedgerMember>,
    pub actor_member_id: Uuid,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestedRecommendationStrategy {
    Default,
    MinTransfers,
    Centralized { hub_member_id: Uuid },
}

#[derive(Clone, Debug)]
pub struct RecommendationSnapshot {
    pub base_currency: String,
    pub revision: i64,
    pub effective_strategy: RecommendationStrategy,
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
    #[error("推荐策略参数无效")]
    InvalidRecommendationStrategy,
    #[error("统一结算人必须是当前登录用户在活动中的有效成员")]
    RecommendationHubForbidden,
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

/// 在同一组权威账务事实上解析策略并生成当前仍需完成的推荐转账。
///
/// # Errors
///
/// 读取权限、账务完整性、策略参数或 hub 权限不满足时返回错误。
pub async fn load_recommendations(
    repository: &dyn AccountingRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
    requested: RequestedRecommendationStrategy,
) -> Result<RecommendationSnapshot, AccountingError> {
    let facts = repository
        .load_facts(activity_id, actor_user_id)
        .await
        .map_err(map_repository_error)?;
    let balances = calculate_ledger(
        facts.member_ids.clone(),
        facts.payments,
        facts.shares,
        facts.settlements,
    )
    .map_err(|_| AccountingError::Integrity)?;
    let strategy = resolve_strategy(&facts.members, facts.actor_member_id, requested)?;
    let recommendations =
        recommend_settlements_with_strategy(&balances, strategy).map_err(|error| match error {
            crate::domain::settlement::RecommendationError::UnknownHub => {
                AccountingError::InvalidRecommendationStrategy
            }
            crate::domain::settlement::RecommendationError::DuplicateMember
            | crate::domain::settlement::RecommendationError::NotZeroSum
            | crate::domain::settlement::RecommendationError::Overflow => {
                AccountingError::Integrity
            }
        })?;
    Ok(RecommendationSnapshot {
        base_currency: facts.base_currency,
        revision: facts.revision,
        effective_strategy: strategy,
        recommendations,
    })
}

pub(crate) fn resolve_strategy(
    members: &[LedgerMember],
    actor_member_id: Uuid,
    requested: RequestedRecommendationStrategy,
) -> Result<RecommendationStrategy, AccountingError> {
    match requested {
        RequestedRecommendationStrategy::MinTransfers => Ok(RecommendationStrategy::MinTransfers),
        RequestedRecommendationStrategy::Centralized { hub_member_id } => {
            let hub = members
                .iter()
                .find(|member| member.member_id == hub_member_id);
            if hub.is_none_or(|member| {
                member.status != "ACTIVE"
                    || member.user_id.is_none()
                    || member.member_id != actor_member_id
            }) {
                return Err(AccountingError::RecommendationHubForbidden);
            }
            Ok(RecommendationStrategy::Centralized { hub_member_id })
        }
        RequestedRecommendationStrategy::Default => {
            let active_members = members
                .iter()
                .filter(|member| member.status == "ACTIVE")
                .collect::<Vec<_>>();
            let users = active_members
                .iter()
                .filter(|member| member.user_id.is_some())
                .collect::<Vec<_>>();
            let guests = active_members
                .iter()
                .filter(|member| member.user_id.is_none())
                .count();
            if users.len() == 1 && guests >= 1 && users[0].member_id == actor_member_id {
                Ok(RecommendationStrategy::Centralized {
                    hub_member_id: actor_member_id,
                })
            } else {
                Ok(RecommendationStrategy::MinTransfers)
            }
        }
    }
}

fn map_repository_error(error: AccountingRepositoryError) -> AccountingError {
    match error {
        AccountingRepositoryError::Forbidden => AccountingError::Forbidden,
        AccountingRepositoryError::Unavailable => AccountingError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(member_id: u128, user_id: Option<u128>) -> LedgerMember {
        LedgerMember {
            member_id: Uuid::from_u128(member_id),
            user_id: user_id.map(Uuid::from_u128),
            status: "ACTIVE".to_owned(),
        }
    }

    #[test]
    fn default_strategy_centralizes_one_user_and_guest_members() {
        let members = [member(1, Some(11)), member(2, None), member(3, None)];
        assert_eq!(
            resolve_strategy(
                &members,
                Uuid::from_u128(1),
                RequestedRecommendationStrategy::Default
            ),
            Ok(RecommendationStrategy::Centralized {
                hub_member_id: Uuid::from_u128(1)
            })
        );
    }

    #[test]
    fn default_strategy_keeps_multiple_users_on_min_transfers() {
        let members = [member(1, Some(11)), member(2, Some(22)), member(3, None)];
        assert_eq!(
            resolve_strategy(
                &members,
                Uuid::from_u128(1),
                RequestedRecommendationStrategy::Default
            ),
            Ok(RecommendationStrategy::MinTransfers)
        );
    }

    #[test]
    fn centralized_strategy_rejects_non_actor_or_inactive_hub() {
        let members = [member(1, Some(11)), member(2, Some(22))];
        assert_eq!(
            resolve_strategy(
                &members,
                Uuid::from_u128(1),
                RequestedRecommendationStrategy::Centralized {
                    hub_member_id: Uuid::from_u128(2),
                },
            ),
            Err(AccountingError::RecommendationHubForbidden)
        );
    }
}
