-- 旧普通定向邀请不再可创建；升级时撤销已有口令及其待审批申请。
ALTER TABLE activity_join_requests DROP CONSTRAINT activity_join_requests_status_check;
ALTER TABLE activity_join_requests ADD CONSTRAINT activity_join_requests_status_check
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'INVALIDATED'));
ALTER TABLE activity_join_requests DROP CONSTRAINT activity_join_requests_decision_state;
ALTER TABLE activity_join_requests ADD CONSTRAINT activity_join_requests_decision_state CHECK (
    (status = 'PENDING' AND decided_by_member_id IS NULL AND decided_at IS NULL)
    OR (status IN ('APPROVED', 'REJECTED') AND decided_by_member_id IS NOT NULL AND decided_at IS NOT NULL)
    OR (status = 'INVALIDATED' AND decided_by_member_id IS NULL AND decided_at IS NOT NULL)
);

CREATE TEMP TABLE legacy_direct_invites ON COMMIT DROP AS
SELECT id, activity_id FROM activity_invites
WHERE kind = 'DIRECT' AND guest_member_id IS NULL AND revoked_at IS NULL;

CREATE TEMP TABLE invalidated_direct_requests ON COMMIT DROP AS
SELECT request.id, request.activity_id, request.applicant_user_id
FROM activity_join_requests request
JOIN activity_invites invite ON invite.id = request.invitation_id
WHERE invite.kind = 'DIRECT' AND invite.guest_member_id IS NULL
  AND request.status = 'PENDING';

UPDATE activity_invites invite
SET revoked_at = CURRENT_TIMESTAMP, version = version + 1
FROM legacy_direct_invites legacy WHERE invite.id = legacy.id;

UPDATE activity_join_requests request
SET status = 'INVALIDATED', decided_at = CURRENT_TIMESTAMP
FROM invalidated_direct_requests invalidated WHERE request.id = invalidated.id;

UPDATE notifications notice
SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
    payload = payload || jsonb_build_object('status', 'INVALIDATED')
FROM invalidated_direct_requests request
WHERE notice.activity_id = request.activity_id
  AND notice.type = 'JOIN_APPROVAL_REQUESTED'
  AND notice.payload->>'requestId' = request.id::text;

INSERT INTO notifications (id, recipient_user_id, type, target_type, target_id,
                           activity_id, payload, created_at)
SELECT gen_random_uuid(), applicant_user_id, 'JOIN_APPROVAL_RESOLVED',
       'ACTIVITY', activity_id, activity_id,
       jsonb_build_object('requestId', id::text, 'status', 'INVALIDATED'), CURRENT_TIMESTAMP
FROM invalidated_direct_requests;

-- 一项活动只推进一次 revision，审计明确标记为系统迁移而非所有者操作。
WITH affected AS (
    SELECT activity_id FROM legacy_direct_invites
    UNION SELECT activity_id FROM invalidated_direct_requests
), revised AS (
    UPDATE activities activity SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    FROM affected WHERE activity.id = affected.activity_id
    RETURNING activity.id, activity.revision
)
INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, actor_member_id,
                                 action, resource_type, resource_id, activity_revision, created_at)
SELECT gen_random_uuid(), id, NULL, NULL, 'LEGACY_DIRECT_INVITATIONS_INVALIDATED',
       'ACTIVITY', id, revision, CURRENT_TIMESTAMP FROM revised;
