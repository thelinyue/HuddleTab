use huddletab_server::domain::{
    ledger::{LedgerEntry, SettlementFact, calculate_ledger},
    settlement::{
        RecommendationStrategy, recommend_settlements, recommend_settlements_with_strategy,
    },
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

#[test]
fn centralized_recommendations_route_every_non_hub_member_through_hub() {
    let owner = Uuid::from_u128(1);
    let payer = Uuid::from_u128(2);
    let guest_a = Uuid::from_u128(3);
    let guest_b = Uuid::from_u128(4);
    let balances = [
        huddletab_server::domain::ledger::Balance::new(owner, 0),
        huddletab_server::domain::ledger::Balance::new(payer, 100),
        huddletab_server::domain::ledger::Balance::new(guest_a, -50),
        huddletab_server::domain::ledger::Balance::new(guest_b, -50),
    ];

    let recommendations = recommend_settlements_with_strategy(
        &balances,
        RecommendationStrategy::Centralized {
            hub_member_id: owner,
        },
    )
    .expect("统一结算应生成推荐");

    assert_eq!(recommendations.len(), 3);
    assert_eq!(
        recommendations
            .iter()
            .map(|item| (
                item.payer_member_id(),
                item.receiver_member_id(),
                item.amount_minor()
            ))
            .collect::<Vec<_>>(),
        vec![
            (guest_a, owner, 50),
            (guest_b, owner, 50),
            (owner, payer, 100)
        ]
    );
}

#[test]
fn centralized_recommendations_preserve_amount_and_handle_hub_direction() {
    let hub = Uuid::from_u128(1);
    let member = Uuid::from_u128(2);
    let balances = [
        huddletab_server::domain::ledger::Balance::new(hub, 80),
        huddletab_server::domain::ledger::Balance::new(member, -80),
    ];
    let recommendations = recommend_settlements_with_strategy(
        &balances,
        RecommendationStrategy::Centralized { hub_member_id: hub },
    )
    .expect("hub 应付时仍应生成统一结算推荐");
    assert_eq!(recommendations.len(), 1);
    assert_eq!(recommendations[0].payer_member_id(), member);
    assert_eq!(recommendations[0].receiver_member_id(), hub);
    assert_eq!(recommendations[0].amount_minor(), 80);

    let mut remaining = balances
        .iter()
        .map(|balance| (balance.member_id(), balance.net_minor()))
        .collect::<BTreeMap<_, _>>();
    for recommendation in recommendations {
        *remaining
            .get_mut(&recommendation.payer_member_id())
            .unwrap() += recommendation.amount_minor();
        *remaining
            .get_mut(&recommendation.receiver_member_id())
            .unwrap() -= recommendation.amount_minor();
    }
    assert!(remaining.values().all(|balance| *balance == 0));

    let hub_owes = [
        huddletab_server::domain::ledger::Balance::new(hub, -80),
        huddletab_server::domain::ledger::Balance::new(member, 80),
    ];
    let recommendations = recommend_settlements_with_strategy(
        &hub_owes,
        RecommendationStrategy::Centralized { hub_member_id: hub },
    )
    .expect("hub 应付时仍应生成统一结算推荐");
    assert_eq!(recommendations[0].payer_member_id(), hub);
    assert_eq!(recommendations[0].receiver_member_id(), member);
}

#[test]
fn centralized_skips_zero_balances_and_rejects_unknown_hub() {
    let hub = Uuid::from_u128(1);
    let member = Uuid::from_u128(2);
    let balances = [
        huddletab_server::domain::ledger::Balance::new(hub, 0),
        huddletab_server::domain::ledger::Balance::new(member, 0),
    ];
    assert!(
        recommend_settlements_with_strategy(
            &balances,
            RecommendationStrategy::Centralized { hub_member_id: hub },
        )
        .expect("全额结清应成功")
        .is_empty()
    );
    assert!(
        recommend_settlements_with_strategy(
            &balances,
            RecommendationStrategy::Centralized {
                hub_member_id: Uuid::from_u128(99),
            },
        )
        .is_err()
    );
}

#[test]
fn recommendations_after_partial_settlement_only_include_remaining_amount() {
    let hub = Uuid::from_u128(1);
    let debtor = Uuid::from_u128(2);
    let balances = calculate_ledger(
        vec![hub, debtor],
        vec![LedgerEntry::new(hub, 100)],
        vec![LedgerEntry::new(debtor, 100)],
        vec![SettlementFact::new(debtor, hub, 40)],
    )
    .expect("部分结算后的账务事实应可计算");
    let recommendations = recommend_settlements_with_strategy(
        &balances,
        RecommendationStrategy::Centralized { hub_member_id: hub },
    )
    .expect("部分结算后应重新生成推荐");

    assert_eq!(recommendations.len(), 1);
    assert_eq!(recommendations[0].payer_member_id(), debtor);
    assert_eq!(recommendations[0].receiver_member_id(), hub);
    assert_eq!(recommendations[0].amount_minor(), 60);
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
