use huddletab_server::domain::{currency::Currency, exchange_rate::ExchangeRate};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateVectors {
    rates: Vec<RateCase>,
    invalid_rates: Vec<String>,
    conversions: Vec<ConversionCase>,
}

#[derive(Deserialize)]
struct RateCase {
    input: String,
    coefficient: String,
    scale: u8,
    normalized: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversionCase {
    amount_minor: String,
    original_currency: String,
    base_currency: String,
    rate: String,
    expected_base_minor: String,
}

fn vectors() -> RateVectors {
    serde_json::from_str(include_str!("../../golden/exchange-rates.json"))
        .expect("exchange-rate golden vectors 应为合法 JSON")
}

#[test]
fn rates_parse_as_positive_normalized_decimals() {
    let vectors = vectors();

    for case in vectors.rates {
        let rate = ExchangeRate::parse(&case.input).expect("golden 汇率应可解析");
        assert_eq!(rate.coefficient().to_string(), case.coefficient);
        assert_eq!(rate.scale(), case.scale);
        assert_eq!(rate.to_api(), case.normalized);
    }

    for input in vectors.invalid_rates {
        assert!(ExchangeRate::parse(&input).is_err(), "应拒绝汇率 {input:?}");
    }
}

#[test]
fn conversion_uses_checked_i128_and_half_up_rounding() {
    for case in vectors().conversions {
        let original = Currency::parse(&case.original_currency).expect("原币种应受支持");
        let base = Currency::parse(&case.base_currency).expect("主币种应受支持");
        let rate = ExchangeRate::parse(&case.rate).expect("汇率应可解析");
        let amount = case.amount_minor.parse::<i64>().expect("金额应为 i64");
        let expected = case
            .expected_base_minor
            .parse::<i64>()
            .expect("期望金额应为 i64");

        assert_eq!(
            rate.convert_minor(amount, &original, &base)
                .expect("golden 换算应成功"),
            expected
        );
    }
}

#[test]
fn conversion_rejects_intermediate_or_result_overflow() {
    let rate = ExchangeRate::parse("99999999999999999999").expect("大汇率仍可精确解析");
    let usd = Currency::parse("USD").expect("USD 应受支持");
    let cny = Currency::parse("CNY").expect("CNY 应受支持");

    assert!(rate.convert_minor(i64::MAX, &usd, &cny).is_err());
}
