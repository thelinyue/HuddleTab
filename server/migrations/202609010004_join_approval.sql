ALTER TABLE activities
ADD COLUMN invite_mode TEXT NOT NULL DEFAULT 'DIRECT_JOIN'
CHECK (invite_mode IN ('DIRECT_JOIN', 'REQUIRE_APPROVAL'));

ALTER TABLE activity_invites
ADD CONSTRAINT activity_invites_activity_id_id_key UNIQUE (activity_id, id);

CREATE TABLE activity_join_requests (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    invitation_id UUID NOT NULL,
    applicant_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    decided_by_member_id UUID,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT activity_join_requests_decision_state CHECK (
        (status = 'PENDING' AND decided_by_member_id IS NULL AND decided_at IS NULL)
        OR
        (status <> 'PENDING' AND decided_by_member_id IS NOT NULL AND decided_at IS NOT NULL)
    ),
    FOREIGN KEY (activity_id, invitation_id)
        REFERENCES activity_invites(activity_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (activity_id, decided_by_member_id)
        REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX activity_join_requests_one_pending_per_user
ON activity_join_requests (activity_id, applicant_user_id)
WHERE status = 'PENDING';

CREATE INDEX activity_join_requests_activity_created_idx
ON activity_join_requests (activity_id, created_at, id);

CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (
        type IN ('JOIN_APPROVAL_REQUESTED', 'JOIN_APPROVAL_RESOLVED')
    ),
    target_type TEXT NOT NULL CHECK (target_type = 'ACTIVITY'),
    target_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB
        CHECK (jsonb_typeof(payload) = 'object'),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT notifications_activity_target CHECK (target_id = activity_id)
);

CREATE INDEX notifications_recipient_created_idx
ON notifications (recipient_user_id, created_at DESC, id);
