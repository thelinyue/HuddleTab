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
