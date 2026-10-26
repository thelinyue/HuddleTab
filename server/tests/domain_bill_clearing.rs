use huddletab_server::domain::bill_clearing::ClearingState;
use uuid::Uuid;

fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}
fn state(bills: &[(u128, u128, u128, i64)]) -> ClearingState {
    let mut state = ClearingState::default();
    for &(expense, debtor, creditor, amount) in bills {
        if !state.expense_order.contains(&id(expense)) {
            state.expense_order.push(id(expense));
        }
        *state.original.entry((id(expense), id(debtor))).or_default() -= amount;
        *state
            .original
            .entry((id(expense), id(creditor)))
            .or_default() += amount;
    }
    state.remaining.clone_from(&state.original);
    state
}
fn conserved(state: &ClearingState) {
    for expense in &state.expense_order {
        assert_eq!(
            state
                .remaining
                .iter()
                .filter(|((e, _), _)| e == expense)
                .map(|(_, amount)| amount)
                .sum::<i64>(),
            0
        );
    }
}

#[test]
fn cash_breakdown_splits_70_as_30_plus_40_without_counting_both_sides() {
    let mut state = state(&[(10, 1, 2, 3000), (20, 1, 2, 6000), (30, 3, 2, 16600)]);
    state
        .transfer(
            id(100),
            id(1),
            id(2),
            7000,
            &[id(10), id(20), id(30)],
            "AUTO",
        )
        .unwrap();
    assert_eq!(
        state.cash_applications[&id(100)],
        [(vec![id(10)], 3000), (vec![id(20)], 4000)].into()
    );
    assert_eq!(
        state.cash_applications[&id(100)].values().sum::<i64>(),
        7000
    );
    conserved(&state);
}

#[test]
fn cash_breakdown_counts_a_cross_bill_path_only_once() {
    let mut state = state(&[(10, 1, 2, 7000), (20, 2, 3, 7000), (30, 3, 4, 7000)]);
    state
        .transfer(
            id(100),
            id(1),
            id(4),
            7000,
            &[id(10), id(20), id(30)],
            "AUTO",
        )
        .unwrap();
    assert_eq!(
        state.cash_applications[&id(100)],
        [(vec![id(10), id(20), id(30)], 7000)].into()
    );
    conserved(&state);
}

#[test]
fn cash_breakdown_keeps_collection_and_forwarding_even_without_original_member_position() {
    let mut state = state(&[(10, 1, 2, 7000)]);
    state
        .transfer(id(100), id(1), id(3), 7000, &[id(10)], "AUTO")
        .unwrap();
    state
        .transfer(id(101), id(3), id(2), 7000, &[id(10)], "AUTO")
        .unwrap();
    for transfer in [100, 101] {
        assert_eq!(
            state.cash_applications[&id(transfer)],
            [(vec![id(10)], 7000)].into()
        );
    }
    conserved(&state);
}

#[test]
fn cash_breakdown_combines_explicit_and_auto_without_double_counting() {
    let mut state = state(&[(10, 1, 2, 7000)]);
    state
        .transfer(
            id(100),
            id(1),
            id(2),
            3000,
            &[id(10)],
            "HISTORICAL_EXPLICIT",
        )
        .unwrap();
    state
        .transfer(id(100), id(1), id(2), 4000, &[id(10)], "AUTO")
        .unwrap();
    assert_eq!(
        state.cash_applications[&id(100)],
        [(vec![id(10)], 7000)].into()
    );
}

#[test]
fn cash_breakdown_retains_unassigned_cash_instead_of_inventing_a_bill() {
    let mut state = state(&[(10, 1, 2, 3000)]);
    state
        .transfer(id(100), id(1), id(2), 7000, &[id(10)], "AUTO")
        .unwrap();
    assert_eq!(
        state.cash_applications[&id(100)],
        [(vec![], 4000), (vec![id(10)], 3000)].into()
    );
    let mut empty = ClearingState::default();
    empty
        .transfer(id(100), id(1), id(2), 7000, &[], "AUTO")
        .unwrap();
    assert_eq!(empty.cash_applications[&id(100)], [(vec![], 7000)].into());
}

#[test]
fn cash_breakdown_does_not_shrink_when_display_progress_is_clipped_by_later_transfers() {
    let mut state = state(&[(10, 1, 2, 7000)]);
    state
        .transfer(id(100), id(1), id(2), 7000, &[id(10)], "AUTO")
        .unwrap();
    state
        .transfer(id(101), id(2), id(1), 7000, &[id(10)], "AUTO")
        .unwrap();
    assert!(state.display_entries().is_empty());
    assert_eq!(
        state.cash_applications[&id(100)].values().sum::<i64>(),
        7000
    );
    assert_eq!(
        state.cash_applications[&id(101)].values().sum::<i64>(),
        7000
    );
}

