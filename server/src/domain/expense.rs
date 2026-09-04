use std::collections::BTreeMap;

use thiserror::Error;
use time::Date;
use uuid::Uuid;

use super::{
    currency::Currency,
    exchange_rate::ExchangeRate,
    money::Money,
    splitting::{exact, percentage, proportional, split_equal, weight},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentInput {
    pub member_id: Uuid,
    pub amount_minor: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SplitEntryInput {
    pub member_id: Uuid,
    pub value: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExpenseSplitInput {
    Equal(Vec<Uuid>),
    Exact(Vec<SplitEntryInput>),
    Percentage(Vec<SplitEntryInput>),
    Weight(Vec<SplitEntryInput>),
}

impl ExpenseSplitInput {
    #[must_use]
    pub const fn mode(&self) -> &'static str {
        match self {
            Self::Equal(_) => "EQUAL",
            Self::Exact(_) => "EXACT",
            Self::Percentage(_) => "PERCENTAGE",
            Self::Weight(_) => "WEIGHT",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExpenseFactRow {
    pub member_id: Uuid,
    pub original_amount_minor: i64,
    pub base_amount_minor: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedExpense {
    pub original_currency: String,
    pub original_amount_minor: i64,
    pub base_currency: String,
    pub base_amount_minor: i64,
    pub exchange_rate_kind: String,
    pub exchange_rate: String,
    pub exchange_rate_reference_date: Option<Date>,
    pub exchange_rate_provider: Option<String>,
    pub split_mode: String,
    pub payments: Vec<ExpenseFactRow>,
    pub shares: Vec<ExpenseFactRow>,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum PrepareExpenseError {
    #[error("账单币种、金额或汇率无效")]
    InvalidMoney,
    #[error("IDENTITY 与 MANUAL 汇率类型不匹配币种")]
    InvalidRateKind,
    #[error("付款合计必须等于账单总额")]
    PaymentNotConserved,
    #[error("账单分摊无效")]
    InvalidSplit,
    #[error("账单计算超出安全金额范围")]
    Overflow,
}

/// 将 Expense 输入收敛为不可变双金额事实。总额只换算一次，行级 base 金额再按
/// `ActivityMember` UUID 稳定分配，因此付款与分摊在 original/base 两侧都守恒。
///
/// # Errors
///
/// 金额、汇率、付款或分摊不合法，以及 checked 运算溢出时返回对应领域错误。
pub fn prepare_expense(
    base_currency: &str,
    original_currency: &str,
    original_amount_minor: &str,
    exchange_rate_kind: &str,
    exchange_rate: &str,
    payments: Vec<PaymentInput>,
    split: ExpenseSplitInput,
) -> Result<PreparedExpense, PrepareExpenseError> {
    let original_currency =
        Currency::parse(original_currency).map_err(|_| PrepareExpenseError::InvalidMoney)?;
    let base_currency =
        Currency::parse(base_currency).map_err(|_| PrepareExpenseError::InvalidMoney)?;
    let total = Money::from_api(original_currency.clone(), original_amount_minor)
        .map_err(|_| PrepareExpenseError::InvalidMoney)?
        .amount_minor();
    if total <= 0 {
        return Err(PrepareExpenseError::InvalidMoney);
    }
    let rate = ExchangeRate::parse(exchange_rate).map_err(|_| PrepareExpenseError::InvalidMoney)?;
    match (
        original_currency == base_currency,
        exchange_rate_kind,
        rate.to_api().as_str(),
    ) {
        (true, "IDENTITY", "1") | (false, "MANUAL" | "PROVIDER" | "CACHE", _) => {}
        _ => return Err(PrepareExpenseError::InvalidRateKind),
    }
    let base_total = rate
        .convert_minor(total, &original_currency, &base_currency)
        .map_err(|_| PrepareExpenseError::Overflow)?;
    if base_total < 0 {
        return Err(PrepareExpenseError::InvalidMoney);
    }

    let payment_originals = payments
        .into_iter()
        .map(|payment| {
            let amount = Money::from_api(original_currency.clone(), &payment.amount_minor)
                .map_err(|_| PrepareExpenseError::InvalidMoney)?
                .amount_minor();
            if amount <= 0 {
                return Err(PrepareExpenseError::InvalidMoney);
            }
            Ok((payment.member_id, amount))
        })
        .collect::<Result<Vec<_>, PrepareExpenseError>>()?;
    let payment_total = payment_originals
        .iter()
        .try_fold(0_i64, |sum, (_, amount)| {
            sum.checked_add(*amount)
                .ok_or(PrepareExpenseError::Overflow)
        })?;
    if payment_total != total {
        return Err(PrepareExpenseError::PaymentNotConserved);
    }
    let split_mode = split.mode().to_owned();
    let share_originals = prepare_shares(total, split)?;
    let payments = allocate_base(base_total, payment_originals)?;
    let shares = allocate_base(base_total, share_originals)?;

    Ok(PreparedExpense {
        original_currency: original_currency.code().to_owned(),
        original_amount_minor: total,
        base_currency: base_currency.code().to_owned(),
        base_amount_minor: base_total,
        exchange_rate_kind: exchange_rate_kind.to_owned(),
        exchange_rate: rate.to_api(),
        exchange_rate_reference_date: None,
        exchange_rate_provider: None,
        split_mode,
        payments,
        shares,
    })
}

fn prepare_shares(
    total: i64,
    split: ExpenseSplitInput,
) -> Result<Vec<(Uuid, i64)>, PrepareExpenseError> {
    let allocations = match split {
        ExpenseSplitInput::Equal(members) => split_equal(total, members),
        ExpenseSplitInput::Exact(entries) => exact(total, parse_amount_entries(entries)?),
        ExpenseSplitInput::Percentage(entries) => percentage(
            total,
            entries
                .into_iter()
                .map(|entry| (entry.member_id, entry.value))
                .collect(),
        ),
        ExpenseSplitInput::Weight(entries) => weight(total, parse_amount_entries(entries)?),
    }
    .map_err(|_| PrepareExpenseError::InvalidSplit)?;
    Ok(allocations
        .into_iter()
        .map(|allocation| (allocation.member_id(), allocation.amount_minor()))
        .collect())
}

fn parse_amount_entries(
    entries: Vec<SplitEntryInput>,
) -> Result<Vec<(Uuid, i64)>, PrepareExpenseError> {
    entries
        .into_iter()
        .map(|entry| {
            let value = entry
                .value
                .parse::<i64>()
                .map_err(|_| PrepareExpenseError::InvalidSplit)?;
            if value.to_string() != entry.value {
                return Err(PrepareExpenseError::InvalidSplit);
            }
            Ok((entry.member_id, value))
        })
        .collect()
}

fn allocate_base(
    base_total: i64,
    originals: Vec<(Uuid, i64)>,
) -> Result<Vec<ExpenseFactRow>, PrepareExpenseError> {
    if base_total == 0 {
        return Ok(originals
            .into_iter()
            .map(|(member_id, original_amount_minor)| ExpenseFactRow {
                member_id,
                original_amount_minor,
                base_amount_minor: 0,
            })
            .collect());
    }
    let positive = originals
        .iter()
        .filter(|(_, amount)| *amount > 0)
        .copied()
        .collect::<Vec<_>>();
    let base_allocations = proportional(base_total, positive)
        .map_err(|_| PrepareExpenseError::InvalidSplit)?
        .into_iter()
        .map(|allocation| (allocation.member_id(), allocation.amount_minor()))
        .collect::<BTreeMap<_, _>>();
    let original_by_member = originals.into_iter().collect::<BTreeMap<_, _>>();
    Ok(original_by_member
        .into_iter()
        .map(|(member_id, original_amount_minor)| ExpenseFactRow {
            member_id,
            original_amount_minor,
            base_amount_minor: base_allocations.get(&member_id).copied().unwrap_or(0),
        })
        .collect())
}
