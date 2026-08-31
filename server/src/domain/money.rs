use thiserror::Error;

use super::currency::Currency;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Money {
    currency: Currency,
    amount_minor: i64,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum MoneyError {
    #[error("金额必须是 i64 范围内的规范最小货币单位整数")]
    InvalidAmount,
    #[error("不能直接运算不同币种的金额")]
    CurrencyMismatch,
    #[error("金额运算超出 i64 范围")]
    Overflow,
}

impl Money {
    #[must_use]
    pub const fn new(currency: Currency, amount_minor: i64) -> Self {
        Self {
            currency,
            amount_minor,
        }
    }

    /// API 金额只接受规范十进制字符串，避免 JSON number 和宽松解析引入精度歧义。
    ///
    /// # Errors
    ///
    /// 非整数、前导零、空白、显式正号或 `i64` 溢出时返回错误。
    pub fn from_api(currency: Currency, input: &str) -> Result<Self, MoneyError> {
        if !is_canonical_integer(input) {
            return Err(MoneyError::InvalidAmount);
        }
        let amount_minor = input
            .parse::<i64>()
            .map_err(|_| MoneyError::InvalidAmount)?;
        Ok(Self::new(currency, amount_minor))
    }

    #[must_use]
    pub const fn currency(&self) -> &Currency {
        &self.currency
    }

    #[must_use]
    pub const fn amount_minor(&self) -> i64 {
        self.amount_minor
    }

    #[must_use]
    pub fn to_api_amount(&self) -> String {
        self.amount_minor.to_string()
    }

    /// 账务金额禁止隐式换汇，并使用 checked 运算拒绝溢出。
    ///
    /// # Errors
    ///
    /// 币种不同或相加结果超出 `i64` 时返回错误。
    pub fn checked_add(&self, other: &Self) -> Result<Self, MoneyError> {
        if self.currency != other.currency {
            return Err(MoneyError::CurrencyMismatch);
        }
        let amount_minor = self
            .amount_minor
            .checked_add(other.amount_minor)
            .ok_or(MoneyError::Overflow)?;
        Ok(Self::new(self.currency.clone(), amount_minor))
    }
}

fn is_canonical_integer(input: &str) -> bool {
    let digits = input.strip_prefix('-').unwrap_or(input);
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    if input.starts_with('+') {
        return false;
    }
    digits == "0" || !digits.starts_with('0')
}
