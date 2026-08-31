use thiserror::Error;

const SUPPORTED_CODES: &str = "
AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYI UYU UYW UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG
";

const ZERO_EXPONENT: &[&str] = &[
    "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND",
    "VUV", "XAF", "XOF", "XPF",
];
const THREE_EXPONENT: &[&str] = &["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"];
const FOUR_EXPONENT: &[&str] = &["CLF", "UYW"];

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Currency {
    code: String,
    exponent: u8,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CurrencyError {
    #[error("币种代码必须是三个 ASCII 字母")]
    InvalidCode,
    #[error("不支持的币种：{0}")]
    Unsupported(String),
}

impl Currency {
    /// 在领域边界规范化币种；持久化和 API 始终使用返回的大写三字母代码。
    ///
    /// # Errors
    ///
    /// 输入不是三位 ASCII 字母或不在冻结目录中时返回错误。
    pub fn parse(input: &str) -> Result<Self, CurrencyError> {
        let code = input.trim().to_ascii_uppercase();
        if code.len() != 3 || !code.bytes().all(|byte| byte.is_ascii_uppercase()) {
            return Err(CurrencyError::InvalidCode);
        }
        if !SUPPORTED_CODES
            .split_ascii_whitespace()
            .any(|item| item == code)
        {
            return Err(CurrencyError::Unsupported(code));
        }

        let exponent = if ZERO_EXPONENT.contains(&code.as_str()) {
            0
        } else if THREE_EXPONENT.contains(&code.as_str()) {
            3
        } else if FOUR_EXPONENT.contains(&code.as_str()) {
            4
        } else {
            2
        };

        Ok(Self { code, exponent })
    }

    #[must_use]
    pub fn code(&self) -> &str {
        &self.code
    }

    #[must_use]
    pub const fn exponent(&self) -> u8 {
        self.exponent
    }
}
