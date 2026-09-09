-- 全新安装直接创建当前完整结构，不承接旧版本数据升级。
-- SQLx 负责事务、迁移记录和重复启动校验；循环外键在两张表创建后建立。
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username TEXT COLLATE "C" NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    disabled_at TIMESTAMPTZ,
    avatar_preset SMALLINT NOT NULL DEFAULT 2 CHECK (avatar_preset BETWEEN 1 AND 6),
    CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
    CONSTRAINT users_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 80)
);

CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    idle_expires_at TIMESTAMPTZ NOT NULL,
    absolute_expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT sessions_time_order CHECK (
        last_seen_at >= created_at
        AND idle_expires_at >= last_seen_at
        AND absolute_expires_at >= created_at
    )
);

CREATE INDEX sessions_user_active_idx ON sessions (user_id, absolute_expires_at)
WHERE revoked_at IS NULL;

CREATE TABLE security_rate_limits (
    scope TEXT NOT NULL,
    key_hash BYTEA NOT NULL CHECK (octet_length(key_hash) = 32),
    window_started_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
    blocked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (scope, key_hash)
);

CREATE TABLE activities (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    base_currency CHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    owner_member_id UUID NOT NULL,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED', 'ARCHIVED')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    location TEXT,
    start_date DATE NOT NULL,
    end_date DATE,
    deleted_at TIMESTAMPTZ,
    purge_after TIMESTAMPTZ,
    invite_mode TEXT NOT NULL DEFAULT 'DIRECT_JOIN'
        CHECK (invite_mode IN ('DIRECT_JOIN', 'REQUIRE_APPROVAL')),
    CONSTRAINT activities_location_length
        CHECK (location IS NULL OR char_length(location) <= 120),
    CONSTRAINT activities_date_range
        CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT activities_deleted_window CHECK (
        (deleted_at IS NULL AND purge_after IS NULL)
        OR (deleted_at IS NOT NULL AND purge_after > deleted_at)
    )
);

