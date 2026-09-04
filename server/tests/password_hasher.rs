use argon2::{Algorithm, Argon2, Params, PasswordHasher as _, Version, password_hash::SaltString};
use huddletab_server::{
    application::ports::PasswordHasher, domain::identity::Password,
    infrastructure::password::Argon2PasswordHasher,
};
use rand_core::OsRng;

#[test]
fn argon2id_uses_the_frozen_cost_and_verifies_without_exposing_password() {
    let hasher = Argon2PasswordHasher;
    let password = Password::parse("correct horse battery staple").expect("密码应合法");
    let encoded = hasher.hash(&password).expect("密码应可 hash");

    assert!(encoded.starts_with("$argon2id$v=19$m=65536,t=3,p=1$"));
    let verified = hasher
        .verify(&password, &encoded)
        .expect("合法 PHC 应可验证");
    assert!(verified.valid);
    assert!(!verified.needs_rehash);

    let wrong = Password::parse("correct horse battery staplex").expect("密码应合法");
    assert!(
        !hasher
            .verify(&wrong, &encoded)
            .expect("错误密码应返回验证失败")
            .valid
    );
    assert_eq!(format!("{password:?}"), "Password([REDACTED])");
}

#[test]
fn valid_legacy_hash_is_marked_for_rehash() {
    let password = Password::parse("旧参数密码12345").expect("密码应合法");
    let legacy = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(8 * 1024, 1, 1, None).expect("旧参数应合法"),
    );
    let encoded = legacy
        .hash_password(
            password.as_str().as_bytes(),
            &SaltString::generate(&mut OsRng),
        )
        .expect("应可生成旧 hash")
        .to_string();

    let verified = Argon2PasswordHasher
        .verify(&password, &encoded)
        .expect("旧 hash 应可验证");
    assert!(verified.valid);
    assert!(verified.needs_rehash);
}
