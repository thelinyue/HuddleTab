use huddletab_server::domain::{
    ledger::{LedgerEntry, SettlementFact, calculate_ledger},
    settlement::recommend_settlements,
};
use serde::Deserialize;
use std::collections::BTreeMap;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vectors {
    members: BTreeMap<String, Uuid>,
    payments: BTreeMap<String, String>,
    shares: BTreeMap<String, String>,
    settlements: Vec<Transfer>,
    expected_balances: BTreeMap<String, String>,
    expected_recommendations: Vec<Transfer>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Transfer {
    payer: String,
    receiver: String,
    amount_minor: String,
}

fn vectors() -> Vectors {
    serde_json::from_str(include_str!("../../golden/accounting.json"))
        .expect("accounting golden vectors 应为合法 JSON")
}

#[test]
fn ledger_uses_base_facts_and_outgoing_settlement_reduces_debt() {
    let vectors = vectors();
    let balances = calculate_ledger(
        vectors.members.values().copied().rev().collect(),
        entries(&vectors.payments, &vectors.members),
        entries(&vectors.shares, &vectors.members),
        transfers(&vectors.settlements, &vectors.members),
    )
    .expect("守恒账务事实应生成 Ledger");

    assert_eq!(
        balances
            .iter()
            .map(huddletab_server::domain::ledger::Balance::net_minor)
            .sum::<i64>(),
        0
    );
    for (name, expected) in vectors.expected_balances {
        assert_eq!(
            balances
                .iter()
                .find(|balance| balance.member_id() == vectors.members[&name])
                .expect("成员余额应存在")
                .net_minor(),
            amount(&expected)
        );
    }
}

#[test]
fn recommendations_match_largest_balances_and_are_deterministic() {
    let vectors = vectors();
    let balances = calculate_ledger(
        vectors.members.values().copied().collect(),
        entries(&vectors.payments, &vectors.members),
        entries(&vectors.shares, &vectors.members),
        transfers(&vectors.settlements, &vectors.members),
    )
    .expect("守恒账务事实应生成 Ledger");
    let recommendations = recommend_settlements(&balances).expect("零和余额应可推荐结算");

    assert_eq!(
        recommendations.len(),
        vectors.expected_recommendations.len()
    );
    for (actual, expected) in recommendations.iter().zip(vectors.expected_recommendations) {
        assert_eq!(actual.payer_member_id(), vectors.members[&expected.payer]);
        assert_eq!(
            actual.receiver_member_id(),
            vectors.members[&expected.receiver]
        );
        assert_eq!(actual.amount_minor(), amount(&expected.amount_minor));
    }
}

#[test]
fn ledger_rejects_unknown_members_and_unbalanced_facts() {
    let a = Uuid::from_u128(1);
    let b = Uuid::from_u128(2);

    assert!(calculate_ledger(vec![a], vec![LedgerEntry::new(b, 1)], vec![], vec![]).is_err());
    assert!(
        calculate_ledger(
            vec![a, b],
            vec![LedgerEntry::new(a, 2)],
            vec![LedgerEntry::new(b, 1)],
            vec![]
        )
        .is_err()
    );
    assert!(
        calculate_ledger(
            vec![a, b],
            vec![LedgerEntry::new(a, 1)],
            vec![LedgerEntry::new(b, 1)],
            vec![SettlementFact::new(a, a, 1)]
        )
        .is_err()
    );
}

fn entries(
    values: &BTreeMap<String, String>,
    members: &BTreeMap<String, Uuid>,
) -> Vec<LedgerEntry> {
    values
        .iter()
        .map(|(name, value)| LedgerEntry::new(members[name], amount(value)))
        .collect()
}

fn transfers(values: &[Transfer], members: &BTreeMap<String, Uuid>) -> Vec<SettlementFact> {
    values
        .iter()
        .map(|transfer| {
            SettlementFact::new(
                members[&transfer.payer],
                members[&transfer.receiver],
                amount(&transfer.amount_minor),
            )
        })
        .collect()
}

fn amount(input: &str) -> i64 {
    input.parse().expect("golden 金额应为 i64")
}
