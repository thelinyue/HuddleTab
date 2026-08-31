use huddletab_server::domain::identity::{Password, Username};

#[test]
fn username_uses_nfkc_trim_lowercase_and_ascii_allowlist() {
    let username = Username::parse("  Ａlice.Name-_  ").expect("可规范化用户名应合法");
    assert_eq!(username.as_str(), "alice.name-_");

    for invalid in [
        "ab",
        "abcdefghijklmnopqrstuvwxyzabcdefg",
        "user name",
        "用户",
        "café",
        "a/b",
    ] {
        assert!(
            Username::parse(invalid).is_err(),
            "应拒绝用户名 {invalid:?}"
        );
    }
}

#[test]
fn password_preserves_original_utf8_without_normalization() {
    let composed = Password::parse("é1234567").expect("8 字符密码应合法");
    let decomposed = Password::parse("e\u{301}1234567").expect("组合字符密码应合法");

    assert_eq!(composed.as_str(), "é1234567");
    assert_eq!(decomposed.as_str(), "e\u{301}1234567");
    assert_ne!(composed.as_str(), decomposed.as_str());
}

#[test]
fn password_length_is_counted_in_unicode_characters() {
    assert!(Password::parse("七个字符啊啊").is_err());
    assert!(Password::parse("八个字符啊啊啊啊").is_ok());
    assert!(Password::parse(&"密".repeat(128)).is_ok());
    assert!(Password::parse(&"密".repeat(129)).is_err());
}
