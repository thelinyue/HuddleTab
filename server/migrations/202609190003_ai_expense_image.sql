-- 图片识别只使用内存中的安全预处理结果；默认关闭，大小上限不超过附件策略。
ALTER TABLE system_settings
    ADD COLUMN ai_image_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN ai_provider_max_image_bytes INTEGER NOT NULL DEFAULT 10485760
        CHECK (ai_provider_max_image_bytes BETWEEN 1 AND 10485760);
