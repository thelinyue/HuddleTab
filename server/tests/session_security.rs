use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use huddletab_server::{
    domain::session::{SessionState, evaluate_session},
    infrastructure::session::SessionToken,
};
use time::{Duration, OffsetDateTime};

#[test]
fn session_token_contains_32_random_bytes_and_only_hash_is_persistable() {
    let first = SessionToken::generate();
    let second = SessionToken::generate();
    let decoded = URL_SAFE_NO_PAD
        .decode(first.expose_for_cookie())
        .expect("session token 应为 base64url");

    assert_eq!(decoded.len(), 32);
    assert_ne!(first.expose_for_cookie(), second.expose_for_cookie());
    assert_ne!(first.sha256_hash(), second.sha256_hash());
    assert_eq!(format!("{first:?}"), "SessionToken([REDACTED])");
    assert!(SessionToken::parse(first.expose_for_cookie()).is_ok());
    assert!(SessionToken::parse("not-a-32-byte-token").is_err());
}

#[test]
fn session_expires_at_idle_or_absolute_boundary() {
    let created = OffsetDateTime::UNIX_EPOCH;

    assert_eq!(
        evaluate_session(created, created, created + Duration::days(30)),
        SessionState::Expired
    );
    assert_eq!(
        evaluate_session(
            created,
            created + Duration::days(89),
            created + Duration::days(90)
        ),
        SessionState::Expired
    );
}

#[test]
fn last_seen_refresh_is_throttled_to_once_per_24_hours() {
    let created = OffsetDateTime::UNIX_EPOCH;
    let last_seen = created + Duration::days(2);

    assert_eq!(
        evaluate_session(created, last_seen, last_seen + Duration::hours(23)),
        SessionState::Active {
            refresh_last_seen: false
        }
    );
    assert_eq!(
        evaluate_session(created, last_seen, last_seen + Duration::hours(24)),
        SessionState::Active {
            refresh_last_seen: true
        }
    );
}
