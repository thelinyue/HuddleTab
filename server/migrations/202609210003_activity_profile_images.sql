-- 活动封面与用户头像的可回收私有图片元数据。
-- 旧活动的 NULL cover_preset 继续由客户端按活动 ID 稳定回退到原 1-6。
ALTER TABLE activities
    ADD COLUMN cover_preset SMALLINT
        CHECK (cover_preset IS NULL OR cover_preset BETWEEN 1 AND 12);

-- ADD COLUMN 不回填历史 NULL；后续直接写入活动时默认使用“日常通用”。
ALTER TABLE activities
    ALTER COLUMN cover_preset SET DEFAULT 12;

ALTER TABLE users
    DROP CONSTRAINT users_avatar_preset_check,
    ADD CONSTRAINT users_avatar_preset_check CHECK (avatar_preset BETWEEN 1 AND 11);

CREATE TABLE activity_cover_images (
    activity_id UUID PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
    image_id UUID NOT NULL UNIQUE,
    storage_key TEXT NOT NULL UNIQUE,
    width INTEGER NOT NULL CHECK (width = 1200),
    height INTEGER NOT NULL CHECK (height = 900),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE user_avatar_images (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    image_id UUID NOT NULL UNIQUE,
    storage_key TEXT NOT NULL UNIQUE,
    width INTEGER NOT NULL CHECK (width = 512),
    height INTEGER NOT NULL CHECK (height = 512),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX activity_cover_images_storage_key_idx ON activity_cover_images(storage_key);
CREATE INDEX user_avatar_images_storage_key_idx ON user_avatar_images(storage_key);
