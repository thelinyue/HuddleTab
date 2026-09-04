use huddletab_server::domain::splitting::split_equal;
use proptest::prelude::*;
use uuid::Uuid;

proptest! {
    #[test]
    fn equal_split_always_conserves_and_is_uuid_sorted(
        total in 1_i64..1_000_000_000,
        member_count in 1_u128..50,
    ) {
        let mut members = (1..=member_count)
            .rev()
            .map(Uuid::from_u128)
            .collect::<Vec<_>>();
        let allocations = split_equal(total, members.clone()).expect("合法均摊应成功");

        prop_assert_eq!(
            allocations
                .iter()
                .map(huddletab_server::domain::splitting::Allocation::amount_minor)
                .sum::<i64>(),
            total
        );
        prop_assert!(allocations.windows(2).all(|pair| pair[0].member_id() < pair[1].member_id()));

        members.rotate_left(1);
        let reordered = split_equal(total, members).expect("输入顺序不应影响均摊");
        prop_assert_eq!(allocations, reordered);
    }
}
