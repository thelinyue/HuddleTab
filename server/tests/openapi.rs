use serde_json::{Value, json};
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
fn protected_operations_publish_the_rate_limit_response() {
    let document = huddletab_server::http::openapi::document();
    let value = serde_json::to_value(document).expect("OpenAPI 应可序列化");

    for (path, method) in [
        ("/api/auth/login", "post"),
        ("/api/auth/register", "post"),
        ("/api/me/password", "put"),
        ("/api/activities/{activity_id}/invitations", "post"),
        (
            "/api/activities/{activity_id}/invitations/{invitation_id}",
            "delete",
        ),
        ("/api/invitations/{token}", "get"),
        ("/api/invitations/{token}/join", "post"),
    ] {
        assert_eq!(
            value["paths"][path][method]["responses"]["429"]["content"]["application/json"]["schema"]
                ["$ref"],
            "#/components/schemas/ErrorEnvelope",
            "{method} {path} 应声明标准限流错误",
        );
        assert_eq!(
            value["paths"][path][method]["responses"]["429"]["headers"]["Retry-After"]["schema"]["type"],
            "integer",
            "{method} {path} 应声明 Retry-After 整数秒头",
        );
    }
}

#[test]
fn activity_snapshot_publishes_conditional_get_contract() {
    let document = huddletab_server::http::openapi::document();
    let value = serde_json::to_value(document).expect("OpenAPI 应可序列化");
    let operation = &value["paths"]["/api/activities/{activity_id}/snapshot"]["get"];

    assert!(
        operation.is_object(),
        "contract 缺少 Activity Snapshot 路由"
    );
    let if_none_match = operation["parameters"]
        .as_array()
        .and_then(|parameters| {
            parameters
                .iter()
                .find(|parameter| parameter["name"] == "If-None-Match")
        })
        .expect("Snapshot 应发布 If-None-Match 请求头");
    assert_eq!(if_none_match["in"], "header");
    assert_eq!(if_none_match["required"], false);
    assert_eq!(
        operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/ActivitySnapshotEnvelope"
    );
    assert!(operation["responses"]["304"]["content"].is_null());
    for status in ["200", "304"] {
        assert_eq!(
            operation["responses"][status]["headers"]["ETag"]["schema"]["type"],
            "string"
        );
        assert_eq!(
            operation["responses"][status]["headers"]["Cache-Control"]["schema"]["type"],
            "string"
        );
    }

    let properties = value["components"]["schemas"]["ActivitySnapshotData"]["properties"]
        .as_object()
        .expect("ActivitySnapshotData 应发布 properties");
    for field in [
        "revision",
        "activity",
        "members",
        "expenses",
        "settlements",
        "ledger",
        "recommendations",
    ] {
        assert!(properties.contains_key(field), "Snapshot 缺少字段 {field}");
    }
}

