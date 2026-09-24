-- 删除恢复功能下线：仅清理此前已经删除的活动，其他活动及用户保持不变。
-- 先移除 RESTRICT 引用，再由活动外键级联清理成员、通知、推送及封面元数据。
DELETE FROM settlement_allocations WHERE activity_id IN (SELECT id FROM activities WHERE deleted_at IS NOT NULL);
DELETE FROM settlements WHERE activity_id IN (SELECT id FROM activities WHERE deleted_at IS NOT NULL);
DELETE FROM expenses WHERE activity_id IN (SELECT id FROM activities WHERE deleted_at IS NOT NULL);
DELETE FROM activity_join_requests WHERE activity_id IN (SELECT id FROM activities WHERE deleted_at IS NOT NULL);
DELETE FROM activity_invites WHERE activity_id IN (SELECT id FROM activities WHERE deleted_at IS NOT NULL);
DELETE FROM activity_audit_logs WHERE activity_id IN (SELECT id FROM activities WHERE deleted_at IS NOT NULL);
DELETE FROM activities WHERE deleted_at IS NOT NULL;

ALTER TABLE activities DROP CONSTRAINT activities_deleted_window;
ALTER TABLE activities DROP COLUMN deleted_at, DROP COLUMN purge_after;
