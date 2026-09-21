//! `HuddleTab` 的 MCP 远程服务与个人访问令牌接口。
//!
//! MCP 请求只使用 Bearer 令牌，业务读取和新增账单仍统一调用现有应用层用例。
//! 令牌原文只在创建响应中出现一次；任何日志都不得输出令牌或完整账务输入。

use std::sync::Arc;

use axum::{
    Extension, Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::CookieJar;
use rmcp::{
    ErrorData as McpError, Json as McpJson, RoleServer, ServerHandler,
    handler::server::wrapper::Parameters,
    model::{
        CacheScope, GetPromptRequestParams, GetPromptResponse, GetPromptResult, Implementation,
        ListPromptsResult, ListResourceTemplatesResult, ListResourcesResult,
        PaginatedRequestParams, Prompt, PromptArgument, PromptMessage, ReadResourceRequestParams,
        ReadResourceResponse, ReadResourceResult, Resource, ResourceContents, ResourceTemplate,
        Role, ServerCapabilities, ServerConfig,
    },
    service::RequestContext,
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::never::NeverSessionManager,
    },
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Date, OffsetDateTime, format_description::well_known::Rfc3339};
use url::Url;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::{
        accounting::{RequestedRecommendationStrategy, load_ledger, load_recommendations},
        activity::{ActivityView, list_activities, list_activity_members},
        auth::{CurrentSessionError, current_session},
        expense::{
            CreateExpenseInput, ExpenseAuditSource, ExpenseDraftInput, ExpenseError,
            create_expense, get_expense, list_expenses,
        },
        sharing::{SharingError, load_summary},
    },
    domain::expense::{ExpenseSplitInput, PaymentInput, SplitEntryInput},
    infrastructure::{
        accounting_repository::PostgresAccountingRepository,
        activity_repository::PostgresActivityRepository, auth_repository::PostgresAuthRepository,
        clock::SystemClock, expense_repository::PostgresExpenseRepository,
        mcp_token::McpAccessToken, settlement_repository::PostgresSettlementRepository,
        sharing_repository::PostgresSharingRepository,
    },
};

use super::{
    accounting::{BalanceData, LedgerData},
    activity::{ActivityData, ActivityMemberData, activity_data, member_data},
    auth::validate_session_csrf,
    error::{ApiError, RequestId},
    expense::{CreatedExpenseData, ExpenseAggregateData, aggregate_data},
    router::AppState,
    settlement::{SettlementData, settlement_data},
    sharing::summary_data,
};

const MCP_SCOPE_READ: &str = "READ";
const MCP_SCOPE_EXPENSES_CREATE: &str = "EXPENSES_CREATE";
const MCP_TOKEN_MAX_NAME_CHARS: usize = 80;

/// MCP 令牌的最小身份；原始令牌和数据库密钥都不会进入请求上下文。
#[derive(Clone, Debug)]
pub(crate) struct McpIdentity {
    pub token_id: Uuid,
    pub user_id: Uuid,
    pub can_create_expenses: bool,
}

#[derive(Clone, Debug)]
struct McpTokenRecord {
    id: Uuid,
    name: String,
    token_prefix: String,
    scope: String,
    expires_at: Option<OffsetDateTime>,
    last_used_at: Option<OffsetDateTime>,
    revoked_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
}

#[derive(Deserialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateMcpTokenRequest {
    pub name: String,
    pub scope: String,
    pub expires_at: Option<String>,
}

#[derive(Serialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct McpTokenData {
    pub token_id: String,
    pub name: String,
    pub token_prefix: String,
    pub scope: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
    pub revoked_at: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, JsonSchema, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatedMcpTokenData {
    #[serde(flatten)]
    pub token: McpTokenData,
    /// 原始令牌只在创建响应中存在；列表响应不会包含该字段。
    pub secret: String,
}

#[derive(Serialize, JsonSchema, ToSchema)]
pub struct McpTokenListEnvelope {
    pub data: Vec<McpTokenData>,
}

#[derive(Serialize, JsonSchema, ToSchema)]
pub struct CreatedMcpTokenEnvelope {
    pub data: CreatedMcpTokenData,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct McpToolOutput {
    pub data: Value,
    pub message: String,
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&Rfc3339)
        .unwrap_or_else(|_| "unknown".to_owned())
}

fn token_data(record: McpTokenRecord) -> McpTokenData {
    McpTokenData {
        token_id: record.id.to_string(),
        name: record.name,
        token_prefix: record.token_prefix,
        scope: record.scope,
        expires_at: record.expires_at.map(format_time),
        last_used_at: record.last_used_at.map(format_time),
        revoked_at: record.revoked_at.map(format_time),
        created_at: format_time(record.created_at),
    }
}

fn mcp_error(message: impl Into<String>) -> String {
    message.into()
}

fn parse_expiry(
    value: Option<String>,
    request_id: RequestId,
) -> Result<Option<OffsetDateTime>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let expiry = OffsetDateTime::parse(&value, &Rfc3339)
        .map_err(|_| ApiError::invalid_mcp_token(request_id.clone()))?;
    if expiry <= OffsetDateTime::now_utc() {
        return Err(ApiError::invalid_mcp_token(request_id));
    }
    Ok(Some(expiry))
}

