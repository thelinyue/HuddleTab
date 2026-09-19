-- SettlementAllocation 只记录真实 Settlement 到具体 Expense 的明确归属。
-- payer/payee/currency/status 从 settlements 继承，避免形成第二套账本。
CREATE TABLE settlement_allocations (
    activity_id UUID NOT NULL,
    settlement_id UUID NOT NULL,
    expense_id UUID NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (settlement_id, expense_id),
    FOREIGN KEY (activity_id, settlement_id)
        REFERENCES settlements(activity_id, id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id, expense_id)
        REFERENCES expenses(activity_id, id) ON DELETE RESTRICT
);

CREATE INDEX settlement_allocations_expense_idx
    ON settlement_allocations (expense_id, settlement_id);
