ALTER TABLE expenses
    DROP CONSTRAINT expenses_exchange_rate_kind_check,
    DROP CONSTRAINT expenses_rate_kind,
    ADD COLUMN exchange_rate_reference_date DATE,
    ADD COLUMN exchange_rate_provider TEXT,
    ADD CONSTRAINT expenses_exchange_rate_kind_check
        CHECK (exchange_rate_kind IN ('IDENTITY', 'MANUAL', 'PROVIDER', 'CACHE')),
    ADD CONSTRAINT expenses_rate_kind CHECK (
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
    );
