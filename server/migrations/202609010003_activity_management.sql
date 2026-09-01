ALTER TABLE activities
ADD COLUMN location TEXT,
ADD COLUMN start_date DATE,
ADD COLUMN end_date DATE,
ADD COLUMN deleted_at TIMESTAMPTZ,
ADD COLUMN purge_after TIMESTAMPTZ;

UPDATE activities
SET start_date = (created_at AT TIME ZONE 'UTC')::date;

ALTER TABLE activities
ALTER COLUMN start_date SET NOT NULL,
ADD CONSTRAINT activities_location_length
    CHECK (location IS NULL OR char_length(location) <= 120),
ADD CONSTRAINT activities_date_range
    CHECK (end_date IS NULL OR end_date >= start_date),
ADD CONSTRAINT activities_deleted_window
    CHECK (
        (deleted_at IS NULL AND purge_after IS NULL)
        OR (deleted_at IS NOT NULL AND purge_after > deleted_at)
    );
