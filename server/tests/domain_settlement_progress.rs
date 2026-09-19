use huddletab_server::domain::{
    ledger::{LedgerEntry, SettlementFact},
    settlement_progress::{
        BalanceType, ExpenseSettlementStatus, MemberSettlementStatus, calculate_expense_progress,
        direct_allocation_capacity,
    },
};
use uuid::Uuid;

#[test]
fn direct_allocation_tracks_payer_and_payee_without_double_counting() {
    let a = Uuid::from_u128(1);
    let b = Uuid::from_u128(2);
    let c = Uuid::from_u128(3);
    let d = Uuid::from_u128(4);
    let progress = calculate_expense_progress(
        vec![a, b, c, d],
        vec![LedgerEntry::new(a, 1_200)],
        vec![
            LedgerEntry::new(a, 300),
            LedgerEntry::new(b, 300),
            LedgerEntry::new(c, 300),
            LedgerEntry::new(d, 300),
        ],
        vec![SettlementFact::new(b, a, 100)],
    )
    .expect("局部账务应守恒");

    assert_eq!(progress.status, ExpenseSettlementStatus::PartiallySettled);
    assert_eq!(progress.total_required_minor, 900);
    assert_eq!(progress.settled_minor, 100);
    assert_eq!(progress.remaining_minor, 800);
    let payer = progress
        .members
        .iter()
        .find(|member| member.member_id == b)
        .expect("付款成员应存在");
    assert_eq!(payer.balance_type, BalanceType::Payable);
    assert_eq!(payer.status, MemberSettlementStatus::PartiallySettled);
    assert_eq!(payer.remaining_minor, 200);
    let receiver = progress
        .members
        .iter()
        .find(|member| member.member_id == a)
        .expect("收款成员应存在");
    assert_eq!(receiver.balance_type, BalanceType::Receivable);
    assert_eq!(receiver.remaining_minor, 800);
    assert_eq!(direct_allocation_capacity(&progress, b, a), 200);
}

#[test]
fn no_settlement_required_is_distinct_from_settled() {
    let member = Uuid::from_u128(1);
    let progress = calculate_expense_progress(
        vec![member],
        vec![LedgerEntry::new(member, 300)],
        vec![LedgerEntry::new(member, 300)],
        Vec::new(),
    )
    .expect("单成员账单应守恒");

    assert_eq!(
        progress.status,
        ExpenseSettlementStatus::NoSettlementRequired
    );
    assert_eq!(progress.total_required_minor, 0);
    assert!(progress.members.is_empty());
}

#[test]
fn multiple_payments_and_shares_keep_direct_capacity_local() {
    let payer_a = Uuid::from_u128(1);
    let payer_b = Uuid::from_u128(2);
    let receiver = Uuid::from_u128(3);
    let progress = calculate_expense_progress(
        vec![payer_a, payer_b, receiver],
        vec![
            LedgerEntry::new(payer_a, 100),
            LedgerEntry::new(payer_b, 100),
        ],
        vec![LedgerEntry::new(receiver, 200)],
        vec![SettlementFact::new(receiver, payer_a, 100)],
    )
    .expect("多付款人账单应守恒");

    assert_eq!(progress.status, ExpenseSettlementStatus::PartiallySettled);
    assert_eq!(direct_allocation_capacity(&progress, receiver, payer_a), 0);
    assert_eq!(direct_allocation_capacity(&progress, payer_b, payer_a), 0);
}
