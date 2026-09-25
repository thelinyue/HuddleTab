-- 账单清偿是从真实转账或成员跨账单抵销派生的归属，不改变 Settlement 现金事实。
-- 每个成员在每笔账单上的应用单独记录，允许一次净额转账清偿不同账单的两侧。
CREATE TABLE bill_clearing_entries (
    id UUID PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    expense_id UUID NOT NULL,
    member_id UUID NOT NULL,
    settlement_id UUID,
    offset_expense_id UUID,
    kind TEXT NOT NULL CHECK (kind IN ('PAYMENT', 'OFFSET')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    origin TEXT NOT NULL CHECK (origin IN ('AUTO', 'HISTORICAL_EXPLICIT', 'HISTORICAL_AUTO')),
    created_at TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (activity_id, expense_id) REFERENCES expenses(activity_id, id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id, member_id) REFERENCES activity_members(activity_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (activity_id, settlement_id) REFERENCES settlements(activity_id, id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id, offset_expense_id) REFERENCES expenses(activity_id, id) ON DELETE CASCADE,
    CONSTRAINT bill_clearing_source CHECK (
        (kind = 'PAYMENT' AND settlement_id IS NOT NULL AND offset_expense_id IS NULL)
        OR (kind = 'OFFSET' AND settlement_id IS NULL AND offset_expense_id IS NOT NULL AND offset_expense_id <> expense_id)
    )
);

CREATE INDEX bill_clearing_expense_idx ON bill_clearing_entries (expense_id, member_id);
CREATE INDEX bill_clearing_settlement_idx ON bill_clearing_entries (settlement_id) WHERE settlement_id IS NOT NULL;