#[test]
fn join_approval_and_notification_contract_is_complete() {
    let document = huddletab_server::http::openapi::document();
    let value = serde_json::to_value(document).expect("OpenAPI 应可序列化");

    for (path, method) in [
        ("/api/activities/{activity_id}/join-requests", "get"),
        (
            "/api/activities/{activity_id}/join-requests/{join_request_id}",
            "post",
        ),
        ("/api/join-requests/{join_request_id}", "get"),
        ("/api/notifications", "get"),
        ("/api/notifications/{notification_id}/read", "post"),
    ] {
        assert!(
            value["paths"][path][method].is_object(),
            "contract 缺少 {method} {path}",
        );
    }
    for schema in [
        "JoinRequestData",
        "JoinRequestEnvelope",
        "JoinRequestListEnvelope",
        "DecideJoinRequestRequest",
        "NotificationData",
        "NotificationEnvelope",
        "NotificationListData",
        "NotificationListEnvelope",
    ] {
        assert!(
            value["components"]["schemas"][schema].is_object(),
            "contract 缺少 schema {schema}",
        );
    }

    let activity = &value["components"]["schemas"]["ActivityData"]["properties"];
    assert!(activity["inviteMode"].is_object());
    let join_result = &value["components"]["schemas"]["JoinInvitationData"];
    assert!(join_result["properties"]["memberId"].is_object());
    assert!(join_result["properties"]["requestId"].is_object());
    assert!(
        !join_result["required"]
            .as_array()
            .expect("JoinInvitationData 应声明 required")
            .iter()
            .any(|field| field == "memberId" || field == "requestId")
    );

    for (path, error_status) in [
        (
            "/api/activities/{activity_id}/join-requests/{join_request_id}",
            "409",
        ),
        ("/api/notifications/{notification_id}/read", "404"),
    ] {
        let operation = &value["paths"][path]["post"];
        let csrf = operation["parameters"]
            .as_array()
            .and_then(|parameters| {
                parameters
                    .iter()
                    .find(|parameter| parameter["name"] == "x-csrf-token")
            })
            .expect("写操作应发布 CSRF header");
        assert_eq!(csrf["in"], "header");
        assert_eq!(csrf["required"], true);
        assert_eq!(
            operation["responses"][error_status]["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/ErrorEnvelope"
        );
    }
}

#[test]
// 合同测试集中核对同一 OpenAPI 文档的路径、查询参数和 schema，保持断言上下文连续。
#[allow(clippy::too_many_lines)]
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
        ("/api/activities", "get"),
        ("/api/activities/{activity_id}", "put"),
        ("/api/activities/{activity_id}", "delete"),
        ("/api/activities/{activity_id}/lifecycle", "post"),
        ("/api/activities/{activity_id}/restore", "post"),
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
        "UpdateActivityRequest",
        "ActivityLifecycleRequest",
        "ActivityVersionRequest",
        "ActivityUpdateEnvelope",
    ] {
        assert!(
            value["components"]["schemas"][schema].is_object(),
            "contract 缺少 schema {schema}",
        );
    }

    let list_operation = &value["paths"]["/api/activities"]["get"];
    let view_parameter = list_operation["parameters"]
        .as_array()
        .and_then(|parameters| {
            parameters
                .iter()
                .find(|parameter| parameter["name"] == "view")
        })
        .expect("GET /api/activities 应发布 view 查询参数");
    assert_eq!(view_parameter["in"], "query");
    assert_eq!(view_parameter["required"], false);
    assert_eq!(
        view_parameter["schema"]["enum"],
        json!(["current", "deleted"])
    );

    for (path, method, request_schema, response_schema) in [
        (
            "/api/activities/{activity_id}",
            "put",
            "UpdateActivityRequest",
            "ActivityUpdateEnvelope",
        ),
        (
            "/api/activities/{activity_id}/lifecycle",
            "post",
            "ActivityLifecycleRequest",
            "ActivityEnvelope",
        ),
        (
            "/api/activities/{activity_id}",
            "delete",
            "ActivityVersionRequest",
            "ActivityEnvelope",
        ),
        (
            "/api/activities/{activity_id}/restore",
            "post",
            "ActivityVersionRequest",
            "ActivityEnvelope",
        ),
    ] {
        let operation = &value["paths"][path][method];
        assert_eq!(
            operation["requestBody"]["content"]["application/json"]["schema"]["$ref"],
            format!("#/components/schemas/{request_schema}"),
            "{method} {path} 请求体 schema 不正确",
        );
        assert_eq!(
            operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
            format!("#/components/schemas/{response_schema}"),
            "{method} {path} 响应体 schema 不正确",
        );
    }

    let activity_properties = value["components"]["schemas"]["ActivityData"]["properties"]
        .as_object()
        .expect("ActivityData 应发布 properties");
    for field in [
        "location",
        "startDate",
        "endDate",
        "deletedAt",
        "purgeAfter",
        "hasAccountingRecords",
        "fieldPermissions",
        "allowedLifecycleActions",
        "canDelete",
        "canRestore",
    ] {
        assert!(
            activity_properties.contains_key(field),
            "ActivityData 缺少字段 {field}",
        );
    }
    assert_eq!(activity_properties["version"]["type"], "string");
    assert_eq!(activity_properties["revision"]["type"], "string");
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