fn current_balances(state: &ClearingState) -> Vec<(Uuid, i64)> {
    state
        .current_settlement(id(10), [id(1), id(2), id(3)])
        .unwrap()
        .members
        .into_iter()
        .map(|balance| (balance.member_id(), balance.net_minor()))
        .collect()
}

#[test]
fn current_settlement_replays_price_and_payer_changes_without_clipping_debt() {
    let mut original = state(&[(10, 2, 1, 5000)]);
    original
        .transfer(id(100), id(2), id(1), 5000, &[id(10)], "AUTO")
        .unwrap();
    assert_eq!(
        original
            .current_settlement(id(10), [id(1), id(2)])
            .unwrap()
            .remaining_minor,
        0
    );

    let mut increased = state(&[(10, 2, 1, 10000)]);
    increased
        .transfer(id(100), id(2), id(1), 5000, &[id(10)], "AUTO")
        .unwrap();
    assert_eq!(
        current_balances(&increased),
        vec![(id(1), 5000), (id(2), -5000), (id(3), 0)]
    );

    let mut corrected = state(&[(10, 1, 3, 10000), (10, 2, 3, 10000)]);
    corrected
        .transfer(id(100), id(2), id(1), 5000, &[id(10)], "AUTO")
        .unwrap();
    assert_eq!(
        current_balances(&corrected),
        vec![(id(1), -15000), (id(2), -5000), (id(3), 20000)]
    );
    assert_eq!(
        corrected
            .current_settlement(id(10), [])
            .unwrap()
            .remaining_minor,
        20000
    );
    corrected
        .transfer(id(101), id(1), id(3), 15000, &[id(10)], "AUTO")
        .unwrap();
    corrected
        .transfer(id(102), id(2), id(3), 5000, &[id(10)], "AUTO")
        .unwrap();
    assert_eq!(
        current_balances(&corrected),
        vec![(id(1), 0), (id(2), 0), (id(3), 0)]
    );
    assert_eq!(
        corrected
            .current_settlement(id(10), [])
            .unwrap()
            .remaining_minor,
        0
    );
}

#[test]
fn current_settlement_includes_collection_member_and_refund_direction() {
    let mut collected = state(&[(10, 2, 1, 5000)]);
    collected
        .transfer(id(100), id(2), id(3), 5000, &[id(10)], "AUTO")
        .unwrap();
    let result = collected
        .current_settlement(id(10), [id(1), id(2)])
        .unwrap();
    assert_eq!(result.members.len(), 3);
    assert_eq!(
        current_balances(&collected),
        vec![(id(1), 5000), (id(2), 0), (id(3), -5000)]
    );

    let mut reduced = state(&[(10, 2, 1, 3000)]);
    reduced
        .transfer(id(100), id(2), id(1), 5000, &[id(10)], "AUTO")
        .unwrap();
    assert_eq!(
        current_balances(&reduced),
        vec![(id(1), -2000), (id(2), 2000), (id(3), 0)]
    );
    assert_eq!(
        reduced
            .current_settlement(id(10), [])
            .unwrap()
            .remaining_minor,
        2000
    );
}

#[test]
fn one_day_is_100_and_combined_days_are_60_without_mutating_preview() {
    let state = state(&[(10, 1, 2, 100), (20, 2, 1, 40)]);
    assert_eq!(state.balances(&[id(10)]).unwrap()[&id(1)], -100);
    assert_eq!(state.balances(&[id(10), id(20)]).unwrap()[&id(1)], -60);
    let mut preview = state.clone();
    assert_eq!(preview.offsets(&[id(10), id(20)], "AUTO").unwrap(), 80);
    assert!(state.entries.is_empty());
}

#[test]
fn selected_payment_cannot_clear_an_unselected_day() {
    let mut state = state(&[(10, 1, 2, 100), (20, 2, 1, 40)]);
    state
        .transfer(id(100), id(1), id(2), 100, &[id(10)], "AUTO")
        .unwrap();
    state.offsets(&[id(10)], "AUTO").unwrap();
    assert_eq!(state.balances(&[id(20)]).unwrap()[&id(1)], 40);
    assert!(state.balances(&[id(10)]).unwrap().values().all(|n| *n == 0));
    assert!(
        state
            .display_entries()
            .iter()
            .all(|entry| entry.expense_id == id(10))
    );
    conserved(&state);
}

