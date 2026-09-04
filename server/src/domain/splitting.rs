use thiserror::Error;
use uuid::Uuid;

use super::exchange_rate::ExchangeRate;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Allocation {
    member_id: Uuid,
    amount_minor: i64,
}

impl Allocation {
    #[must_use]
    pub const fn new(member_id: Uuid, amount_minor: i64) -> Self {
        Self {
            member_id,
            amount_minor,
        }
    }

    #[must_use]
    pub const fn member_id(&self) -> Uuid {
        self.member_id
    }

    #[must_use]
    pub const fn amount_minor(&self) -> i64 {
        self.amount_minor
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum SplittingError {
    #[error("分摊总额必须大于零")]
    InvalidTotal,
    #[error("至少需要一位分摊成员")]
    EmptyMembers,
    #[error("分摊成员不能重复")]
    DuplicateMember,
    #[error("分摊金额或权重不能为负数")]
    InvalidValue,
    #[error("精确分摊金额之和必须等于账单总额")]
    NotConserved,
    #[error("分摊百分比必须是正数且总和精确等于 100")]
    InvalidPercentage,
    #[error("分摊计算超出安全金额范围")]
    Overflow,
}

/// 按成员均摊总额，所有尾差按成员 `UUID` 升序分配。
///
/// # Errors
///
/// 总额非正、成员为空/重复或计算溢出时返回错误。
pub fn split_equal(
    total_minor: i64,
    members: Vec<Uuid>,
) -> Result<Vec<Allocation>, SplittingError> {
    proportional_i128(
        total_minor,
        members.into_iter().map(|member| (member, 1)).collect(),
    )
}

/// 验证精确分摊守恒，并按成员 `UUID` 排序输出。
///
/// # Errors
///
/// 总额非正、成员为空/重复、金额为负、求和溢出或不守恒时返回错误。
pub fn exact(
    total_minor: i64,
    shares: Vec<(Uuid, i64)>,
) -> Result<Vec<Allocation>, SplittingError> {
    validate_total(total_minor)?;
    let mut shares = validate_and_sort(shares)?;
    if shares.iter().any(|(_, amount)| *amount < 0) {
        return Err(SplittingError::InvalidValue);
    }
    let sum = shares.iter().try_fold(0_i64, |sum, (_, amount)| {
        sum.checked_add(*amount).ok_or(SplittingError::Overflow)
    })?;
    if sum != total_minor {
        return Err(SplittingError::NotConserved);
    }

    Ok(shares
        .drain(..)
        .map(|(member, amount)| Allocation::new(member, amount))
        .collect())
}

/// 按精确十进制百分比分摊，总和必须精确等于 100。
///
/// # Errors
///
/// 百分比非法、不等于 100，或通用比例分配约束失败时返回错误。
pub fn percentage(
    total_minor: i64,
    shares: Vec<(Uuid, String)>,
) -> Result<Vec<Allocation>, SplittingError> {
    let parsed = shares
        .into_iter()
        .map(|(member, value)| {
            ExchangeRate::parse(&value)
                .map(|rate| (member, rate))
                .map_err(|_| SplittingError::InvalidPercentage)
        })
        .collect::<Result<Vec<_>, _>>()?;
    let common_scale = parsed
        .iter()
        .map(|(_, rate)| rate.scale())
        .max()
        .unwrap_or(0);
    let scaled = parsed
        .into_iter()
        .map(|(member, rate)| {
            let factor = pow10(common_scale - rate.scale())?;
            let value = rate
                .coefficient()
                .checked_mul(factor)
                .ok_or(SplittingError::Overflow)?;
            Ok((member, value))
        })
        .collect::<Result<Vec<_>, SplittingError>>()?;
    let sum = scaled.iter().try_fold(0_i128, |sum, (_, value)| {
        sum.checked_add(*value).ok_or(SplittingError::Overflow)
    })?;
    let expected = 100_i128
        .checked_mul(pow10(common_scale)?)
        .ok_or(SplittingError::Overflow)?;
    if sum != expected {
        return Err(SplittingError::InvalidPercentage);
    }

    proportional_i128(total_minor, scaled)
}

/// 按正整数权重分摊总额。
///
/// # Errors
///
/// 权重非正，或通用比例分配约束失败时返回错误。
pub fn weight(
    total_minor: i64,
    shares: Vec<(Uuid, i64)>,
) -> Result<Vec<Allocation>, SplittingError> {
    if shares.iter().any(|(_, value)| *value <= 0) {
        return Err(SplittingError::InvalidValue);
    }
    proportional(total_minor, shares)
}

/// 按正整数事实比例分配总额，供付款和 base 金额固化共同使用。
///
/// # Errors
///
/// 总额、成员、权重或计算不满足约束时返回错误。
pub fn proportional(
    total_minor: i64,
    shares: Vec<(Uuid, i64)>,
) -> Result<Vec<Allocation>, SplittingError> {
    proportional_i128(
        total_minor,
        shares
            .into_iter()
            .map(|(member, value)| (member, i128::from(value)))
            .collect(),
    )
}

fn proportional_i128(
    total_minor: i64,
    shares: Vec<(Uuid, i128)>,
) -> Result<Vec<Allocation>, SplittingError> {
    validate_total(total_minor)?;
    let shares = validate_and_sort(shares)?;
    if shares.iter().any(|(_, value)| *value <= 0) {
        return Err(SplittingError::InvalidValue);
    }
    let total_weight = shares.iter().try_fold(0_i128, |sum, (_, value)| {
        sum.checked_add(*value).ok_or(SplittingError::Overflow)
    })?;
    let mut allocations = shares
        .into_iter()
        .map(|(member, value)| {
            let amount = i128::from(total_minor)
                .checked_mul(value)
                .ok_or(SplittingError::Overflow)?
                / total_weight;
            Ok(Allocation::new(
                member,
                i64::try_from(amount).map_err(|_| SplittingError::Overflow)?,
            ))
        })
        .collect::<Result<Vec<_>, SplittingError>>()?;
    let allocated = allocations.iter().try_fold(0_i64, |sum, allocation| {
        sum.checked_add(allocation.amount_minor)
            .ok_or(SplittingError::Overflow)
    })?;
    let remainder = total_minor
        .checked_sub(allocated)
        .ok_or(SplittingError::Overflow)?;
    let remainder = usize::try_from(remainder).map_err(|_| SplittingError::Overflow)?;
    if remainder > allocations.len() {
        return Err(SplittingError::Overflow);
    }

    // 比例小数部分不参与排序，确保相同事实始终只由成员 UUID 决定尾差归属。
    for allocation in allocations.iter_mut().take(remainder) {
        allocation.amount_minor = allocation
            .amount_minor
            .checked_add(1)
            .ok_or(SplittingError::Overflow)?;
    }
    Ok(allocations)
}

fn validate_total(total_minor: i64) -> Result<(), SplittingError> {
    if total_minor <= 0 {
        Err(SplittingError::InvalidTotal)
    } else {
        Ok(())
    }
}

fn validate_and_sort<T>(mut shares: Vec<(Uuid, T)>) -> Result<Vec<(Uuid, T)>, SplittingError> {
    if shares.is_empty() {
        return Err(SplittingError::EmptyMembers);
    }
    shares.sort_unstable_by_key(|(member, _)| *member);
    if shares.windows(2).any(|window| window[0].0 == window[1].0) {
        return Err(SplittingError::DuplicateMember);
    }
    Ok(shares)
}

fn pow10(exponent: u8) -> Result<i128, SplittingError> {
    10_i128
        .checked_pow(u32::from(exponent))
        .ok_or(SplittingError::Overflow)
}