CREATE TABLE activity_members (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    role TEXT NOT NULL CHECK (role IN ('OWNER', 'MEMBER')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LEFT')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    joined_at TIMESTAMPTZ NOT NULL,
    left_at TIMESTAMPTZ,
    UNIQUE (activity_id, id),
    UNIQUE (activity_id, user_id),
    CONSTRAINT activity_members_left_state CHECK (
        (status = 'ACTIVE' AND left_at IS NULL)
        OR (status = 'LEFT' AND left_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX activity_members_one_owner_idx
ON activity_members (activity_id)
WHERE role = 'OWNER';

ALTER TABLE activities
ADD CONSTRAINT activities_owner_same_activity_fk
FOREIGN KEY (id, owner_member_id)
REFERENCES activity_members(activity_id, id)
DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE activity_invites (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    created_by_member_id UUID NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    kind TEXT NOT NULL CHECK (kind IN ('LINK', 'DIRECT')),
    target_username TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    revoked_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL,
    guest_member_id UUID,
    CONSTRAINT activity_invites_activity_id_id_key UNIQUE (activity_id, id),
    CONSTRAINT activity_invites_activity_guest_member_fkey
        FOREIGN KEY (activity_id, guest_member_id)
        REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT,
    CONSTRAINT activity_invites_guest_binding_shape CHECK (
        guest_member_id IS NULL
        OR (kind = 'DIRECT' AND target_username IS NOT NULL AND max_uses = 1)
    ),
    FOREIGN KEY (activity_id, created_by_member_id)
        REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT,
    CONSTRAINT activity_invites_kind_target CHECK (
        (kind = 'LINK' AND target_username IS NULL)
        OR (kind = 'DIRECT' AND target_username IS NOT NULL)
    ),
    CONSTRAINT activity_invites_usage CHECK (max_uses IS NULL OR use_count <= max_uses)
);

CREATE INDEX activity_invites_activity_idx ON activity_invites (activity_id, created_at DESC);

CREATE TABLE expenses (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    client_mutation_id UUID NOT NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    category TEXT NOT NULL,
    note TEXT CHECK (note IS NULL OR char_length(note) <= 2000),
    occurred_at TIMESTAMPTZ NOT NULL,
    original_currency CHAR(3) NOT NULL CHECK (original_currency ~ '^[A-Z]{3}$'),
    original_amount_minor BIGINT NOT NULL CHECK (original_amount_minor > 0),
    base_currency CHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    base_amount_minor BIGINT NOT NULL CHECK (base_amount_minor >= 0),
    exchange_rate_kind TEXT NOT NULL CHECK (exchange_rate_kind IN ('IDENTITY', 'MANUAL', 'PROVIDER', 'CACHE')),
    exchange_rate NUMERIC(38, 12) NOT NULL CHECK (exchange_rate > 0),
    split_mode TEXT NOT NULL CHECK (split_mode IN ('EQUAL', 'EXACT', 'PERCENTAGE', 'WEIGHT')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (activity_id, id),
    UNIQUE (created_by_user_id, client_mutation_id),
    exchange_rate_reference_date DATE,
    exchange_rate_provider TEXT,
    CONSTRAINT expenses_rate_kind CHECK (
        (exchange_rate_kind = 'IDENTITY'
            AND original_currency = base_currency
            AND exchange_rate = 1
            AND exchange_rate_reference_date IS NULL
            AND exchange_rate_provider IS NULL)
        OR (exchange_rate_kind = 'MANUAL'
            AND original_currency <> base_currency
            AND exchange_rate_reference_date IS NULL
            AND exchange_rate_provider IS NULL)
        OR (exchange_rate_kind IN ('PROVIDER', 'CACHE')
            AND original_currency <> base_currency
            AND exchange_rate_reference_date IS NOT NULL
            AND exchange_rate_provider = 'FRANKFURTER')
    )
);

CREATE INDEX expenses_activity_feed_idx
ON expenses (activity_id, occurred_at DESC, id)
WHERE deleted_at IS NULL;

CREATE TABLE expense_payments (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL,
    expense_id UUID NOT NULL,
    payer_member_id UUID NOT NULL,
    original_currency CHAR(3) NOT NULL CHECK (original_currency ~ '^[A-Z]{3}$'),
    original_amount_minor BIGINT NOT NULL CHECK (original_amount_minor > 0),
    base_currency CHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    base_amount_minor BIGINT NOT NULL CHECK (base_amount_minor >= 0),
    UNIQUE (expense_id, id),
    FOREIGN KEY (activity_id, expense_id)
        REFERENCES expenses(activity_id, id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id, payer_member_id)
        REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT
);

CREATE INDEX expense_payments_expense_idx ON expense_payments (expense_id);

CREATE TABLE expense_shares (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL,
    expense_id UUID NOT NULL,
    member_id UUID NOT NULL,
    original_currency CHAR(3) NOT NULL CHECK (original_currency ~ '^[A-Z]{3}$'),
    original_amount_minor BIGINT NOT NULL CHECK (original_amount_minor >= 0),
    base_currency CHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    base_amount_minor BIGINT NOT NULL CHECK (base_amount_minor >= 0),
    UNIQUE (expense_id, id),
    FOREIGN KEY (activity_id, expense_id)
        REFERENCES expenses(activity_id, id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id, member_id)
        REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT
);

CREATE INDEX expense_shares_expense_idx ON expense_shares (expense_id);

CREATE TABLE settlements (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    client_mutation_id UUID NOT NULL,
    payer_member_id UUID NOT NULL,
    receiver_member_id UUID NOT NULL,
    currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'VOID')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    voided_at TIMESTAMPTZ,
    voided_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (activity_id, id),
    UNIQUE (created_by_user_id, client_mutation_id),
    FOREIGN KEY (activity_id, payer_member_id)
        REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (activity_id, receiver_member_id)
        REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT,
    CONSTRAINT settlements_distinct_members CHECK (payer_member_id <> receiver_member_id),
    CONSTRAINT settlements_void_state CHECK (
        (status = 'ACTIVE' AND voided_at IS NULL AND voided_by_user_id IS NULL)
        OR (status = 'VOID' AND voided_at IS NOT NULL AND voided_by_user_id IS NOT NULL)
    )
);

CREATE INDEX settlements_activity_idx ON settlements (activity_id, created_at DESC);

CREATE TABLE activity_audit_logs (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    actor_member_id UUID,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID NOT NULL,
    activity_revision BIGINT NOT NULL CHECK (activity_revision >= 1),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (activity_id, actor_member_id)
        REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT
);

CREATE INDEX activity_audit_logs_activity_idx
ON activity_audit_logs (activity_id, created_at DESC, id);

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
        type IN (
            'JOIN_APPROVAL_REQUESTED',
            'JOIN_APPROVAL_RESOLVED',
            'MEMBER_JOINED',
            'PARTICIPATING_EXPENSE_CHANGED',
            'PARTICIPATING_EXPENSE_DELETED',
            'SETTLEMENT_RECEIVED',
            'ACTIVITY_STATUS_CHANGED',
            'OWNERSHIP_CHANGED'
        )
    ),
    target_type TEXT NOT NULL CHECK (target_type IN ('ACTIVITY', 'EXPENSE', 'SETTLEMENT')),
    target_id UUID NOT NULL,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB
        CHECK (jsonb_typeof(payload) = 'object'),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT notifications_kind_target CHECK (
        (type IN (
            'JOIN_APPROVAL_REQUESTED',
            'JOIN_APPROVAL_RESOLVED',
            'MEMBER_JOINED',
            'ACTIVITY_STATUS_CHANGED',
            'OWNERSHIP_CHANGED'
        ) AND target_type = 'ACTIVITY' AND target_id = activity_id)
        OR
        (type IN (
            'PARTICIPATING_EXPENSE_CHANGED',
            'PARTICIPATING_EXPENSE_DELETED'
        ) AND target_type = 'EXPENSE')
        OR
        (type = 'SETTLEMENT_RECEIVED' AND target_type = 'SETTLEMENT')
    )
);

CREATE INDEX notifications_recipient_created_idx
ON notifications (recipient_user_id, created_at DESC, id);

CREATE TABLE expense_attachments (
    id UUID PRIMARY KEY,
    expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    client_attachment_id UUID NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL CHECK (mime_type = 'image/webp'),
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    byte_size BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT expense_attachments_expense_client_uq
        UNIQUE (expense_id, client_attachment_id),
    CONSTRAINT expense_attachments_positive_dimensions_and_size
        CHECK (width > 0 AND height > 0 AND byte_size > 0)
);

CREATE TABLE exchange_rate_cache (
    original_currency CHAR(3) NOT NULL CHECK (original_currency ~ '^[A-Z]{3}$'),
    base_currency CHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    reference_date DATE NOT NULL,
    provider TEXT NOT NULL CHECK (provider = 'FRANKFURTER'),
    rate NUMERIC(38, 12) NOT NULL CHECK (rate > 0),
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (original_currency, base_currency, reference_date, provider),
    CHECK (original_currency <> base_currency)
);

CREATE INDEX exchange_rate_cache_recent_idx
ON exchange_rate_cache (original_currency, base_currency, reference_date DESC);

CREATE TABLE system_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('SYSTEM_ADMIN')),
    granted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, role)
);

CREATE TABLE system_settings (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    registration_policy TEXT NOT NULL DEFAULT 'INVITE_ONLY'
        CHECK (registration_policy IN ('INVITE_ONLY', 'OPEN')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at TIMESTAMPTZ NOT NULL,
    -- 该字段只是最近修改管理员的审计指针；不建立外键，避免测试/运维按用户级联清理时误删系统单例。
    updated_by_user_id UUID
);

INSERT INTO system_settings (id, registration_policy, version, updated_at)
VALUES ('singleton', 'INVITE_ONLY', 1, CURRENT_TIMESTAMP);
