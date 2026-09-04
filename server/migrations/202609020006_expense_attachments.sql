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
