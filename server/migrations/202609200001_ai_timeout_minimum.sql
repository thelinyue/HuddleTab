-- 应用层允许管理员配置 1 秒超时；修正阶段一迁移遗留的 5 秒下限，保持配置契约一致。
ALTER TABLE system_settings
    DROP CONSTRAINT system_settings_ai_provider_timeout_seconds_check,
    ADD CONSTRAINT system_settings_ai_provider_timeout_seconds_check
        CHECK (ai_provider_timeout_seconds BETWEEN 1 AND 120);
