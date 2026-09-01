use axum::http::HeaderMap;
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
};
use time::{Duration, OffsetDateTime};

const WINDOW: Duration = Duration::minutes(1);
const MAX_ACTIVE_BUCKETS: usize = 4096;
const CLEANUP_EVERY: u64 = 128;

/// 受保护操作按类别共享配额，避免同一攻击通过切换等价入口绕过限制。
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(crate) enum RateLimitCategory {
    Auth,
    AnonymousInvite,
    SensitiveAuthenticated,
}

impl RateLimitCategory {
    const fn limit(self) -> u16 {
        match self {
            Self::Auth | Self::SensitiveAuthenticated => 10,
            Self::AnonymousInvite => 30,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ClientIp(String);

impl ClientIp {
    #[must_use]
    pub(crate) fn resolve(
        headers: &HeaderMap,
        peer: Option<SocketAddr>,
        trust_proxy: bool,
    ) -> Self {
        let peer_ip = peer.map_or(IpAddr::from([0, 0, 0, 0]), |address| address.ip());
        if trust_proxy {
            let values = headers.get_all("x-real-ip");
            let mut values = values.iter();
            if let (Some(value), None) = (values.next(), values.next())
                && let Some(value) = value
                    .to_str()
                    .ok()
                    .and_then(|value| value.parse::<IpAddr>().ok())
            {
                return Self(value.to_string());
            }
        }
        Self(peer_ip.to_string())
    }

    #[must_use]
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// 进程内状态只保护单实例的敏感入口；一个互斥锁使检查、淘汰和计数保持原子，避免并发请求越过配额。
#[derive(Clone)]
pub(crate) struct RateLimiter {
    state: Arc<Mutex<LimiterState>>,
}

struct LimiterState {
    buckets: HashMap<BucketKey, Bucket>,
    checks: u64,
}

#[derive(Eq, Hash, PartialEq)]
struct BucketKey {
    category: RateLimitCategory,
    identifier: String,
}

struct Bucket {
    started_at: OffsetDateTime,
    requests: u16,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RateLimited {
    retry_after: u64,
}

impl RateLimited {
    #[must_use]
    pub(crate) const fn retry_after(self) -> u64 {
        self.retry_after
    }
}

impl RateLimiter {
    #[must_use]
    pub(crate) fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(LimiterState {
                buckets: HashMap::new(),
                checks: 0,
            })),
        }
    }

    pub(crate) fn check(
        &self,
        category: RateLimitCategory,
        identifier: impl Into<String>,
    ) -> Result<(), RateLimited> {
        self.check_at(category, identifier, OffsetDateTime::now_utc())
    }

    fn check_at(
        &self,
        category: RateLimitCategory,
        identifier: impl Into<String>,
        now: OffsetDateTime,
    ) -> Result<(), RateLimited> {
        let mut state = self.state.lock().expect("限流器互斥锁不应中毒");
        state.checks += 1;
        if state.checks.is_multiple_of(CLEANUP_EVERY) || state.buckets.len() >= MAX_ACTIVE_BUCKETS {
            state
                .buckets
                .retain(|_, bucket| bucket.started_at + WINDOW > now);
        }

        let key = BucketKey {
            category,
            identifier: identifier.into(),
        };
        if let Some(bucket) = state.buckets.get_mut(&key) {
            if bucket.started_at + WINDOW <= now {
                bucket.started_at = now;
                bucket.requests = 1;
                return Ok(());
            }
            if bucket.requests < category.limit() {
                bucket.requests += 1;
                return Ok(());
            }
            return Err(RateLimited {
                retry_after: seconds_until(bucket.started_at + WINDOW, now),
            });
        }
        if state.buckets.len() >= MAX_ACTIVE_BUCKETS {
            return Err(RateLimited { retry_after: 60 });
        }
        state.buckets.insert(
            key,
            Bucket {
                started_at: now,
                requests: 1,
            },
        );
        Ok(())
    }
}

fn seconds_until(deadline: OffsetDateTime, now: OffsetDateTime) -> u64 {
    let nanoseconds = (deadline - now).whole_nanoseconds().max(1);
    u64::try_from((nanoseconds + 999_999_999) / 1_000_000_000)
        .expect("一分钟窗口的剩余秒数始终可表示为 u64")
}

#[cfg(test)]
mod tests {
    use super::{ClientIp, MAX_ACTIVE_BUCKETS, RateLimitCategory, RateLimiter};
    use axum::http::{HeaderMap, HeaderValue};
    use std::net::SocketAddr;
    use time::{Duration, OffsetDateTime};

    #[test]
    fn fixed_window_allows_the_limit_then_resets_from_the_first_request() {
        let limiter = RateLimiter::new();
        let started_at = OffsetDateTime::UNIX_EPOCH;
        for _ in 0..10 {
            assert!(
                limiter
                    .check_at(RateLimitCategory::Auth, "192.0.2.10", started_at)
                    .is_ok()
            );
        }
        assert_eq!(
            limiter
                .check_at(RateLimitCategory::Auth, "192.0.2.10", started_at)
                .expect_err("第 11 次认证请求应被限制")
                .retry_after(),
            60
        );
        assert!(
            limiter
                .check_at(
                    RateLimitCategory::Auth,
                    "192.0.2.10",
                    started_at + Duration::minutes(1),
                )
                .is_ok()
        );
    }

    #[test]
    fn categories_use_their_own_shared_limits() {
        let limiter = RateLimiter::new();
        let started_at = OffsetDateTime::UNIX_EPOCH;
        for _ in 0..10 {
            assert!(
                limiter
                    .check_at(RateLimitCategory::Auth, "192.0.2.10", started_at)
                    .is_ok()
            );
        }
        assert!(
            limiter
                .check_at(RateLimitCategory::AnonymousInvite, "192.0.2.10", started_at,)
                .is_ok()
        );
        for _ in 1..30 {
            assert!(
                limiter
                    .check_at(RateLimitCategory::AnonymousInvite, "192.0.2.10", started_at,)
                    .is_ok()
            );
        }
        assert!(
            limiter
                .check_at(RateLimitCategory::AnonymousInvite, "192.0.2.10", started_at,)
                .is_err()
        );
    }

    #[test]
    fn periodic_cleanup_removes_expired_buckets_on_the_128th_check() {
        let limiter = RateLimiter::new();
        let started_at = OffsetDateTime::UNIX_EPOCH;
        assert!(
            limiter
                .check_at(RateLimitCategory::Auth, "expired", started_at)
                .is_ok()
        );
        for identifier in 0..126 {
            assert!(
                limiter
                    .check_at(RateLimitCategory::Auth, identifier.to_string(), started_at)
                    .is_ok()
            );
        }
        assert!(
            limiter
                .check_at(
                    RateLimitCategory::Auth,
                    "trigger-cleanup",
                    started_at + Duration::minutes(1),
                )
                .is_ok()
        );
        let state = limiter.state.lock().expect("限流器互斥锁不应中毒");
        assert!(state.buckets.keys().all(|key| key.identifier != "expired"));
    }

    #[test]
    fn full_limiter_reclaims_expired_buckets_before_rejecting_a_new_identifier() {
        let limiter = RateLimiter::new();
        let started_at = OffsetDateTime::UNIX_EPOCH;
        for identifier in 0..MAX_ACTIVE_BUCKETS {
            assert!(
                limiter
                    .check_at(RateLimitCategory::Auth, identifier.to_string(), started_at)
                    .is_ok()
            );
        }
        assert!(
            limiter
                .check_at(RateLimitCategory::Auth, "overflow", started_at)
                .is_err()
        );
        assert!(
            limiter
                .check_at(
                    RateLimitCategory::Auth,
                    "after-expiry",
                    started_at + Duration::minutes(1),
                )
                .is_ok()
        );
    }

    #[test]
    fn client_ip_uses_x_real_ip_only_when_the_proxy_is_explicitly_trusted() {
        let peer = "198.51.100.5:443".parse::<SocketAddr>().unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", HeaderValue::from_static("203.0.113.9"));
        assert_eq!(
            ClientIp::resolve(&headers, Some(peer), false).as_str(),
            "198.51.100.5"
        );
        assert_eq!(
            ClientIp::resolve(&headers, Some(peer), true).as_str(),
            "203.0.113.9"
        );
        headers.append("x-real-ip", HeaderValue::from_static("203.0.113.10"));
        assert_eq!(
            ClientIp::resolve(&headers, Some(peer), true).as_str(),
            "198.51.100.5"
        );
        headers.insert("x-real-ip", HeaderValue::from_static("not-an-ip"));
        assert_eq!(
            ClientIp::resolve(&headers, Some(peer), true).as_str(),
            "198.51.100.5"
        );
    }
}
