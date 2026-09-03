ALTER TABLE users ADD COLUMN disabled_at TIMESTAMPTZ;

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
    updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO system_settings (id, registration_policy, version, updated_at)
VALUES ('singleton', 'INVITE_ONLY', 1, CURRENT_TIMESTAMP);
