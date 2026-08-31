CREATE TABLE users (
    id UUID PRIMARY KEY,
    username TEXT COLLATE "C" NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
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
    updated_at TIMESTAMPTZ NOT NULL
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
    exchange_rate_kind TEXT NOT NULL CHECK (exchange_rate_kind IN ('IDENTITY', 'MANUAL')),
    exchange_rate NUMERIC(38, 12) NOT NULL CHECK (exchange_rate > 0),
    split_mode TEXT NOT NULL CHECK (split_mode IN ('EQUAL', 'EXACT', 'PERCENTAGE', 'WEIGHT')),
    version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (activity_id, id),
    UNIQUE (created_by_user_id, client_mutation_id),
    CONSTRAINT expenses_rate_kind CHECK (
        (exchange_rate_kind = 'IDENTITY' AND original_currency = base_currency AND exchange_rate = 1)
        OR (exchange_rate_kind = 'MANUAL' AND original_currency <> base_currency)
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
