//! HTTP 响应共用的时间展示；保留原有 RFC3339 偏移、精度和格式化失败行为。
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub(super) fn format_time(value: OffsetDateTime) -> String {
    value.format(&Rfc3339).expect("数据库时间始终可格式化")
}
