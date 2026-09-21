-- PWA 推送使用现有 notifications 作为可靠事件源；这里只保存设备订阅、账号偏好和投递状态。
-- 历史通知在升级时标记为已展开，避免用户首次开启推送后收到旧消息。
ALTER TABLE notifications
    ADD COLUMN push_enqueued_at TIMESTAMPTZ;

UPDATE notifications
SET push_enqueued_at = created_at
WHERE push_enqueued_at IS NULL;

CREATE INDEX notifications_push_pending_idx
ON notifications (created_at, id)
WHERE push_enqueued_at IS NULL;

CREATE TABLE notification_push_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    membership_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    expense_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    settlement_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    activity_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE CHECK (char_length(endpoint) BETWEEN 1 AND 4096),
    p256dh TEXT NOT NULL CHECK (char_length(p256dh) BETWEEN 1 AND 256),
    auth TEXT NOT NULL CHECK (char_length(auth) BETWEEN 1 AND 256),
    expiration_time BIGINT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX push_subscriptions_user_idx
ON push_subscriptions (user_id, updated_at DESC, id);

CREATE TABLE notification_push_deliveries (
    id UUID PRIMARY KEY,
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RETRY', 'DELIVERED', 'FAILED', 'CANCELLED')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL,
    delivered_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (notification_id, subscription_id)
);

CREATE INDEX notification_push_deliveries_pending_idx
ON notification_push_deliveries (next_attempt_at, id)
WHERE status IN ('PENDING', 'RETRY');
