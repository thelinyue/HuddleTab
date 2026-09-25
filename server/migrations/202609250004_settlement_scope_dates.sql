-- 日期展示也保存为事实；修改账单日期或更换设备时区不能改写历史记录的标签。
ALTER TABLE settlements ADD COLUMN scope_dates TEXT[] NOT NULL DEFAULT '{}';
UPDATE settlements SET scope_dates = ARRAY(SELECT jsonb_array_elements_text(scope_request->'dates'))
WHERE jsonb_typeof(scope_request->'dates') = 'array';
ALTER TABLE bill_offset_confirmations ADD COLUMN scope_dates TEXT[] NOT NULL DEFAULT '{}';
