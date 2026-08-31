use huddletab_server::domain::splitting::{
    Allocation, exact, percentage, proportional, split_equal, weight,
};
use serde::Deserialize;
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vectors {
    members: BTreeMap<String, Uuid>,
    equal: EqualCase,
    exact: ShareCase,
    percentage: ShareCase,
    weight: ShareCase,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EqualCase {
    total_minor: String,
    input_order: Vec<String>,
    expected: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareCase {
    total_minor: String,
    shares: BTreeMap<String, String>,
    expected: BTreeMap<String, String>,
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("../../golden/splitting.json"))
        .expect("splitting golden vectors 应为合法 JSON")
}

#[test]
fn four_split_modes_conserve_and_follow_uuid_remainder_order() {
    let vectors = vectors();

    let equal_members = vectors
        .equal
        .input_order
        .iter()
        .map(|name| vectors.members[name])
        .collect();
    let equal_result =
        split_equal(parse_amount(&vectors.equal.total_minor), equal_members).expect("均摊应成功");
    assert_allocations(&equal_result, &vectors.equal.expected, &vectors.members);

    let exact_result = exact(
        parse_amount(&vectors.exact.total_minor),
        amount_inputs(&vectors.exact, &vectors.members),
    )
    .expect("精确分摊应成功");
    assert_allocations(&exact_result, &vectors.exact.expected, &vectors.members);

    let percentage_result = percentage(
        parse_amount(&vectors.percentage.total_minor),
        string_inputs(&vectors.percentage, &vectors.members),
    )
    .expect("百分比分摊应成功");
    assert_allocations(
        &percentage_result,
        &vectors.percentage.expected,
        &vectors.members,
    );

    let weight_result = weight(
        parse_amount(&vectors.weight.total_minor),
        amount_inputs(&vectors.weight, &vectors.members),
    )
    .expect("权重分摊应成功");
    assert_allocations(&weight_result, &vectors.weight.expected, &vectors.members);
}

#[test]
fn split_modes_reject_duplicates_invalid_totals_and_non_conservation() {
    let member = Uuid::from_u128(1);
    assert!(split_equal(10, vec![]).is_err());
    assert!(split_equal(0, vec![member]).is_err());
    assert!(split_equal(10, vec![member, member]).is_err());
    assert!(exact(10, vec![(member, 9)]).is_err());
    assert!(percentage(10, vec![(member, "99.99".to_owned())]).is_err());
    assert!(weight(10, vec![(member, 0)]).is_err());
}

#[test]
fn proportional_allocation_is_available_for_payment_and_base_amount_facts() {
    let a = Uuid::from_u128(1);
    let b = Uuid::from_u128(2);
    let allocations = proportional(7, vec![(b, 1), (a, 1)]).expect("按比例分配应成功");

    assert_eq!(
        allocations,
        vec![Allocation::new(a, 4), Allocation::new(b, 3)]
    );
}

fn parse_amount(input: &str) -> i64 {
    input.parse().expect("golden 金额应为 i64")
}

fn amount_inputs(case: &ShareCase, members: &BTreeMap<String, Uuid>) -> Vec<(Uuid, i64)> {
    case.shares
        .iter()
        .map(|(name, amount)| (members[name], parse_amount(amount)))
        .collect()
}

fn string_inputs(case: &ShareCase, members: &BTreeMap<String, Uuid>) -> Vec<(Uuid, String)> {
    case.shares
        .iter()
        .map(|(name, amount)| (members[name], amount.clone()))
        .collect()
}

fn assert_allocations(
    actual: &[Allocation],
    expected: &BTreeMap<String, String>,
    members: &BTreeMap<String, Uuid>,
) {
    assert_eq!(actual.iter().map(Allocation::amount_minor).sum::<i64>(), 10);
    for (name, amount) in expected {
        assert_eq!(
            actual
                .iter()
                .find(|allocation| allocation.member_id() == members[name])
                .expect("期望成员应存在")
                .amount_minor(),
            parse_amount(amount)
        );
    }
}
