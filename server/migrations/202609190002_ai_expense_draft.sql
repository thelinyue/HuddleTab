-- AI 只生成待确认草稿；配置属于系统设置，不推进 Activity revision。
ALTER TABLE system_settings
    ADD COLUMN ai_expense_draft_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN ai_provider_base_url TEXT,
    ADD COLUMN ai_provider_model TEXT,
    -- 默认启用 JSON Mode；不支持该扩展的本地兼容服务可在管理员设置中关闭。
    ADD COLUMN ai_provider_json_mode BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN ai_provider_timeout_seconds INTEGER NOT NULL DEFAULT 30
        CHECK (ai_provider_timeout_seconds BETWEEN 5 AND 120),
    ADD COLUMN ai_provider_api_key_envelope BYTEA;

-- 系统管理员审计只保存变更字段名和秘密动作，禁止存储配置值或密文内容。
CREATE TABLE system_admin_audit_logs (
    id UUID PRIMARY KEY,
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_key TEXT NOT NULL,
    changed_fields TEXT[] NOT NULL DEFAULT '{}',
    secret_action TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT system_admin_audit_logs_secret_action CHECK (
        secret_action IS NULL OR secret_action IN ('SET', 'REPLACED', 'CLEARED')
    ),
    CONSTRAINT system_admin_audit_logs_has_change CHECK (
        cardinality(changed_fields) > 0 OR secret_action IS NOT NULL
    )
);

CREATE INDEX system_admin_audit_logs_created_idx
ON system_admin_audit_logs (created_at DESC, id);
