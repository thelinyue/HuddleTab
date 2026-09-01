use huddletab_server::domain::join_request::{
    DecisionEffect, JoinDecision, JoinRequestStatus, JoinRequestTransitionError,
};

#[test]
fn pending_decision_applies_and_repeated_same_decision_replays() {
    assert_eq!(
        JoinRequestStatus::Pending.decide(JoinDecision::Approve),
        Ok(DecisionEffect::Apply(JoinRequestStatus::Approved))
    );
    assert_eq!(
        JoinRequestStatus::Approved.decide(JoinDecision::Approve),
        Ok(DecisionEffect::Replay)
    );
    assert_eq!(
        JoinRequestStatus::Rejected.decide(JoinDecision::Reject),
        Ok(DecisionEffect::Replay)
    );
}

#[test]
fn a_closed_request_rejects_the_opposite_decision() {
    assert_eq!(
        JoinRequestStatus::Approved.decide(JoinDecision::Reject),
        Err(JoinRequestTransitionError::Closed)
    );
    assert_eq!(
        JoinRequestStatus::Rejected.decide(JoinDecision::Approve),
        Err(JoinRequestTransitionError::Closed)
    );
}

#[test]
fn join_request_values_reject_unknown_database_text() {
    assert_eq!(JoinDecision::parse("APPROVE"), Ok(JoinDecision::Approve));
    assert_eq!(JoinDecision::parse("REJECT"), Ok(JoinDecision::Reject));
    assert!(JoinDecision::parse("COMMENT").is_err());
    assert_eq!(
        JoinRequestStatus::parse("PENDING"),
        Ok(JoinRequestStatus::Pending)
    );
    assert!(JoinRequestStatus::parse("CANCELLED").is_err());
}
