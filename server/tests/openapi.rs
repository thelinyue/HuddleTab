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
fn exchange_rate_contract_publishes_query_and_stable_errors() {
    let value = serde_json::to_value(huddletab_server::http::openapi::document())
        .expect("OpenAPI 应可序列化");
    let operation = &value["paths"]["/api/activities/{activity_id}/exchange-rate"]["get"];
    assert!(operation.is_object());
    for name in ["from", "date"] {
        assert!(
            operation["parameters"]
                .as_array()
                .expect("参数应为数组")
                .iter()
                .any(|parameter| parameter["name"] == name && parameter["in"] == "query")
        );
    }
    for status in ["200", "401", "403", "422", "503"] {
        assert!(operation["responses"][status].is_object(), "缺少 {status}");
    }
    assert_eq!(
        operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/ExchangeRateSuggestionEnvelope"
    );
    let expense = &value["components"]["schemas"]["ExpenseData"]["properties"];
    assert!(expense["exchangeRateReferenceDate"].is_object());
    assert!(expense["exchangeRateProvider"].is_object());
}

#[test]
fn attachment_contract_publishes_multipart_and_private_binary_download() {
    let document = huddletab_server::http::openapi::document();
    let value = serde_json::to_value(document).expect("OpenAPI 应可序列化");
    let path = "/api/activities/{activity_id}/expenses/{expense_id}/attachments";
    let upload = &value["paths"][path]["post"];
    assert_eq!(
        upload["requestBody"]["content"]["multipart/form-data"]["schema"]["$ref"],
        "#/components/schemas/UploadAttachmentRequest"
    );
    for status in [
        "200", "201", "400", "401", "403", "404", "409", "422", "500",
    ] {
        assert!(
            upload["responses"][status].is_object(),
            "附件上传缺少 {status} 响应"
        );
    }
    let download = &value["paths"][format!("{path}/{{attachment_id}}").as_str()]["get"];
    assert_eq!(
        download["responses"]["200"]["content"]["image/webp"]["schema"]["$ref"],
        "#/components/schemas/AttachmentBinary"
    );
    assert_eq!(
        value["components"]["schemas"]["AttachmentBinary"]["format"],
        "binary"
    );
    for header in [
        "Cache-Control",
        "Content-Type",
        "Content-Disposition",
        "X-Content-Type-Options",
    ] {
        assert_eq!(
            download["responses"]["200"]["headers"][header]["schema"]["type"], "string",
            "附件下载缺少 {header} 响应头"
        );
    }
    let delete = &value["paths"][format!("{path}/{{attachment_id}}").as_str()]["delete"];
    for status in ["204", "401", "403", "404", "500"] {
        assert!(
            delete["responses"][status].is_object(),
            "附件删除缺少 {status} 响应"
        );
    }
    assert_eq!(
        delete["parameters"]
            .as_array()
            .expect("删除参数应为数组")
            .iter()
            .find(|parameter| parameter["name"] == "x-csrf-token")
            .expect("附件删除应声明 CSRF")["in"],
        "header"
    );
    let attachment = &value["components"]["schemas"]["ExpenseAttachmentData"]["properties"];
    assert!(attachment["mimeType"].is_object());
    assert!(attachment["byteSize"].is_object());
    assert!(attachment["storageKey"].is_null());
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
fn ownership_transfer_contract_is_explicit() {
    let document = huddletab_server::http::openapi::document();
    let value = serde_json::to_value(document).expect("OpenAPI 应可序列化");
    let operation = &value["paths"]["/api/activities/{activity_id}/ownership"]["post"];
    assert!(operation.is_object());
    let csrf = operation["parameters"]
        .as_array()
        .and_then(|parameters| {
            parameters
                .iter()
                .find(|parameter| parameter["name"] == "x-csrf-token")
        })
        .expect("所有权转让应发布 CSRF header");
    assert_eq!(csrf["in"], "header");
    assert_eq!(csrf["required"], true);
    for status in ["200", "401", "403", "404", "409", "422", "429"] {
        assert!(
            operation["responses"][status].is_object(),
            "缺少 ownership {status}"
        );
    }
    let request = &value["components"]["schemas"]["TransferOwnershipRequest"];
    assert!(request.is_object());
}

#[test]
fn guest_binding_contract_is_explicit() {
    let document = huddletab_server::http::openapi::document();
    let value = serde_json::to_value(document).expect("OpenAPI 应可序列化");
    let operation = &value["paths"]["/api/activities/{activity_id}/members/{member_id}/binding-invitations"]
        ["post"];

    assert!(
        operation.is_object(),
        "contract 缺少 Guest Binding 创建路由"
    );
    assert_eq!(
        operation["requestBody"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/CreateGuestBindingInvitationRequest"
    );
    let csrf = operation["parameters"]
        .as_array()
        .and_then(|parameters| {
            parameters
                .iter()
                .find(|parameter| parameter["name"] == "x-csrf-token")
        })
        .expect("Guest Binding 写操作应发布 CSRF header");
    assert_eq!(csrf["in"], "header");
    assert_eq!(csrf["required"], true);

    for status in ["201", "400", "401", "403", "404", "429"] {
        assert!(
            operation["responses"][status].is_object(),
            "Guest Binding 创建路由缺少 {status} 响应",
        );
    }
    assert_eq!(
        operation["responses"]["201"]["content"]["application/json"]["schema"]["$ref"],
        "#/components/schemas/CreatedInvitationEnvelope"
    );
    assert_eq!(
        operation["responses"]["429"]["headers"]["Retry-After"]["schema"]["type"],
        "integer"
    );

    for schema in ["CreatedInvitationData", "InvitationData"] {
        let properties = value["components"]["schemas"][schema]["properties"]
            .as_object()
            .expect("邀请 schema 应发布 properties");
        assert!(properties.contains_key("purpose"), "{schema} 缺少 purpose");
        assert!(
            properties.contains_key("guestMemberId"),
            "{schema} 缺少 guestMemberId"
        );
    }
    let preview = value["components"]["schemas"]["InvitationPreviewData"]["properties"]
        .as_object()
        .expect("InvitationPreviewData 应发布 properties");
    for field in ["purpose", "guestMemberId", "guestDisplayName"] {
        assert!(preview.contains_key(field), "邀请预览缺少 {field}");
    }
    assert_eq!(
        value["components"]["schemas"]["JoinInvitationData"]["properties"]["status"]["type"],
        "string"
    );
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
