-- 普通邀请的认领目标属于申请，不写回可供多人使用的邀请。
-- 复合外键保证认领对象与申请属于同一活动；旧申请的空值继续表示普通加入。
ALTER TABLE activity_join_requests ADD COLUMN guest_member_id UUID;
ALTER TABLE activity_join_requests ADD CONSTRAINT activity_join_requests_guest_same_activity_fk
    FOREIGN KEY (activity_id, guest_member_id)
    REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT;
