-- 每笔真实转账保存当时的账单集合，后补同日账单不会被旧付款自动吸收。
ALTER TABLE settlements ADD COLUMN scope_expense_ids UUID[] NOT NULL DEFAULT '{}';
ALTER TABLE settlements ADD COLUMN scope_request JSONB;
ALTER TABLE settlements ADD COLUMN clearing_order BIGINT NOT NULL DEFAULT 0;
ALTER TABLE settlements ADD COLUMN clearing_origin TEXT NOT NULL DEFAULT 'AUTO';
UPDATE settlements s SET scope_expense_ids = ARRAY(
    SELECT e.id FROM expenses e WHERE e.activity_id = s.activity_id
    AND (e.created_at <= s.created_at OR EXISTS (
        SELECT 1 FROM settlement_allocations a WHERE a.settlement_id = s.id AND a.expense_id = e.id
    )) ORDER BY e.occurred_at, e.id
), clearing_origin = 'HISTORICAL_AUTO';
WITH ordered AS (
    SELECT id, row_number() OVER (PARTITION BY activity_id ORDER BY created_at, id) AS sequence
    FROM settlements
)
UPDATE settlements s SET clearing_order = ordered.sequence FROM ordered WHERE ordered.id = s.id;

-- 抵销确认不伪造现金转账；幂等键和活动 revision 与普通结算采用相同约束。
CREATE TABLE bill_offset_confirmations (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    created_by_user_id UUID NOT NULL REFERENCES users(id),
    client_mutation_id UUID NOT NULL,
    scope_request JSONB NOT NULL,
    scope_expense_ids UUID[] NOT NULL,
    clearing_order BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (created_by_user_id, client_mutation_id)
);
CREATE INDEX bill_offset_activity_idx ON bill_offset_confirmations(activity_id);
-- 仅重建派生投影：服务启动前按真实付款重放，未确认的纯自动抵销不再固化。
DELETE FROM bill_clearing_entries;
