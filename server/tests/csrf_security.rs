use huddletab_server::infrastructure::{
    app_secret::AppSecret,
    csrf::{CsrfContext, CsrfToken},
};

#[test]
fn app_secret_is_created_once_and_reused() {
    let directory = tempfile::tempdir().expect("应可创建临时 data 目录");
    let path = directory.path().join("app-secret");

    let first = AppSecret::load_or_create(&path).expect("首次应创建 app-secret");
    let second = AppSecret::load_or_create(&path).expect("后续应读取 app-secret");

    assert_eq!(first, second);
    assert_eq!(std::fs::read(path).expect("应可读取密钥文件").len(), 32);
    assert_eq!(format!("{first:?}"), "AppSecret([REDACTED])");
}

#[test]
fn csrf_signature_is_bound_to_context_and_secret() {
    let secret = AppSecret::from_bytes([7; 32]);
    let other_secret = AppSecret::from_bytes([8; 32]);
    let session_hash = [11; 32];
    let other_session_hash = [12; 32];
    let token = CsrfToken::mint(&secret, CsrfContext::Session(&session_hash));

    assert!(token.verify(&secret, CsrfContext::Session(&session_hash)));
    assert!(!token.verify(&secret, CsrfContext::Session(&other_session_hash)));
    assert!(!token.verify(&secret, CsrfContext::PreAuth("login-context")));
    assert!(!token.verify(&other_secret, CsrfContext::Session(&session_hash)));
}

#[test]
fn csrf_tampering_is_rejected() {
    let secret = AppSecret::from_bytes([3; 32]);
    let token = CsrfToken::mint(&secret, CsrfContext::PreAuth("register-context"));
    let mut encoded = token.expose_for_header().as_bytes().to_vec();
    encoded[5] = if encoded[5] == b'A' { b'B' } else { b'A' };
    let tampered = String::from_utf8(encoded).expect("修改后仍应为 UTF-8");

    assert!(
        !CsrfToken::parse(&tampered)
            .expect("篡改 token 仍可完成结构解析")
            .verify(&secret, CsrfContext::PreAuth("register-context"))
    );
}
