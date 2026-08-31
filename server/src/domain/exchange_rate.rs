use thiserror::Error;

use super::currency::Currency;

const MAX_SCALE: usize = 12;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExchangeRate {
    coefficient: i128,
    scale: u8,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum ExchangeRateError {
    #[error("汇率必须是最多 12 位小数的正十进制数")]
    InvalidDecimal,
    #[error("汇率换算超出安全金额范围")]
    Overflow,
}

impl ExchangeRate {
    /// 解析 `1 原币主单位 = N 活动主币主单位` 中的正十进制 `N`。
    ///
    /// # Errors
    ///
    /// 输入不规范、不是正数、超过 12 位小数或系数超出 `i128` 时返回错误。
    pub fn parse(input: &str) -> Result<Self, ExchangeRateError> {
        let (integer, fraction) = match input.split_once('.') {
            Some((integer, fraction)) => {
                if fraction.is_empty() || fraction.len() > MAX_SCALE || fraction.contains('.') {
                    return Err(ExchangeRateError::InvalidDecimal);
                }
                (integer, Some(fraction))
            }
            None => (input, None),
        };

        if integer.is_empty()
            || !integer.bytes().all(|byte| byte.is_ascii_digit())
            || (integer.len() > 1 && integer.starts_with('0'))
            || fraction.is_some_and(|value| !value.bytes().all(|byte| byte.is_ascii_digit()))
        {
            return Err(ExchangeRateError::InvalidDecimal);
        }

        let scale = fraction.map_or(0, str::len);
        let raw = fraction.map_or_else(|| integer.to_owned(), |value| format!("{integer}{value}"));
        let mut coefficient = raw
            .parse::<i128>()
            .map_err(|_| ExchangeRateError::InvalidDecimal)?;
        if coefficient <= 0 {
            return Err(ExchangeRateError::InvalidDecimal);
        }

        let mut normalized_scale = scale;
        while normalized_scale > 0 && coefficient % 10 == 0 {
            coefficient /= 10;
            normalized_scale -= 1;
        }

        Ok(Self {
            coefficient,
            scale: u8::try_from(normalized_scale).map_err(|_| ExchangeRateError::InvalidDecimal)?,
        })
    }

    #[must_use]
    pub const fn coefficient(&self) -> i128 {
        self.coefficient
    }

    #[must_use]
    pub const fn scale(&self) -> u8 {
        self.scale
    }

    #[must_use]
    pub fn to_api(&self) -> String {
        if self.scale == 0 {
            return self.coefficient.to_string();
        }

        let scale = usize::from(self.scale);
        let digits = self.coefficient.to_string();
        if digits.len() <= scale {
            return format!("0.{}{digits}", "0".repeat(scale - digits.len()));
        }
        let split = digits.len() - scale;
        format!("{}.{}", &digits[..split], &digits[split..])
    }

    /// 将一笔原币最小单位金额换算为活动主币最小单位，并且只在最终结果 half-up 一次。
    ///
    /// # Errors
    ///
    /// 任一 `i128` 中间乘法或最终 `i64` 结果溢出时返回错误。
    pub fn convert_minor(
        &self,
        amount_minor: i64,
        original_currency: &Currency,
        base_currency: &Currency,
    ) -> Result<i64, ExchangeRateError> {
        let numerator = i128::from(amount_minor)
            .checked_mul(self.coefficient)
            .and_then(|value| value.checked_mul(pow10(base_currency.exponent()).ok()?))
            .ok_or(ExchangeRateError::Overflow)?;
        let denominator = pow10(original_currency.exponent())?
            .checked_mul(pow10(self.scale)?)
            .ok_or(ExchangeRateError::Overflow)?;
        let rounded = divide_half_up(numerator, denominator)?;

        i64::try_from(rounded).map_err(|_| ExchangeRateError::Overflow)
    }
}

fn pow10(exponent: u8) -> Result<i128, ExchangeRateError> {
    10_i128
        .checked_pow(u32::from(exponent))
        .ok_or(ExchangeRateError::Overflow)
}

fn divide_half_up(numerator: i128, denominator: i128) -> Result<i128, ExchangeRateError> {
    let negative = numerator.is_negative();
    let absolute = numerator.checked_abs().ok_or(ExchangeRateError::Overflow)?;
    let quotient = absolute / denominator;
    let remainder = absolute % denominator;
    let rounded = if remainder
        .checked_mul(2)
        .ok_or(ExchangeRateError::Overflow)?
        >= denominator
    {
        quotient.checked_add(1).ok_or(ExchangeRateError::Overflow)?
    } else {
        quotient
    };

    if negative {
        rounded.checked_neg().ok_or(ExchangeRateError::Overflow)
    } else {
        Ok(rounded)
    }
}
