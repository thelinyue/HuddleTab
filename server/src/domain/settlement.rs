use std::cmp::Ordering;
use thiserror::Error;
use uuid::Uuid;

use super::ledger::Balance;

/// 推荐转账路径。它只描述如何结清当前 Ledger 余额，不会改变任何账务事实。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecommendationStrategy {
    /// 尽量减少转账次数。
    MinTransfers,
    /// 让所有非 hub 成员只与指定 hub 发生推荐转账。
    Centralized { hub_member_id: Uuid },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementRecommendation {
    payer_member_id: Uuid,
    receiver_member_id: Uuid,
    amount_minor: i64,
}

impl SettlementRecommendation {
    #[must_use]
    pub const fn payer_member_id(&self) -> Uuid {
        self.payer_member_id
    }

    #[must_use]
    pub const fn receiver_member_id(&self) -> Uuid {
        self.receiver_member_id
    }

    #[must_use]
    pub const fn amount_minor(&self) -> i64 {
        self.amount_minor
    }
}

#[derive(Clone)]
struct WorkingBalance {
    member_id: Uuid,
    remaining_minor: i64,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum RecommendationError {
    #[error("成员余额合计必须为零")]
    NotZeroSum,
    #[error("总账成员不能重复")]
    DuplicateMember,
    #[error("结算推荐计算超出安全金额范围")]
    Overflow,
    #[error("统一结算人必须属于当前账本")]
    UnknownHub,
}

/// 根据瞬时零和余额生成确定性建议；建议不是已经发生的 Settlement 事实。
///
/// # Errors
///
/// 余额不为零和、成员重复或金额取反/求和溢出时返回错误。
pub fn recommend_settlements(
    balances: &[Balance],
) -> Result<Vec<SettlementRecommendation>, RecommendationError> {
    validate_balances(balances)?;

    recommend_min_transfers(balances)
}

/// 按指定策略从瞬时余额生成确定性推荐；推荐本身不是 Settlement 事实。
///
/// 统一结算策略先输出所有应付成员到 hub 的转账，再输出 hub 到应收成员的转账，
/// 这样分享摘要和结算页在相同余额下拥有稳定、易读的顺序。
///
/// # Errors
///
/// 余额不为零和、成员重复、hub 不存在或金额运算溢出时返回错误。
pub fn recommend_settlements_with_strategy(
    balances: &[Balance],
    strategy: RecommendationStrategy,
) -> Result<Vec<SettlementRecommendation>, RecommendationError> {
    validate_balances(balances)?;
    match strategy {
        RecommendationStrategy::MinTransfers => recommend_min_transfers(balances),
        RecommendationStrategy::Centralized { hub_member_id } => {
            recommend_centralized(balances, hub_member_id)
        }
    }
}

fn validate_balances(balances: &[Balance]) -> Result<(), RecommendationError> {
    let mut member_ids = balances.iter().map(Balance::member_id).collect::<Vec<_>>();
    member_ids.sort_unstable();
    if member_ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(RecommendationError::DuplicateMember);
    }
    let total = balances.iter().try_fold(0_i64, |sum, balance| {
        sum.checked_add(balance.net_minor())
            .ok_or(RecommendationError::Overflow)
    })?;
    if total != 0 {
        return Err(RecommendationError::NotZeroSum);
    }
    Ok(())
}

fn recommend_min_transfers(
    balances: &[Balance],
) -> Result<Vec<SettlementRecommendation>, RecommendationError> {
    let mut creditors = balances
        .iter()
        .filter(|balance| balance.net_minor() > 0)
        .map(|balance| WorkingBalance {
            member_id: balance.member_id(),
            remaining_minor: balance.net_minor(),
        })
        .collect::<Vec<_>>();
    let mut debtors = balances
        .iter()
        .filter(|balance| balance.net_minor() < 0)
        .map(|balance| {
            Ok(WorkingBalance {
                member_id: balance.member_id(),
                remaining_minor: balance
                    .net_minor()
                    .checked_neg()
                    .ok_or(RecommendationError::Overflow)?,
            })
        })
        .collect::<Result<Vec<_>, RecommendationError>>()?;
    let mut recommendations = Vec::new();

    while !creditors.is_empty() && !debtors.is_empty() {
        creditors.sort_unstable_by(compare_largest_first);
        debtors.sort_unstable_by(compare_largest_first);
        let amount_minor = creditors[0].remaining_minor.min(debtors[0].remaining_minor);
        recommendations.push(SettlementRecommendation {
            payer_member_id: debtors[0].member_id,
            receiver_member_id: creditors[0].member_id,
            amount_minor,
        });
        creditors[0].remaining_minor -= amount_minor;
        debtors[0].remaining_minor -= amount_minor;
        if creditors[0].remaining_minor == 0 {
            creditors.remove(0);
        }
        if debtors[0].remaining_minor == 0 {
            debtors.remove(0);
        }
    }

    Ok(recommendations)
}

fn recommend_centralized(
    balances: &[Balance],
    hub_member_id: Uuid,
) -> Result<Vec<SettlementRecommendation>, RecommendationError> {
    if !balances
        .iter()
        .any(|balance| balance.member_id() == hub_member_id)
    {
        return Err(RecommendationError::UnknownHub);
    }

    let mut recommendations = balances
        .iter()
        .filter(|balance| balance.member_id() != hub_member_id && balance.net_minor() < 0)
        .map(|balance| {
            Ok(SettlementRecommendation {
                payer_member_id: balance.member_id(),
                receiver_member_id: hub_member_id,
                amount_minor: balance
                    .net_minor()
                    .checked_neg()
                    .ok_or(RecommendationError::Overflow)?,
            })
        })
        .collect::<Result<Vec<_>, RecommendationError>>()?;

    recommendations.extend(
        balances
            .iter()
            .filter(|balance| balance.member_id() != hub_member_id && balance.net_minor() > 0)
            .map(|balance| SettlementRecommendation {
                payer_member_id: hub_member_id,
                receiver_member_id: balance.member_id(),
                amount_minor: balance.net_minor(),
            }),
    );
    Ok(recommendations)
}

fn compare_largest_first(left: &WorkingBalance, right: &WorkingBalance) -> Ordering {
    right
        .remaining_minor
        .cmp(&left.remaining_minor)
        .then_with(|| left.member_id.cmp(&right.member_id))
}