async fn load_token_records(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<McpTokenRecord>, sqlx::Error> {
    sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            String,
            Option<OffsetDateTime>,
            Option<OffsetDateTime>,
            Option<OffsetDateTime>,
            OffsetDateTime,
        ),
    >(
        "SELECT id, name, token_prefix, scope, expires_at, last_used_at, revoked_at, created_at
         FROM mcp_access_tokens WHERE user_id = $1 ORDER BY created_at DESC, id DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map(|rows| {
        rows.into_iter()
            .map(|row| McpTokenRecord {
                id: row.0,
                name: row.1,
                token_prefix: row.2,
                scope: row.3,
                expires_at: row.4,
                last_used_at: row.5,
                revoked_at: row.6,
                created_at: row.7,
            })
            .collect()
    })
}

#[utoipa::path(
    post,
    path = "/api/me/mcp-tokens",
    request_body = CreateMcpTokenRequest,
    responses(
        (status = 200, description = "MCP 令牌已创建；原文只在本次响应返回", headers(("Cache-Control" = String, description = "private, no-store")), body = CreatedMcpTokenEnvelope),
        (status = 400, description = "请求体无效", body = super::error::ErrorEnvelope),
        (status = 401, description = "当前登录已失效", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 或来源校验失败", body = super::error::ErrorEnvelope),
        (status = 422, description = "令牌参数无效", body = super::error::ErrorEnvelope),
        (status = 500, description = "服务内部错误", body = super::error::ErrorEnvelope)
    )
)]
/// 创建 MCP 令牌；服务端只把原始值放入当前响应。
pub(crate) async fn create_token(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<CreateMcpTokenRequest>,
) -> Result<(HeaderMap, Json<CreatedMcpTokenEnvelope>), ApiError> {
    let session_token = validate_session_csrf(&state, &jar, &headers, request_id.clone())?;
    let auth_repository = PostgresAuthRepository::new(state.pool.clone());
    let session = current_session(&auth_repository, &SystemClock, &session_token)
        .await
        .map_err(|error| match error {
            CurrentSessionError::Unauthenticated => ApiError::unauthenticated(request_id.clone()),
            CurrentSessionError::Unavailable => ApiError::internal(request_id.clone()),
        })?;
    let name = request.name.trim();
    if name.is_empty() || name.chars().count() > MCP_TOKEN_MAX_NAME_CHARS {
        return Err(ApiError::invalid_mcp_token(request_id));
    }
    if request.scope != MCP_SCOPE_READ && request.scope != MCP_SCOPE_EXPENSES_CREATE {
        return Err(ApiError::invalid_mcp_token(request_id));
    }
    let expires_at = parse_expiry(request.expires_at, request_id.clone())?;
    let token = McpAccessToken::generate();
    let scope = request.scope;
    let now = OffsetDateTime::now_utc();
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO mcp_access_tokens
         (id, user_id, name, token_prefix, token_hash, scope, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(id)
    .bind(session.user_id)
    .bind(name)
    .bind(token.display_prefix())
    .bind(token.sha256_hash().as_slice())
    .bind(&scope)
    .bind(expires_at)
    .bind(now)
    .execute(&state.pool)
    .await
    .map_err(|error| {
        tracing::error!(%error, user_id = %session.user_id, "保存 MCP 令牌失败");
        ApiError::internal(request_id.clone())
    })?;
    let record = McpTokenRecord {
        id,
        name: name.to_owned(),
        token_prefix: token.display_prefix(),
        scope,
        expires_at,
        last_used_at: None,
        revoked_at: None,
        created_at: now,
    };
    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, no-store"),
    );
    Ok((
        response_headers,
        Json(CreatedMcpTokenEnvelope {
            data: CreatedMcpTokenData {
                token: token_data(record),
                secret: token.expose_once().to_owned(),
            },
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/api/me/mcp-tokens",
    responses(
        (status = 200, description = "当前用户的 MCP 令牌列表", body = McpTokenListEnvelope),
        (status = 401, description = "当前登录已失效", body = super::error::ErrorEnvelope),
        (status = 500, description = "服务内部错误", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn list_tokens(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
) -> Result<Json<McpTokenListEnvelope>, ApiError> {
    let session_token =
        super::collaboration::authenticate(&state, &jar, request_id.clone()).await?;
    let records = load_token_records(&state.pool, session_token.user_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, user_id = %session_token.user_id, "读取 MCP 令牌失败");
            ApiError::internal(request_id.clone())
        })?;
    Ok(Json(McpTokenListEnvelope {
        data: records.into_iter().map(token_data).collect(),
    }))
}

#[utoipa::path(
    delete,
    path = "/api/me/mcp-tokens/{token_id}",
    params(("token_id" = String, Path, description = "MCP 令牌 UUID")),
    responses(
        (status = 204, description = "令牌已撤销"),
        (status = 401, description = "当前登录已失效", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 或来源校验失败", body = super::error::ErrorEnvelope),
        (status = 404, description = "令牌不存在", body = super::error::ErrorEnvelope),
        (status = 500, description = "服务内部错误", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn revoke_token(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(token_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let session_token = validate_session_csrf(&state, &jar, &headers, request_id.clone())?;
    let auth_repository = PostgresAuthRepository::new(state.pool.clone());
    let session = current_session(&auth_repository, &SystemClock, &session_token)
        .await
        .map_err(|error| match error {
            CurrentSessionError::Unauthenticated => ApiError::unauthenticated(request_id.clone()),
            CurrentSessionError::Unavailable => ApiError::internal(request_id.clone()),
        })?;
    let token_id =
        Uuid::parse_str(&token_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let result = sqlx::query(
        "UPDATE mcp_access_tokens SET revoked_at = $1
         WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL",
    )
    .bind(OffsetDateTime::now_utc())
    .bind(token_id)
    .bind(session.user_id)
    .execute(&state.pool)
    .await
    .map_err(|error| {
        tracing::error!(%error, user_id = %session.user_id, "撤销 MCP 令牌失败");
        ApiError::internal(request_id.clone())
    })?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found(request_id));
    }
    Ok(StatusCode::NO_CONTENT)
}

/// MCP Bearer 身份认证；令牌过期、撤销或用户禁用时统一拒绝。
async fn authenticate_bearer(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<McpIdentity, StatusCode> {
    let mut authorization_values = headers.get_all(header::AUTHORIZATION).iter();
    let value = authorization_values
        .next()
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if authorization_values.next().is_some() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = McpAccessToken::parse(value).map_err(|_| StatusCode::UNAUTHORIZED)?;
    let now = OffsetDateTime::now_utc();
    let row = sqlx::query_as::<_, (Uuid, Uuid, String)>(
        "SELECT t.id, t.user_id, t.scope
         FROM mcp_access_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1 AND t.revoked_at IS NULL
           AND (t.expires_at IS NULL OR t.expires_at > $2) AND u.disabled_at IS NULL",
    )
    .bind(token.sha256_hash().as_slice())
    .bind(now)
    .fetch_optional(&state.pool)
    .await
    .map_err(|error| {
        tracing::error!(%error, "验证 MCP 令牌时读取数据库失败");
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::UNAUTHORIZED)?;
    sqlx::query("UPDATE mcp_access_tokens SET last_used_at = $1 WHERE id = $2")
        .bind(now)
        .bind(row.0)
        .execute(&state.pool)
        .await
        .map_err(|error| {
            tracing::error!(%error, "更新 MCP 令牌使用时间失败");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(McpIdentity {
        token_id: row.0,
        user_id: row.1,
        can_create_expenses: row.2 == MCP_SCOPE_EXPENSES_CREATE,
    })
}

fn origin_matches(state: &AppState, headers: &HeaderMap) -> bool {
    let mut origin_values = headers.get_all(header::ORIGIN).iter();
    let Some(origin) = origin_values.next().and_then(|value| value.to_str().ok()) else {
        return true;
    };
    if origin_values.next().is_some() {
        return false;
    }
    let Ok(origin_url) = Url::parse(origin) else {
        return false;
    };
    let Ok(base_url) = Url::parse(&state.base_origin) else {
        return false;
    };
    origin_url.scheme() == base_url.scheme()
        && origin_url.host_str() == base_url.host_str()
        && origin_url.port_or_known_default() == base_url.port_or_known_default()
}

async fn authenticate_mcp_request(
    State(state): State<AppState>,
    mut request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    if !origin_matches(&state, request.headers()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match authenticate_bearer(&state, request.headers()).await {
        Ok(identity) => {
            request.extensions_mut().insert(identity);
            next.run(request).await
        }
        Err(status) => {
            let mut response = status.into_response();
            if status == StatusCode::UNAUTHORIZED {
                response.headers_mut().insert(
                    header::WWW_AUTHENTICATE,
                    HeaderValue::from_static("Bearer realm=\"HuddleTab MCP\""),
                );
            }
            response
        }
    }
}

/// 构造无状态 MCP 服务；外层中间件先完成 Origin 和 Bearer 身份校验。
pub(crate) fn service(state: AppState) -> Router {
    let allowed_hosts = Url::parse(&state.base_origin)
        .ok()
        .and_then(|url| {
            url.host_str().map(|host| {
                url.port()
                    .map_or_else(|| host.to_owned(), |port| format!("{host}:{port}"))
            })
        })
        .into_iter()
        .chain([
            "localhost".to_owned(),
            "127.0.0.1".to_owned(),
            "::1".to_owned(),
        ])
        .collect::<Vec<_>>();
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_allowed_hosts(allowed_hosts)
        .with_allowed_origins([state.base_origin.clone()])
        .with_max_request_body_bytes(256 * 1024);
    let factory_state = state.clone();
    let service = StreamableHttpService::new(
        move || {
            Ok(McpHandler {
                state: factory_state.clone(),
            })
        },
        Arc::new(NeverSessionManager::default()),
        config,
    );
    Router::new()
        .fallback_service(service)
        .layer(middleware::from_fn_with_state(
            state,
            authenticate_mcp_request,
        ))
}

#[derive(Clone)]
struct McpHandler {
    state: AppState,
}

#[derive(Default, Deserialize, JsonSchema)]
struct EmptyArgs {}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ActivityArgs {
    activity_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RecommendationArgs {
    activity_id: String,
    strategy: Option<String>,
    hub_member_id: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CreateExpenseArgs {
    activity_id: String,
    client_mutation_id: String,
    title: String,
    category: String,
    note: Option<String>,
    occurred_at: String,
    original_currency: String,
    original_amount_minor: String,
    exchange_rate_kind: String,
    exchange_rate: String,
    exchange_rate_reference_date: Option<String>,
    exchange_rate_provider: Option<String>,
    payments: Vec<PaymentArg>,
    split: SplitArg,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct PaymentArg {
    member_id: String,
    amount_minor: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SplitArg {
    mode: String,
    members: Option<Vec<String>>,
    entries: Option<Vec<SplitEntryArg>>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SplitEntryArg {
    member_id: String,
    value: String,
}

#[tool_router]
impl McpHandler {
    #[tool(
        name = "list_activities",
        description = "列出当前用户有权限访问的活动。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn list_activities_tool(
        &self,
        Parameters(_): Parameters<EmptyArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        let repository = PostgresActivityRepository::new(self.state.pool.clone());
        let activities = list_activities(&repository, identity.user_id)
            .await
            .map_err(|_| mcp_error("活动读取失败，请稍后重试。"))?;
        let data = activities
            .into_iter()
            .map(|activity| serde_json::to_value(activity_data(activity)).unwrap_or(Value::Null))
            .collect::<Vec<_>>();
        Ok(McpJson(McpToolOutput {
            data: json!(data),
            message: "已读取活动列表。".to_owned(),
        }))
    }

    #[tool(
        name = "get_activity",
        description = "读取一个活动及其当前成员。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_activity_tool(
        &self,
        Parameters(args): Parameters<ActivityArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        let activity_id = parse_uuid(&args.activity_id)?;
        let repository = PostgresActivityRepository::new(self.state.pool.clone());
        let activity = repository_get_activity(&repository, activity_id, identity.user_id).await?;
        let members = list_activity_members(&repository, activity_id, identity.user_id)
            .await
            .map_err(|_| mcp_error("活动成员读取失败，请稍后重试。"))?;
        let data = json!({
            "activity": activity_data(activity),
            "members": members.into_iter().map(member_data).collect::<Vec<_>>(),
        });
        Ok(McpJson(McpToolOutput {
            data,
            message: "已读取活动和成员。".to_owned(),
        }))
    }

    #[tool(
        name = "get_activity_summary",
        description = "读取活动消费摘要、成员余额和结算建议。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_activity_summary_tool(
        &self,
        Parameters(args): Parameters<ActivityArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        let activity_id = parse_uuid(&args.activity_id)?;
        let repository =
            PostgresSharingRepository::new(self.state.pool.clone(), self.state.time_zone.clone());
        let summary = load_summary(&repository, activity_id, identity.user_id)
            .await
            .map_err(map_sharing_error)?;
        let data = serde_json::to_value(summary_data(summary))
            .map_err(|_| mcp_error("摘要序列化失败。"))?;
        Ok(McpJson(McpToolOutput {
            data,
            message: "已读取活动摘要。".to_owned(),
        }))
    }

    #[tool(
        name = "list_expenses",
        description = "列出活动中当前用户可见的未删除账单。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn list_expenses_tool(
        &self,
        Parameters(args): Parameters<ActivityArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        let activity_id = parse_uuid(&args.activity_id)?;
        let repository = PostgresExpenseRepository::new(self.state.pool.clone());
        let expenses = list_expenses(&repository, activity_id, identity.user_id)
            .await
            .map_err(map_expense_error)?;
        let data = expenses.into_iter().map(aggregate_data).collect::<Vec<_>>();
        Ok(McpJson(McpToolOutput {
            data: serde_json::to_value(data).unwrap_or(Value::Null),
            message: "已读取账单列表。".to_owned(),
        }))
    }

    #[tool(
        name = "get_expense",
        description = "读取一笔账单及付款、分摊和结算进度。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_expense_tool(
        &self,
        Parameters(args): Parameters<ExpenseRefArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        let activity_id = parse_uuid(&args.activity_id)?;
        let expense_id = parse_uuid(&args.expense_id)?;
        let repository = PostgresExpenseRepository::new(self.state.pool.clone());
        let expense = get_expense(&repository, activity_id, expense_id, identity.user_id)
            .await
            .map_err(map_expense_error)?;
        Ok(McpJson(McpToolOutput {
            data: serde_json::to_value(aggregate_data(expense)).unwrap_or(Value::Null),
            message: "已读取账单详情。".to_owned(),
        }))
    }

    #[tool(
        name = "list_settlements",
        description = "列出活动中的结算记录。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn list_settlements_tool(
        &self,
        Parameters(args): Parameters<ActivityArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        let activity_id = parse_uuid(&args.activity_id)?;
        let repository = PostgresSettlementRepository::new(self.state.pool.clone());
        let records = crate::application::settlement::list_settlements(
            &repository,
            activity_id,
            identity.user_id,
        )
        .await
        .map_err(|_| mcp_error("结算读取失败，请稍后重试。"))?;
        let data = records.into_iter().map(settlement_data).collect::<Vec<_>>();
        Ok(McpJson(McpToolOutput {
            data: serde_json::to_value(data).unwrap_or(Value::Null),
            message: "已读取结算列表。".to_owned(),
        }))
    }

    #[tool(
        name = "get_settlement",
        description = "读取一笔结算记录。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_settlement_tool(
        &self,
        Parameters(args): Parameters<SettlementRefArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        let activity_id = parse_uuid(&args.activity_id)?;
        let settlement_id = parse_uuid(&args.settlement_id)?;
        let repository = PostgresSettlementRepository::new(self.state.pool.clone());
        let record = crate::application::settlement::get_settlement(
            &repository,
            activity_id,
            settlement_id,
            identity.user_id,
        )
        .await
        .map_err(|_| mcp_error("结算读取失败，请稍后重试。"))?;
        Ok(McpJson(McpToolOutput {
            data: serde_json::to_value(settlement_data(record)).unwrap_or(Value::Null),
            message: "已读取结算详情。".to_owned(),
        }))
    }

    #[tool(
        name = "get_ledger",
        description = "读取活动的权威 Ledger 余额。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_ledger_tool(
        &self,
        Parameters(args): Parameters<ActivityArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        let activity_id = parse_uuid(&args.activity_id)?;
        let repository = PostgresAccountingRepository::new(self.state.pool.clone());
        let snapshot = load_ledger(&repository, activity_id, identity.user_id)
            .await
            .map_err(map_accounting_error)?;
        let data = ledger_data(snapshot);
        Ok(McpJson(McpToolOutput {
            data: serde_json::to_value(data).unwrap_or(Value::Null),
            message: "已读取权威 Ledger。".to_owned(),
        }))
    }

    #[tool(
        name = "get_settlement_recommendations",
        description = "读取确定性的结算建议；此工具不会创建结算。",
        annotations(
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn get_recommendations_tool(
        &self,
        Parameters(args): Parameters<RecommendationArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        let requested = parse_strategy(args.strategy.as_deref(), args.hub_member_id.as_deref())?;
        let activity_id = parse_uuid(&args.activity_id)?;
        let repository = PostgresAccountingRepository::new(self.state.pool.clone());
        let snapshot = load_recommendations(&repository, activity_id, identity.user_id, requested)
            .await
            .map_err(map_accounting_error)?;
        let data = crate::http::accounting::recommendation_data(snapshot);
        Ok(McpJson(McpToolOutput {
            data: serde_json::to_value(data).unwrap_or(Value::Null),
            message: "已读取结算建议；未创建任何结算。".to_owned(),
        }))
    }

    #[tool(
        name = "create_expense",
        description = "直接创建一笔正式账单。调用成功会立即写入 HuddleTab；必须提供稳定的 clientMutationId 以保证重试幂等。",
        annotations(
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn create_expense_tool(
        &self,
        Parameters(args): Parameters<CreateExpenseArgs>,
        context: RequestContext<RoleServer>,
    ) -> Result<McpJson<McpToolOutput>, String> {
        let identity = context_identity(&context)?;
        if !identity.can_create_expenses {
            return Err(mcp_error("当前 MCP 令牌没有新增账单权限。"));
        }
        self.state
            .rate_limiter
            .check(
                super::rate_limit::RateLimitCategory::SensitiveAuthenticated,
                identity.token_id.to_string(),
            )
            .map_err(|_| mcp_error("MCP 新增账单请求过于频繁，请稍后再试。"))?;
        let input = create_expense_input(args, identity.user_id)?;
        // MCP 正式账单必须复用标准 create_expense 用例；Expense Repository 会在同一事务中
        // 增加 revision 和 EXPENSE_CREATED 活动记录，重试幂等重放也不会重复写入审计。
        let repository = PostgresExpenseRepository::new(self.state.pool.clone());
        let result = create_expense(&repository, &SystemClock, input)
            .await
            .map_err(map_expense_error)?;
        let aggregate = aggregate_data(result.aggregate);
        let data = CreatedExpenseData {
            expense: aggregate.expense,
            payments: aggregate.payments,
            shares: aggregate.shares,
            settlement_progress: aggregate.settlement_progress,
            idempotent_replay: result.idempotent_replay,
        };
        Ok(McpJson(McpToolOutput {
            data: serde_json::to_value(data).unwrap_or(Value::Null),
            message: if result.idempotent_replay {
                "账单已存在，本次返回幂等重放结果。".to_owned()
            } else {
                "账单已直接创建。".to_owned()
            },
        }))
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ExpenseRefArgs {
    activity_id: String,
    expense_id: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SettlementRefArgs {
    activity_id: String,
    settlement_id: String,
}

fn parse_uuid(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| mcp_error("UUID 格式无效。"))
}

/// MCP SDK 将 HTTP 请求的 `Parts` 放入请求上下文；Bearer 身份保存在其中的扩展里。
/// 统一从这里读取，避免工具绕过 HTTP 层重新解析令牌。
fn context_identity(context: &RequestContext<RoleServer>) -> Result<McpIdentity, String> {
    context
        .extensions
        .get::<axum::http::request::Parts>()
        .and_then(|parts| parts.extensions.get::<McpIdentity>())
        .cloned()
        .ok_or_else(|| mcp_error("MCP 身份缺失，请重新连接。"))
}

async fn repository_get_activity(
    repository: &PostgresActivityRepository,
    activity_id: Uuid,
    user_id: Uuid,
) -> Result<ActivityView, String> {
    crate::application::activity::get_activity(repository, activity_id, user_id)
        .await
        .map_err(|_| mcp_error("活动不存在或当前用户不可访问。"))
}

fn parse_strategy(
    strategy: Option<&str>,
    hub_member_id: Option<&str>,
) -> Result<RequestedRecommendationStrategy, String> {
    match (strategy, hub_member_id) {
        (None, None) => Ok(RequestedRecommendationStrategy::Default),
        (Some("min_transfers"), None) => Ok(RequestedRecommendationStrategy::MinTransfers),
        (Some("centralized"), Some(hub)) => Ok(RequestedRecommendationStrategy::Centralized {
            hub_member_id: parse_uuid(hub)?,
        }),
        _ => Err(mcp_error("结算策略参数无效。")),
    }
}

fn create_expense_input(
    args: CreateExpenseArgs,
    actor_user_id: Uuid,
) -> Result<CreateExpenseInput, String> {
    let occurred_at = OffsetDateTime::parse(&args.occurred_at, &Rfc3339)
        .map_err(|_| mcp_error("发生时间必须是 RFC3339。"))?;
    let exchange_rate_reference_date = args
        .exchange_rate_reference_date
        .map(|value| {
            Date::parse(
                &value,
                &time::macros::format_description!("[year]-[month]-[day]"),
            )
        })
        .transpose()
        .map_err(|_| mcp_error("汇率参考日期必须是 YYYY-MM-DD。"))?;
    let payments = args
        .payments
        .into_iter()
        .map(|payment| {
            Ok(PaymentInput {
                member_id: parse_uuid(&payment.member_id)?,
                amount_minor: payment.amount_minor,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let split = match args.split.mode.as_str() {
        "EQUAL" => ExpenseSplitInput::Equal(
            args.split
                .members
                .ok_or_else(|| mcp_error("EQUAL 分摊需要 members。"))?
                .into_iter()
                .map(|id| parse_uuid(&id))
                .collect::<Result<Vec<_>, _>>()?,
        ),
        "EXACT" | "PERCENTAGE" | "WEIGHT" => {
            let entries = args
                .split
                .entries
                .ok_or_else(|| mcp_error("该分摊模式需要 entries。"))?
                .into_iter()
                .map(|entry| {
                    Ok(SplitEntryInput {
                        member_id: parse_uuid(&entry.member_id)?,
                        value: entry.value,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            match args.split.mode.as_str() {
                "EXACT" => ExpenseSplitInput::Exact(entries),
                "PERCENTAGE" => ExpenseSplitInput::Percentage(entries),
                _ => ExpenseSplitInput::Weight(entries),
            }
        }
        _ => {
            return Err(mcp_error(
                "分摊模式必须是 EQUAL、EXACT、PERCENTAGE 或 WEIGHT。",
            ));
        }
    };
    Ok(CreateExpenseInput {
        activity_id: parse_uuid(&args.activity_id)?,
        actor_user_id,
        audit_source: ExpenseAuditSource::Mcp,
        draft: ExpenseDraftInput {
            client_mutation_id: parse_uuid(&args.client_mutation_id)?,
            title: args.title,
            category: args.category,
            note: args.note,
            occurred_at,
            original_currency: args.original_currency,
            original_amount_minor: args.original_amount_minor,
            exchange_rate_kind: args.exchange_rate_kind,
            exchange_rate: args.exchange_rate,
            exchange_rate_reference_date,
            exchange_rate_provider: args.exchange_rate_provider,
            payments,
            split,
        },
    })
}

fn map_expense_error(error: ExpenseError) -> String {
    match error {
        ExpenseError::InvalidInput => "账单输入无效，请检查金额、币种、时间和分摊。",
        ExpenseError::Forbidden => "当前用户没有该活动的账单操作权限。",
        ExpenseError::NotFound => "账单不存在或当前用户不可访问。",
        ExpenseError::VersionConflict => "账单版本冲突，请重新读取后重试。",
        ExpenseError::MutationConflict => "clientMutationId 已用于其他账单。",
        ExpenseError::InvalidMember => "账单包含无效或非活动成员。",
        ExpenseError::HasSettlementAllocations => "账单已有结算归属，当前操作被拒绝。",
        ExpenseError::Unavailable => "账单服务暂时不可用，请稍后重试。",
    }
    .to_owned()
}

fn map_accounting_error(error: crate::application::accounting::AccountingError) -> String {
    match error {
        crate::application::accounting::AccountingError::Forbidden => {
            "当前用户没有该活动的账本读取权限。"
        }
        crate::application::accounting::AccountingError::Integrity => {
            "账务事实不完整，暂时无法计算 Ledger。"
        }
        crate::application::accounting::AccountingError::Unavailable => {
            "账本服务暂时不可用，请稍后重试。"
        }
        crate::application::accounting::AccountingError::InvalidRecommendationStrategy => {
            "结算策略参数无效。"
        }
        crate::application::accounting::AccountingError::RecommendationHubForbidden => {
            "统一结算人必须是当前用户在活动中的有效成员。"
        }
    }
    .to_owned()
}

fn map_sharing_error(error: SharingError) -> String {
    match error {
        SharingError::Forbidden => "当前用户没有该活动的摘要读取权限。",
        SharingError::Integrity => "账务事实不完整，暂时无法生成摘要。",
        SharingError::Unavailable => "活动摘要服务暂时不可用，请稍后重试。",
        SharingError::InvalidStrategy => "结算策略参数无效。",
    }
    .to_owned()
}

fn ledger_data(snapshot: crate::application::accounting::LedgerSnapshot) -> LedgerData {
    LedgerData {
        base_currency: snapshot.base_currency,
        revision: snapshot.revision.to_string(),
        balances: snapshot
            .balances
            .into_iter()
            .map(|balance| BalanceData {
                member_id: balance.member_id().to_string(),
                net_minor: balance.net_minor().to_string(),
            })
            .collect(),
    }
}

#[tool_handler]
impl ServerHandler for McpHandler {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .enable_prompts()
                .build(),
        )
        .with_server_info(Implementation::new("huddletab", env!("CARGO_PKG_VERSION")))
        .with_instructions("HuddleTab MCP：读取活动账务并直接新增账单。新增账单会立即写入；结算建议不会自动创建付款记录。")
    }

    fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListResourcesResult, McpError>> + Send + '_ {
        std::future::ready(Ok(ListResourcesResult::with_all_items(vec![
            Resource::new("huddletab://activities", "activities")
                .with_description("当前用户可见的活动列表")
                .with_mime_type("application/json"),
        ])))
    }

    fn list_resource_templates(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListResourceTemplatesResult, McpError>> + Send + '_
    {
        let templates = vec![
            ResourceTemplate::new("huddletab://activities/{activityId}", "activity"),
            ResourceTemplate::new("huddletab://activities/{activityId}/members", "members"),
            ResourceTemplate::new("huddletab://activities/{activityId}/expenses", "expenses"),
            ResourceTemplate::new(
                "huddletab://activities/{activityId}/expenses/{expenseId}",
                "expense",
            ),
            ResourceTemplate::new(
                "huddletab://activities/{activityId}/settlements",
                "settlements",
            ),
            ResourceTemplate::new(
                "huddletab://activities/{activityId}/settlements/{settlementId}",
                "settlement",
            ),
            ResourceTemplate::new("huddletab://activities/{activityId}/ledger", "ledger"),
            ResourceTemplate::new(
                "huddletab://activities/{activityId}/recommendations",
                "recommendations",
            ),
            ResourceTemplate::new("huddletab://activities/{activityId}/summary", "summary"),
        ]
        .into_iter()
        .map(|template| {
            template
                .with_description("HuddleTab 活动账务 JSON 资源")
                .with_mime_type("application/json")
        })
        .collect();
        std::future::ready(Ok(ListResourceTemplatesResult::with_all_items(templates)))
    }

    fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ReadResourceResponse, McpError>> + Send + '_ {
        let handler = self.clone();
        async move {
            let identity = context_identity(&context)
                .map_err(|message| McpError::internal_error(message, None))?;
            let value = handler
                .read_resource_value(&request.uri, identity)
                .await
                .map_err(|message| McpError::invalid_params(message, None))?;
            Ok(ReadResourceResult::new(vec![
                ResourceContents::text(
                    serde_json::to_string(&value).unwrap_or_else(|_| "{}".to_owned()),
                    request.uri,
                )
                .with_mime_type("application/json"),
            ])
            .with_cache_scope(CacheScope::Private)
            .into())
        }
    }

    fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListPromptsResult, McpError>> + Send + '_ {
        let prompts = vec![
            Prompt::new(
                "record_expense",
                Some("整理描述并直接新增一笔 HuddleTab 账单"),
                Some(vec![
                    PromptArgument::new("activity_id").with_required(true),
                    PromptArgument::new("description").with_required(true),
                ]),
            ),
            Prompt::new(
                "review_activity_finances",
                Some("复盘活动消费、余额和结算建议"),
                Some(vec![
                    PromptArgument::new("activity_id").with_required(true),
                    PromptArgument::new("focus"),
                ]),
            ),
            Prompt::new(
                "plan_settlement",
                Some("生成结算方案，但不自动创建结算"),
                Some(vec![PromptArgument::new("activity_id").with_required(true)]),
            ),
        ];
        std::future::ready(Ok(ListPromptsResult::with_all_items(prompts)))
    }

    fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl std::future::Future<Output = Result<GetPromptResponse, McpError>> + Send + '_ {
        std::future::ready(prompt_result(request).map(Into::into))
    }
}

impl McpHandler {
    #[allow(clippy::too_many_lines)]
    async fn read_resource_value(&self, uri: &str, identity: McpIdentity) -> Result<Value, String> {
        let parts = uri
            .strip_prefix("huddletab://")
            .ok_or_else(|| mcp_error("资源 URI 无效。"))?
            .split('/')
            .collect::<Vec<_>>();
        if parts.as_slice() == ["activities"] {
            let repository = PostgresActivityRepository::new(self.state.pool.clone());
            let activities = list_activities(&repository, identity.user_id)
                .await
                .map_err(|_| mcp_error("活动读取失败，请稍后重试。"))?;
            return serde_json::to_value(
                activities
                    .into_iter()
                    .map(activity_data)
                    .collect::<Vec<ActivityData>>(),
            )
            .map_err(|_| mcp_error("资源序列化失败。"));
        }
        if parts.len() < 2 || parts[0] != "activities" {
            return Err(mcp_error("资源 URI 无效。"));
        }
        let activity_id = parse_uuid(parts[1])?;
        let repository = PostgresActivityRepository::new(self.state.pool.clone());
        match parts.as_slice() {
            ["activities", _, "members"] => Ok(serde_json::to_value(
                list_activity_members(&repository, activity_id, identity.user_id)
                    .await
                    .map_err(|_| mcp_error("成员读取失败。"))?
                    .into_iter()
                    .map(member_data)
                    .collect::<Vec<ActivityMemberData>>(),
            )
            .unwrap_or(Value::Null)),
            ["activities", _] => Ok(serde_json::to_value(
                repository_get_activity(&repository, activity_id, identity.user_id)
                    .await
                    .map(activity_data)?,
            )
            .unwrap_or(Value::Null)),
            ["activities", _, "expenses"] => {
                let repo = PostgresExpenseRepository::new(self.state.pool.clone());
                Ok(serde_json::to_value(
                    list_expenses(&repo, activity_id, identity.user_id)
                        .await
                        .map_err(map_expense_error)?
                        .into_iter()
                        .map(aggregate_data)
                        .collect::<Vec<ExpenseAggregateData>>(),
                )
                .unwrap_or(Value::Null))
            }
            ["activities", _, "expenses", expense_id] => {
                let repo = PostgresExpenseRepository::new(self.state.pool.clone());
                let expense = get_expense(
                    &repo,
                    activity_id,
                    parse_uuid(expense_id)?,
                    identity.user_id,
                )
                .await
                .map_err(map_expense_error)?;
                Ok(serde_json::to_value(aggregate_data(expense)).unwrap_or(Value::Null))
            }
            ["activities", _, "settlements"] => {
                let repo = PostgresSettlementRepository::new(self.state.pool.clone());
                let records = crate::application::settlement::list_settlements(
                    &repo,
                    activity_id,
                    identity.user_id,
                )
                .await
                .map_err(|_| mcp_error("结算读取失败。"))?;
                Ok(serde_json::to_value(
                    records
                        .into_iter()
                        .map(settlement_data)
                        .collect::<Vec<SettlementData>>(),
                )
                .unwrap_or(Value::Null))
            }
            ["activities", _, "settlements", settlement_id] => {
                let repo = PostgresSettlementRepository::new(self.state.pool.clone());
                let record = crate::application::settlement::get_settlement(
                    &repo,
                    activity_id,
                    parse_uuid(settlement_id)?,
                    identity.user_id,
                )
                .await
                .map_err(|_| mcp_error("结算读取失败。"))?;
                Ok(serde_json::to_value(settlement_data(record)).unwrap_or(Value::Null))
            }
            ["activities", _, "ledger"] => {
                let repo = PostgresAccountingRepository::new(self.state.pool.clone());
                Ok(serde_json::to_value(ledger_data(
                    load_ledger(&repo, activity_id, identity.user_id)
                        .await
                        .map_err(map_accounting_error)?,
                ))
                .unwrap_or(Value::Null))
            }
            ["activities", _, "recommendations"] => {
                let repo = PostgresAccountingRepository::new(self.state.pool.clone());
                Ok(
                    serde_json::to_value(crate::http::accounting::recommendation_data(
                        load_recommendations(
                            &repo,
                            activity_id,
                            identity.user_id,
                            RequestedRecommendationStrategy::Default,
                        )
                        .await
                        .map_err(map_accounting_error)?,
                    ))
                    .unwrap_or(Value::Null),
                )
            }
            ["activities", _, "summary"] => {
                let repo = PostgresSharingRepository::new(
                    self.state.pool.clone(),
                    self.state.time_zone.clone(),
                );
                Ok(serde_json::to_value(summary_data(
                    load_summary(&repo, activity_id, identity.user_id)
                        .await
                        .map_err(map_sharing_error)?,
                ))
                .unwrap_or(Value::Null))
            }
            _ => Err(mcp_error("资源不存在。")),
        }
    }
}

fn prompt_result(request: GetPromptRequestParams) -> Result<GetPromptResult, McpError> {
    let args = request.arguments.unwrap_or_default();
    let activity_id = args
        .get("activity_id")
        .and_then(Value::as_str)
        .unwrap_or("<activity_id>");
    let result = match request.name.as_str() {
        "record_expense" => {
            let description = args.get("description").and_then(Value::as_str).unwrap_or("<description>");
            GetPromptResult::new(vec![PromptMessage::new_text(Role::User, format!("请读取活动 {activity_id} 的成员和主币种，然后根据以下描述调用 create_expense 直接新增账单：{description}。调用前补齐所有必填字段，调用成功后报告账单 ID；不要调用结算工具。"))]).with_description("直接新增账单")
        }
        "review_activity_finances" => GetPromptResult::new(vec![PromptMessage::new_text(Role::User, format!("请读取活动 {activity_id} 的 summary、expenses 和 ledger，说明总消费、成员实际分摊、余额与未完成结算；不要把余额称为个人消费。"))]).with_description("活动财务复盘"),
        "plan_settlement" => GetPromptResult::new(vec![PromptMessage::new_text(Role::User, format!("请读取活动 {activity_id} 的 ledger、recommendations 和 settlements，给出结算方案。仅提供建议，不要创建或修改 settlement。"))]).with_description("结算方案建议"),
        _ => return Err(McpError::invalid_params("提示词不存在。", None)),
    };
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::McpHandler;

    #[test]
    fn tool_router_keeps_reads_and_direct_expense_write_explicit() {
        let router = McpHandler::tool_router();
        let names = router
            .list_all()
            .into_iter()
            .map(|tool| tool.name.to_string())
            .collect::<Vec<_>>();
        for name in [
            "list_activities",
            "get_activity",
            "get_activity_summary",
            "list_expenses",
            "get_expense",
            "list_settlements",
            "get_settlement",
            "get_ledger",
            "get_settlement_recommendations",
            "create_expense",
        ] {
            assert!(
                names.iter().any(|candidate| candidate == name),
                "缺少 MCP 工具 {name}"
            );
        }
    }
}
