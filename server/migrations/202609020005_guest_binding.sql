ALTER TABLE activity_invites
ADD COLUMN guest_member_id UUID;

ALTER TABLE activity_invites
ADD CONSTRAINT activity_invites_activity_guest_member_fkey
FOREIGN KEY (activity_id, guest_member_id)
REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT;

ALTER TABLE activity_invites
ADD CONSTRAINT activity_invites_guest_binding_shape CHECK (
    guest_member_id IS NULL
    OR (
        kind = 'DIRECT'
        AND target_username IS NOT NULL
        AND max_uses = 1
    )
);
