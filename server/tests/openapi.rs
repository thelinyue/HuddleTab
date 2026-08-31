use serde_json::Value;
use std::process::Command;

#[test]
fn document_contains_health_and_shared_envelopes() {
    let document = huddletab_server::http::openapi::document();
    let value = serde_json::to_value(document).expect("OpenAPI 应可序列化");

    assert!(value["paths"]["/api/health"]["get"].is_object());
    assert!(value["components"]["schemas"]["HealthEnvelope"].is_object());
    assert!(value["components"]["schemas"]["ErrorEnvelope"].is_object());
}

#[test]
fn document_contains_phase1_auth_and_activity_routes() {
    let document = huddletab_server::http::openapi::document();
    let value = serde_json::to_value(document).expect("OpenAPI 应可序列化");

    for (path, method) in [
        ("/api/auth/csrf", "get"),
        ("/api/auth/login", "post"),
        ("/api/auth/logout", "post"),
        ("/api/auth/session", "get"),
        ("/api/me/password", "put"),
        ("/api/activities", "post"),
    ] {
        assert!(
            value["paths"][path][method].is_object(),
            "contract 缺少 {method} {path}",
        );
    }
    for schema in [
        "LoginRequest",
        "LoginEnvelope",
        "SessionEnvelope",
        "ChangePasswordRequest",
        "CreateActivityRequest",
        "ActivityEnvelope",
    ] {
        assert!(
            value["components"]["schemas"][schema].is_object(),
            "contract 缺少 schema {schema}",
        );
    }
}

#[test]
fn openapi_command_writes_the_contract() {
    let output_dir = tempfile::tempdir().expect("应可创建临时目录");
    let output_path = output_dir.path().join("openapi.json");
    let status = Command::new(env!("CARGO_BIN_EXE_huddletab"))
        .args(["openapi", "--output"])
        .arg(&output_path)
        .status()
        .expect("应可运行 huddletab openapi");

    assert!(status.success());
    let contents = std::fs::read_to_string(output_path).expect("命令应写入 contract");
    let value: Value = serde_json::from_str(&contents).expect("contract 应为 JSON");
    assert!(value["paths"]["/api/health"]["get"].is_object());
}
