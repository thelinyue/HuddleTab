use std::collections::BTreeMap;
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LedgerEntry {
    member_id: Uuid,
    amount_minor: i64,
}

impl LedgerEntry {
    #[must_use]
    pub const fn new(member_id: Uuid, amount_minor: i64) -> Self {
        Self {
            member_id,
            amount_minor,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementFact {
    payer_member_id: Uuid,
    receiver_member_id: Uuid,
    amount_minor: i64,
}

impl SettlementFact {
    #[must_use]
    pub const fn new(payer_member_id: Uuid, receiver_member_id: Uuid, amount_minor: i64) -> Self {
        Self {
            payer_member_id,
            receiver_member_id,
            amount_minor,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Balance {
    member_id: Uuid,
    net_minor: i64,
}

impl Balance {
    #[must_use]
    pub const fn new(member_id: Uuid, net_minor: i64) -> Self {
        Self {
            member_id,
            net_minor,
        }
    }

    #[must_use]
    pub const fn member_id(&self) -> Uuid {
        self.member_id
    }

    #[must_use]
    pub const fn net_minor(&self) -> i64 {
        self.net_minor
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum LedgerError {
    #[error("账务成员必须存在且不能重复")]
    InvalidMembers,
    #[error("账务事实引用了活动中不存在的成员")]
    UnknownMember,
    #[error("账务金额必须为非负数")]
    InvalidAmount,
    #[error("账务事实不守恒，无法生成总账")]
    NotConserved,
    #[error("结算付款人与收款人不能相同")]
    InvalidSettlement,
    #[error("总账计算超出安全金额范围")]
    Overflow,
}

/// 从已固化的 base payment/share 和非 VOID settlement 实时计算权威余额。
///
/// # Errors
///
/// 成员或事实非法、付款与承担不守恒，或任一金额运算溢出时返回错误。
pub fn calculate_ledger(
    member_ids: Vec<Uuid>,
    payments: Vec<LedgerEntry>,
    shares: Vec<LedgerEntry>,
    settlements: Vec<SettlementFact>,
) -> Result<Vec<Balance>, LedgerError> {
    let mut member_ids = member_ids;
    member_ids.sort_unstable();
    if member_ids.is_empty() || member_ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(LedgerError::InvalidMembers);
    }

    let mut balances = member_ids
        .iter()
        .copied()
        .map(|member| (member, 0_i64))
        .collect::<BTreeMap<_, _>>();
    let payment_total = fact_total(&payments)?;
    let share_total = fact_total(&shares)?;
    if payment_total != share_total {
        return Err(LedgerError::NotConserved);
    }

    for payment in payments {
        adjust(&mut balances, payment.member_id, payment.amount_minor)?;
    }
    for share in shares {
        adjust(
            &mut balances,
            share.member_id,
            share
                .amount_minor
                .checked_neg()
                .ok_or(LedgerError::Overflow)?,
        )?;
    }
    for settlement in settlements {
        if settlement.amount_minor <= 0
            || settlement.payer_member_id == settlement.receiver_member_id
        {
            return Err(LedgerError::InvalidSettlement);
        }
        // 正余额表示应收；付款人实际转出后债务减少，收款人的应收同步减少。
        adjust(
            &mut balances,
            settlement.payer_member_id,
            settlement.amount_minor,
        )?;
        adjust(
            &mut balances,
            settlement.receiver_member_id,
            settlement
                .amount_minor
                .checked_neg()
                .ok_or(LedgerError::Overflow)?,
        )?;
    }

    let result = balances
        .into_iter()
        .map(|(member, net)| Balance::new(member, net))
        .collect::<Vec<_>>();
    let total = result.iter().try_fold(0_i64, |sum, balance| {
        sum.checked_add(balance.net_minor)
            .ok_or(LedgerError::Overflow)
    })?;
    if total != 0 {
        return Err(LedgerError::NotConserved);
    }
    Ok(result)
}

fn fact_total(entries: &[LedgerEntry]) -> Result<i64, LedgerError> {
    entries.iter().try_fold(0_i64, |sum, entry| {
        if entry.amount_minor < 0 {
            return Err(LedgerError::InvalidAmount);
        }
        sum.checked_add(entry.amount_minor)
            .ok_or(LedgerError::Overflow)
    })
}

fn adjust(
    balances: &mut BTreeMap<Uuid, i64>,
    member_id: Uuid,
    delta: i64,
) -> Result<(), LedgerError> {
    let balance = balances
        .get_mut(&member_id)
        .ok_or(LedgerError::UnknownMember)?;
    *balance = balance.checked_add(delta).ok_or(LedgerError::Overflow)?;
    Ok(())
}
