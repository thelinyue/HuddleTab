-- NULL 为首次待配置；管理员保存后至少保留一个访问地址。
ALTER TABLE system_settings ADD COLUMN access_origins TEXT[]
    CHECK (access_origins IS NULL OR (cardinality(access_origins) > 0 AND array_position(access_origins, NULL) IS NULL));
