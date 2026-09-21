-- MCP 个人访问令牌只保存摘要；原始令牌只在创建响应中出现一次。
CREATE TABLE mcp_access_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    token_prefix TEXT NOT NULL CHECK (char_length(token_prefix) BETWEEN 8 AND 32),
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    scope TEXT NOT NULL CHECK (scope IN ('READ', 'EXPENSES_CREATE')),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX mcp_access_tokens_user_idx
ON mcp_access_tokens (user_id, created_at DESC);

CREATE INDEX mcp_access_tokens_active_hash_idx
ON mcp_access_tokens (token_hash)
WHERE revoked_at IS NULL;
