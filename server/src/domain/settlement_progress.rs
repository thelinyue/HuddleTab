use std::collections::BTreeMap;

use thiserror::Error;
use uuid::Uuid;

use super::ledger::{LedgerEntry, SettlementFact, calculate_ledger};

/// Expense 局部 Ledger 中成员的方向。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BalanceType {
    Payable,
    Receivable,
}

impl BalanceType {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Payable => "PAYABLE",
            Self::Receivable => "RECEIVABLE",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MemberSettlementStatus {
    Unsettled,
    PartiallySettled,
    Settled,
}

impl MemberSettlementStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unsettled => "UNSETTLED",
            Self::PartiallySettled => "PARTIALLY_SETTLED",
            Self::Settled => "SETTLED",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MemberSettlementProgress {
    pub member_id: Uuid,
    pub balance_type: BalanceType,
    pub expected_minor: i64,
    pub settled_minor: i64,
    pub remaining_minor: i64,
    pub status: MemberSettlementStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExpenseSettlementStatus {
    NoSettlementRequired,
    Unsettled,
    PartiallySettled,
    Settled,
}

impl ExpenseSettlementStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::NoSettlementRequired => "NO_SETTLEMENT_REQUIRED",
            Self::Unsettled => "UNSETTLED",
            Self::PartiallySettled => "PARTIALLY_SETTLED",
            Self::Settled => "SETTLED",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpenseSettlementProgress {
    pub status: ExpenseSettlementStatus,
    pub total_required_minor: i64,
    pub settled_minor: i64,
    pub remaining_minor: i64,
    pub members: Vec<MemberSettlementProgress>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum SettlementProgressError {
    #[error("账单局部 Ledger 不完整")]
    Integrity,
    #[error("账单结算计算超出安全金额范围")]
    Overflow,
}

/// 从单笔 Expense 的 Payment、Share 和明确 Allocation 派生结算进度。
/// Allocation 的 payer/payee 由 `SettlementFact` 携带，因此不会复制或修改原始分摊事实。
///
/// # Errors
///
/// 局部账务事实不守恒、成员不存在、结算超额或金额计算溢出时返回错误。
pub fn calculate_expense_progress(
    member_ids: Vec<Uuid>,
    payments: Vec<LedgerEntry>,
    shares: Vec<LedgerEntry>,
    allocations: Vec<SettlementFact>,
) -> Result<ExpenseSettlementProgress, SettlementProgressError> {
    let initial = calculate_ledger(
        member_ids.clone(),
        payments.clone(),
        shares.clone(),
        Vec::new(),
    )
    .map_err(|_| SettlementProgressError::Integrity)?;
    let current = calculate_ledger(member_ids, payments, shares, allocations)
        .map_err(|_| SettlementProgressError::Integrity)?;
    let current_by_member = current
        .into_iter()
        .map(|balance| (balance.member_id(), balance.net_minor()))
        .collect::<BTreeMap<_, _>>();

    let mut members = Vec::new();
    let mut total_required = 0_i64;
    let mut settled_total = 0_i64;
    for balance in initial {
        let expected_net = balance.net_minor();
        if expected_net == 0 {
            continue;
        }
        let current_net = *current_by_member
            .get(&balance.member_id())
            .ok_or(SettlementProgressError::Integrity)?;
        let (balance_type, expected, settled, remaining) = if expected_net < 0 {
            let expected = expected_net
                .checked_neg()
                .ok_or(SettlementProgressError::Overflow)?;
            let remaining = current_net
                .checked_neg()
                .ok_or(SettlementProgressError::Overflow)?;
            let settled = expected
                .checked_sub(remaining)
                .ok_or(SettlementProgressError::Overflow)?;
            (BalanceType::Payable, expected, settled, remaining)
        } else {
            let expected = expected_net;
            let remaining = current_net;
            let settled = expected
                .checked_sub(remaining)
                .ok_or(SettlementProgressError::Overflow)?;
            (BalanceType::Receivable, expected, settled, remaining)
        };
        if settled < 0 || remaining < 0 || settled > expected {
            return Err(SettlementProgressError::Integrity);
        }
        let status = if settled == 0 {
            MemberSettlementStatus::Unsettled
        } else if remaining == 0 {
            MemberSettlementStatus::Settled
        } else {
            MemberSettlementStatus::PartiallySettled
        };
        // 一笔直接结算同时减少付款方债务和收款方应收；总额只取付款方一侧，避免把同一笔真实付款计算两次。
        if balance_type == BalanceType::Payable {
            total_required = total_required
                .checked_add(expected)
                .ok_or(SettlementProgressError::Overflow)?;
            settled_total = settled_total
                .checked_add(settled)
                .ok_or(SettlementProgressError::Overflow)?;
        }
        members.push(MemberSettlementProgress {
            member_id: balance.member_id(),
            balance_type,
            expected_minor: expected,
            settled_minor: settled,
            remaining_minor: remaining,
            status,
        });
    }
    let remaining_total = total_required
        .checked_sub(settled_total)
        .ok_or(SettlementProgressError::Overflow)?;
    let status = if total_required == 0 {
        ExpenseSettlementStatus::NoSettlementRequired
    } else if remaining_total == total_required {
        ExpenseSettlementStatus::Unsettled
    } else if remaining_total == 0 {
        ExpenseSettlementStatus::Settled
    } else {
        ExpenseSettlementStatus::PartiallySettled
    };
    Ok(ExpenseSettlementProgress {
        status,
        total_required_minor: total_required,
        settled_minor: settled_total,
        remaining_minor: remaining_total,
        members,
    })
}

/// 返回一笔直接 payer → payee Settlement 在当前 Expense 上允许分配的最大金额。
#[must_use]
pub fn direct_allocation_capacity(
    progress: &ExpenseSettlementProgress,
    debtor_member_id: Uuid,
    creditor_member_id: Uuid,
) -> i64 {
    let debtor = progress.members.iter().find(|member| {
        member.member_id == debtor_member_id && member.balance_type == BalanceType::Payable
    });
    let creditor = progress.members.iter().find(|member| {
        member.member_id == creditor_member_id && member.balance_type == BalanceType::Receivable
    });
    match (debtor, creditor) {
        (Some(debtor), Some(creditor)) => debtor.remaining_minor.min(creditor.remaining_minor),
        _ => 0,
    }
}
