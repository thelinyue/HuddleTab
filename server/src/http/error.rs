use axum::{
    Json,
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    response::IntoResponse,
};
use serde::Serialize;
use serde_json::{Map, Value};
use utoipa::ToSchema;

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    code: &'static str,
    message: &'static str,
    field_errors: Map<String, Value>,
    details: Map<String, Value>,
    request_id: String,
}

#[derive(Serialize, ToSchema)]
pub struct ErrorEnvelope {
    error: ErrorBody,
}

/// HTTP 层只映射稳定错误代码；面向部署者和用户的消息使用清楚中文，详细诊断写日志。
pub enum ApiError {
    Standard { status: StatusCode, body: ErrorBody },
    RateLimited { body: ErrorBody, retry_after: u64 },
}

impl ApiError {
    #[must_use]
    pub fn not_found(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "NOT_FOUND",
            "请求的接口不存在。",
            request_id,
        )
    }

    #[must_use]
    pub fn method_not_allowed(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::METHOD_NOT_ALLOWED,
            "METHOD_NOT_ALLOWED",
            "该接口不支持当前请求方法。",
            request_id,
        )
    }

    #[must_use]
    pub fn forbidden(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "CSRF_INVALID",
            "请求来源或 CSRF token 无效。",
            request_id,
        )
    }

    #[must_use]
    pub fn unauthorized(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "INVALID_CREDENTIALS",
            "用户名或密码错误。",
            request_id,
        )
    }

    #[must_use]
    pub fn unauthenticated(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "UNAUTHENTICATED",
            "当前登录已失效，请重新登录。",
            request_id,
        )
    }

    #[must_use]
    pub fn internal(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL_ERROR",
            "服务暂时不可用，请稍后重试。",
            request_id,
        )
    }

    #[must_use]
    pub fn rate_limited(request_id: RequestId, retry_after: u64) -> Self {
        Self::RateLimited {
            body: Self::body("RATE_LIMITED", "请求过于频繁，请稍后再试。", request_id),
            retry_after,
        }
    }

    #[must_use]
    pub fn invalid_password(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "INVALID_PASSWORD",
            "新密码长度必须为 8 到 128 个字符。",
            request_id,
        )
    }

    #[must_use]
    pub fn invalid_activity(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "INVALID_ACTIVITY",
            "活动名称或主币种无效。",
            request_id,
        )
    }

    #[must_use]
    pub fn invalid_collaboration_input(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::BAD_REQUEST,
            "INVALID_INPUT",
            "成员或邀请信息无效。",
            request_id,
        )
    }

    #[must_use]
    pub fn operation_forbidden(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "你没有执行此操作的权限。",
            request_id,
        )
    }

    #[must_use]
    pub fn invalid_invitation(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "INVALID_INVITATION",
            "邀请不存在、已过期或已失效。",
            request_id,
        )
    }

    #[must_use]
    pub fn conflict(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "RESOURCE_CONFLICT",
            "资源状态已变化，请刷新后重试。",
            request_id,
        )
    }

    #[must_use]
    pub fn username_taken(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "USERNAME_TAKEN",
            "该用户名已被使用。",
            request_id,
        )
    }

    #[must_use]
    pub fn invalid_expense(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_EXPENSE",
            "账单金额、汇率、付款或分摊信息无效。",
            request_id,
        )
    }

    #[must_use]
    pub fn version_conflict(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "VERSION_CONFLICT",
            "账单已被其他人修改，请刷新后重试。",
            request_id,
        )
    }

    #[must_use]
    pub fn activity_version_conflict(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "VERSION_CONFLICT",
            "活动资料已被其他成员更新，请刷新后重试。",
            request_id,
        )
    }

    #[must_use]
    pub fn activity_field_locked(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "ACTIVITY_FIELD_LOCKED",
            "当前活动状态不允许修改所选字段。",
            request_id,
        )
    }

    #[must_use]
    pub fn activity_base_currency_locked(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "BASE_CURRENCY_LOCKED",
            "活动已有账务记录，主币种不可修改。",
            request_id,
        )
    }

    #[must_use]
    pub fn invalid_activity_transition(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "INVALID_ACTIVITY_TRANSITION",
            "当前活动状态不能执行此转换。",
            request_id,
        )
    }

    #[must_use]
    pub fn restore_window_expired(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "RESTORE_WINDOW_EXPIRED",
            "活动已超过 30 天恢复期限。",
            request_id,
        )
    }

    #[must_use]
    pub fn mutation_conflict(request_id: RequestId) -> Self {
        Self::new(
            StatusCode::CONFLICT,
            "MUTATION_CONFLICT",
            "该幂等标识已用于其他资源。",
            request_id,
        )
    }

    fn new(
        status: StatusCode,
        code: &'static str,
        message: &'static str,
        request_id: RequestId,
    ) -> Self {
        Self::Standard {
            status,
            body: Self::body(code, message, request_id),
        }
    }

    fn body(code: &'static str, message: &'static str, request_id: RequestId) -> ErrorBody {
        ErrorBody {
            code,
            message,
            field_errors: Map::new(),
            details: Map::new(),
            request_id: request_id.0,
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, body, retry_after) = match self {
            Self::Standard { status, body } => (status, body, None),
            Self::RateLimited { body, retry_after } => {
                (StatusCode::TOO_MANY_REQUESTS, body, Some(retry_after))
            }
        };
        let mut response = (status, Json(ErrorEnvelope { error: body })).into_response();
        if let Some(retry_after) = retry_after {
            response.headers_mut().insert(
                RETRY_AFTER,
                HeaderValue::from_str(&retry_after.to_string())
                    .expect("限流秒数始终是合法 HeaderValue"),
            );
        }
        response
    }
}
