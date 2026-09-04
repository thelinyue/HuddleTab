use huddletab_server::domain::activity::{
    ActivityAction, ActivityCapabilities, ActivityPeriod, ActivityStatus, InviteMode,
    normalize_activity_location,
};

#[test]
fn invite_mode_accepts_only_the_activity_level_contract() {
    assert_eq!(InviteMode::parse("DIRECT_JOIN"), Ok(InviteMode::DirectJoin));
    assert_eq!(
        InviteMode::parse("REQUIRE_APPROVAL"),
        Ok(InviteMode::RequireApproval)
    );
    assert!(InviteMode::parse("PER_INVITE").is_err());
    assert_eq!(InviteMode::DirectJoin.as_str(), "DIRECT_JOIN");
    assert_eq!(InviteMode::RequireApproval.as_str(), "REQUIRE_APPROVAL");
}

#[test]
fn activity_location_and_period_reject_invalid_details() {
    assert_eq!(
        normalize_activity_location("  Shanghai  ").expect("合法地点应被规范化"),
        Some("Shanghai".to_owned())
    );
    assert_eq!(
        normalize_activity_location("   ").expect("空地点应转换为 NULL"),
        None
    );
    assert!(normalize_activity_location(&"地".repeat(121)).is_err());

    let period =
        ActivityPeriod::parse("2026-09-01", Some("2026-09-03")).expect("合法日期区间应通过");
    assert_eq!(period.start_date().to_string(), "2026-09-01");
    assert_eq!(
        period.end_date().expect("应保留结束日期").to_string(),
        "2026-09-03"
    );
    assert!(ActivityPeriod::parse("2026-09-03", Some("2026-09-01")).is_err());
    assert!(ActivityPeriod::parse("2026-02-30", None).is_err());
}

#[test]
fn activity_status_only_allows_the_frozen_transition_matrix() {
    let allowed = [
        (
            ActivityStatus::Active,
            ActivityAction::End,
            ActivityStatus::Ended,
        ),
        (
            ActivityStatus::Ended,
            ActivityAction::Reopen,
            ActivityStatus::Active,
        ),
        (
            ActivityStatus::Ended,
            ActivityAction::Archive,
            ActivityStatus::Archived,
        ),
        (
            ActivityStatus::Archived,
            ActivityAction::Unarchive,
            ActivityStatus::Ended,
        ),
    ];
    for (from, action, expected) in allowed {
        assert_eq!(from.transition(action), Some(expected));
    }

    for status in [
        ActivityStatus::Active,
        ActivityStatus::Ended,
        ActivityStatus::Archived,
    ] {
        for action in [
            ActivityAction::End,
            ActivityAction::Reopen,
            ActivityAction::Archive,
            ActivityAction::Unarchive,
        ] {
            if !allowed
                .iter()
                .any(|(from, candidate, _)| *from == status && *candidate == action)
            {
                assert_eq!(status.transition(action), None);
            }
        }
    }
}

#[test]
fn activity_capabilities_follow_role_lifecycle_and_accounting_facts() {
    let active = ActivityCapabilities::for_actor(true, ActivityStatus::Active, false, false);
    assert!(active.fields.name);
    assert!(active.fields.location);
    assert!(active.fields.base_currency);
    assert!(active.fields.start_date);
    assert!(active.fields.end_date);
    assert!(active.fields.invite_mode);
    assert_eq!(active.lifecycle_actions, vec![ActivityAction::End]);
    assert!(active.can_delete);
    assert!(!active.can_restore);

    let active_with_accounting =
        ActivityCapabilities::for_actor(true, ActivityStatus::Active, true, false);
    assert!(!active_with_accounting.fields.base_currency);

    let ended = ActivityCapabilities::for_actor(true, ActivityStatus::Ended, true, false);
    assert!(!ended.fields.name);
    assert!(!ended.fields.location);
    assert!(!ended.fields.base_currency);
    assert!(!ended.fields.start_date);
    assert!(!ended.fields.end_date);
    assert!(!ended.fields.invite_mode);
    assert_eq!(
        ended.lifecycle_actions,
        vec![ActivityAction::Reopen, ActivityAction::Archive]
    );

    let archived = ActivityCapabilities::for_actor(true, ActivityStatus::Archived, true, false);
    assert_eq!(archived.lifecycle_actions, vec![ActivityAction::Unarchive]);
    assert!(!archived.fields.name);

    let member = ActivityCapabilities::for_actor(false, ActivityStatus::Active, false, false);
    assert!(member.lifecycle_actions.is_empty());
    assert!(!member.can_delete);
    assert!(!member.fields.name);
    assert!(!member.fields.invite_mode);

    let deleted = ActivityCapabilities::for_actor(true, ActivityStatus::Ended, true, true);
    assert!(deleted.lifecycle_actions.is_empty());
    assert!(!deleted.can_delete);
    assert!(deleted.can_restore);
    assert!(!deleted.fields.name);
}