#[test]
fn cash_and_offset_finish_combined_days() {
    let mut state = state(&[(10, 1, 2, 100), (20, 2, 1, 40)]);
    state
        .transfer(id(100), id(1), id(2), 60, &[id(10), id(20)], "AUTO")
        .unwrap();
    state.offsets(&[id(10), id(20)], "AUTO").unwrap();
    assert!(state.remaining.values().all(|n| *n == 0));
    assert_eq!(
        state
            .display_entries()
            .iter()
            .filter(|e| e.settlement_id.is_some())
            .map(|e| e.amount_minor)
            .sum::<i64>(),
        120
    );
    conserved(&state);
}

#[test]
fn partial_cross_bill_cash_keeps_each_bill_balanced() {
    let mut state = state(&[(10, 1, 2, 100), (20, 2, 3, 100)]);
    state
        .transfer(id(100), id(1), id(3), 60, &[id(10), id(20)], "AUTO")
        .unwrap();
    assert_eq!(state.balances(&[id(10)]).unwrap()[&id(1)], -40);
    assert_eq!(state.balances(&[id(20)]).unwrap()[&id(3)], 40);
    assert_eq!(
        state
            .display_entries()
            .iter()
            .filter(|entry| entry.settlement_id.is_none())
            .count(),
        2
    );
    conserved(&state);
}

#[test]
fn hub_retains_pending_outgoing_after_collecting_money() {
    let mut state = state(&[(10, 1, 2, 100)]);
    state
        .transfer(id(100), id(1), id(3), 100, &[id(10)], "AUTO")
        .unwrap();
    let balances = state.balances(&[id(10)]).unwrap();
    assert_eq!(balances[&id(1)], 0);
    assert_eq!(balances[&id(3)], -100);
    assert_eq!(balances[&id(2)], 100);
    conserved(&state);
    state
        .transfer(id(101), id(3), id(2), 100, &[id(10)], "AUTO")
        .unwrap();
    assert!(state.remaining.values().all(|n| *n == 0));
    assert_eq!(state.display_entries().len(), 2);
    conserved(&state);
}

#[test]
fn zero_cash_cycle_requires_explicit_offset_application() {
    let mut state = state(&[(10, 1, 2, 100), (20, 2, 3, 100), (30, 3, 1, 100)]);
    let scope = [id(10), id(20), id(30)];
    assert!(state.balances(&scope).unwrap().values().all(|n| *n == 0));
    assert!(state.entries.is_empty());
    assert_eq!(state.offsets(&scope, "AUTO").unwrap(), 300);
    assert!(state.remaining.values().all(|n| *n == 0));
    assert_eq!(state.offsets(&scope, "AUTO").unwrap(), 0);
    conserved(&state);
}

#[test]
fn historical_payment_does_not_confirm_unrelated_offsets() {
    let mut state = state(&[
        (10, 1, 2, 100),
        (20, 2, 1, 40),
        (30, 3, 4, 70),
        (40, 4, 3, 70),
    ]);
    let scope = state.expense_order.clone();
    state
        .transfer(id(100), id(1), id(2), 60, &scope, "HISTORICAL_AUTO")
        .unwrap();
    state
        .offsets_touching(&scope, "HISTORICAL_AUTO", &[id(1), id(2)])
        .unwrap();
    assert_eq!(state.remaining[&(id(30), id(3))], -70);
    assert_eq!(state.remaining[&(id(10), id(1))], 0);
    conserved(&state);
}

#[test]
fn unallocated_cash_can_be_refunded_or_explicitly_applied_to_later_bills() {
    let mut cleared = ClearingState::default();
    cleared
        .transfer(id(100), id(1), id(2), 100, &[], "AUTO")
        .unwrap();
    let cash_scope = cleared.scope_with_cash(&[]);
    assert_eq!(cleared.balances(&cash_scope).unwrap()[&id(1)], 100);
    let mut refund = cleared.clone();
    refund
        .transfer(id(101), id(2), id(1), 100, &cash_scope, "AUTO")
        .unwrap();
    assert!(refund.remaining.values().all(|n| *n == 0));
    let bill = state(&[(10, 1, 2, 100)]);
    cleared.original.extend(bill.original);
    cleared.remaining.extend(bill.remaining);
    cleared.expense_order.push(id(10));
    assert_eq!(cleared.balances(&[id(10)]).unwrap()[&id(1)], -100);
    let scope = cleared.scope_with_cash(&[id(10)]);
    assert!(cleared.balances(&scope).unwrap().values().all(|n| *n == 0));
    cleared.offsets(&scope, "AUTO").unwrap();
    assert!(cleared.remaining.values().all(|n| *n == 0));
    assert!(
        cleared
            .display_entries()
            .iter()
            .all(|e| e.settlement_id == Some(id(100)))
    );
    conserved(&cleared);
}
