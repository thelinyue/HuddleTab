use time::{Duration, OffsetDateTime};

const IDLE_TIMEOUT: Duration = Duration::days(30);
const ABSOLUTE_TIMEOUT: Duration = Duration::days(90);
const LAST_SEEN_REFRESH_INTERVAL: Duration = Duration::hours(24);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionState {
    Active { refresh_last_seen: bool },
    Expired,
}

/// 同时执行 idle 与 absolute 过期判断，并把 last-seen 写放大限制在每 24 小时一次。
#[must_use]
pub fn evaluate_session(
    created_at: OffsetDateTime,
    last_seen_at: OffsetDateTime,
    now: OffsetDateTime,
) -> SessionState {
    if now - created_at >= ABSOLUTE_TIMEOUT || now - last_seen_at >= IDLE_TIMEOUT {
        return SessionState::Expired;
    }

    SessionState::Active {
        refresh_last_seen: now - last_seen_at >= LAST_SEEN_REFRESH_INTERVAL,
    }
}
