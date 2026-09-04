use huddletab_server::domain::{currency::Currency, money::Money};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrencyVectors {
    currencies: Vec<CurrencyCase>,
    invalid_currencies: Vec<String>,
    amounts: Vec<AmountCase>,
    invalid_amounts: Vec<String>,
}

#[derive(Deserialize)]
struct CurrencyCase {
    input: String,
    code: String,
    exponent: u8,
}

#[derive(Deserialize)]
struct AmountCase {
    input: String,
    value: String,
}

fn vectors() -> CurrencyVectors {
    serde_json::from_str(include_str!("../../golden/currency.json"))
        .expect("currency golden vectors 应为合法 JSON")
}

#[test]
fn currencies_normalize_and_use_frozen_minor_unit_exponents() {
    let vectors = vectors();

    for case in vectors.currencies {
        let currency = Currency::parse(&case.input).expect("golden 币种应可解析");
        assert_eq!(currency.code(), case.code);
        assert_eq!(currency.exponent(), case.exponent);
    }

    for input in vectors.invalid_currencies {
        assert!(Currency::parse(&input).is_err(), "应拒绝币种 {input:?}");
    }
}

#[test]
fn api_minor_amounts_are_canonical_i64_strings() {
    let vectors = vectors();
    let cny = Currency::parse("CNY").expect("CNY 应受支持");

    for case in vectors.amounts {
        let expected = case.value.parse::<i64>().expect("golden value 应为 i64");
        let money = Money::from_api(cny.clone(), &case.input).expect("golden 金额应可解析");
        assert_eq!(money.amount_minor(), expected);
        assert_eq!(money.to_api_amount(), case.value);
    }

    for input in vectors.invalid_amounts {
        assert!(
            Money::from_api(cny.clone(), &input).is_err(),
            "应拒绝金额 {input:?}"
        );
    }
}

#[test]
fn money_addition_rejects_currency_mismatch_and_overflow() {
    let cny = Currency::parse("CNY").expect("CNY 应受支持");
    let usd = Currency::parse("USD").expect("USD 应受支持");
    let one_cny = Money::new(cny.clone(), 1);

    assert_eq!(
        one_cny
            .checked_add(&Money::new(cny.clone(), 2))
            .expect("同币种金额应可相加")
            .amount_minor(),
        3
    );
    assert!(one_cny.checked_add(&Money::new(usd, 1)).is_err());
    assert!(Money::new(cny, i64::MAX).checked_add(&one_cny).is_err());
}
