-- 旧链接仅存哈希，无法再次复制。升级时撤销，保持审批通知和审计一致。
ALTER TABLE activity_invites ADD COLUMN encrypted_link_token BYTEA;

CREATE TEMP TABLE legacy_link_invites ON COMMIT DROP AS
SELECT id, activity_id FROM activity_invites
WHERE kind = 'LINK' AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP;

CREATE TEMP TABLE invalidated_link_requests ON COMMIT DROP AS
SELECT request.id, request.activity_id, request.applicant_user_id
FROM activity_join_requests request
JOIN legacy_link_invites invite ON invite.id = request.invitation_id
WHERE request.status = 'PENDING';

UPDATE activity_invites invite
SET revoked_at = CURRENT_TIMESTAMP, version = version + 1
FROM legacy_link_invites legacy WHERE invite.id = legacy.id;

UPDATE activity_join_requests request
SET status = 'INVALIDATED', decided_at = CURRENT_TIMESTAMP
FROM invalidated_link_requests invalidated WHERE request.id = invalidated.id;

UPDATE notifications notice
SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
    payload = payload || jsonb_build_object('status', 'INVALIDATED')
FROM invalidated_link_requests request
WHERE notice.activity_id = request.activity_id
  AND notice.type = 'JOIN_APPROVAL_REQUESTED'
  AND notice.payload->>'requestId' = request.id::text;

INSERT INTO notifications (id, recipient_user_id, type, target_type, target_id,
                           activity_id, payload, created_at)
SELECT gen_random_uuid(), applicant_user_id, 'JOIN_APPROVAL_RESOLVED',
       'ACTIVITY', activity_id, activity_id,
       jsonb_build_object('requestId', id::text, 'status', 'INVALIDATED'), CURRENT_TIMESTAMP
FROM invalidated_link_requests;

WITH affected AS (
    SELECT DISTINCT activity_id FROM legacy_link_invites
), revised AS (
    UPDATE activities activity SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    FROM affected WHERE activity.id = affected.activity_id
    RETURNING activity.id, activity.revision
)
INSERT INTO activity_audit_logs (id, activity_id, actor_user_id, actor_member_id,
                                 action, resource_type, resource_id, activity_revision, created_at)
SELECT gen_random_uuid(), id, NULL, NULL, 'LEGACY_LINK_INVITATIONS_INVALIDATED',
       'ACTIVITY', id, revision, CURRENT_TIMESTAMP FROM revised;
