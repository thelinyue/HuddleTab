use axum::{Extension, Json, extract::State, http::HeaderMap};
use axum_extra::extract::cookie::CookieJar;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::infrastructure::push::validate_subscription;

use super::{
    collaboration::{authenticate, authenticate_mutation},
    error::{ApiError, RequestId},
    router::AppState,
};

#[derive(Serialize, ToSchema)]
pub struct PushSettingsEnvelope {
    pub data: PushSettingsData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushSettingsData {
    pub available: bool,
    pub application_server_key: Option<String>,
    pub preferences: PushPreferencesData,
}

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[allow(clippy::struct_excessive_bools)]
#[serde(rename_all = "camelCase")]
pub struct PushPreferencesData {
    pub membership: bool,
    pub expense: bool,
    pub settlement: bool,
    pub activity: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushSubscriptionRequest {
    pub endpoint: String,
    pub keys: PushSubscriptionKeys,
    pub expiration_time: Option<i64>,
}

#[derive(Deserialize, ToSchema)]
pub struct PushSubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Deserialize, ToSchema)]
pub struct PushSubscriptionDeleteRequest {
    pub endpoint: String,
}

#[derive(Serialize, ToSchema)]
pub struct PushSubscriptionEnvelope {
    pub data: PushSubscriptionData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PushSubscriptionData {
    pub registered: bool,
}

#[utoipa::path(
    get,
    path = "/api/me/push-settings",
    responses(
        (status = 200, description = "当前账号的 PWA 推送设置", body = PushSettingsEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn get_push_settings(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
) -> Result<Json<PushSettingsEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let preferences = load_preferences(&state, actor.user_id, &request_id).await?;
    Ok(Json(PushSettingsEnvelope {
        data: PushSettingsData {
            available: state.push_service.is_enabled(),
            application_server_key: state.push_service.public_key().map(ToOwned::to_owned),
            preferences,
        },
    }))
}

#[utoipa::path(
    put,
    path = "/api/me/push-settings",
    request_body = PushPreferencesData,
    params(("x-csrf-token" = String, Header, description = "当前 Session 的 CSRF token")),
    responses(
        (status = 200, description = "PWA 推送设置已更新", body = PushSettingsEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 无效", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn update_push_settings(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(preferences): Json<PushPreferencesData>,
) -> Result<Json<PushSettingsEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    sqlx::query(
        "INSERT INTO notification_push_preferences
            (user_id, membership_enabled, expense_enabled, settlement_enabled, activity_enabled, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET
            membership_enabled = EXCLUDED.membership_enabled,
            expense_enabled = EXCLUDED.expense_enabled,
            settlement_enabled = EXCLUDED.settlement_enabled,
            activity_enabled = EXCLUDED.activity_enabled,
            updated_at = EXCLUDED.updated_at",
    )
    .bind(actor.user_id)
    .bind(preferences.membership)
    .bind(preferences.expense)
    .bind(preferences.settlement)
    .bind(preferences.activity)
    .bind(OffsetDateTime::now_utc())
    .execute(&state.pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, request_id = %request_id.0, "保存 PWA 推送偏好失败");
        ApiError::internal(request_id.clone())
    })?;
    Ok(Json(PushSettingsEnvelope {
        data: PushSettingsData {
            available: state.push_service.is_enabled(),
            application_server_key: state.push_service.public_key().map(ToOwned::to_owned),
            preferences,
        },
    }))
}

#[utoipa::path(
    post,
    path = "/api/me/push-subscriptions",
    request_body = PushSubscriptionRequest,
    params(("x-csrf-token" = String, Header, description = "当前 Session 的 CSRF token")),
    responses(
        (status = 200, description = "PWA 推送设备已登记", body = PushSubscriptionEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 无效", body = super::error::ErrorEnvelope),
        (status = 422, description = "订阅信息无效", body = super::error::ErrorEnvelope),
        (status = 503, description = "推送服务未配置", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn register_subscription(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(subscription): Json<PushSubscriptionRequest>,
) -> Result<Json<PushSubscriptionEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    if !state.push_service.is_enabled() {
        return Err(ApiError::push_unavailable(request_id));
    }
    if subscription.expiration_time.is_some_and(|value| value < 0) {
        return Err(ApiError::invalid_push_subscription(request_id));
    }
    validate_subscription(
        &subscription.endpoint,
        &subscription.keys.p256dh,
        &subscription.keys.auth,
    )
    .await
    .map_err(|error| {
        tracing::warn!(error = %error, request_id = %request_id.0, "拒绝无效的 PWA 推送订阅");
        ApiError::invalid_push_subscription(request_id.clone())
    })?;
    let now = OffsetDateTime::now_utc();
    let mut transaction = state.pool.begin().await.map_err(|error| {
        tracing::error!(error = %error, request_id = %request_id.0, "登记 PWA 推送设备时无法开启事务");
        ApiError::internal(request_id.clone())
    })?;
    sqlx::query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id <> $2")
        .bind(&subscription.endpoint)
        .bind(actor.user_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, request_id = %request_id.0, "清理旧 PWA 推送设备失败");
            ApiError::internal(request_id.clone())
        })?;
    sqlx::query(
        "INSERT INTO push_subscriptions
            (id, user_id, endpoint, p256dh, auth, expiration_time, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (endpoint) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            expiration_time = EXCLUDED.expiration_time,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at",
    )
    .bind(Uuid::new_v4())
    .bind(actor.user_id)
    .bind(&subscription.endpoint)
    .bind(&subscription.keys.p256dh)
    .bind(&subscription.keys.auth)
    .bind(subscription.expiration_time)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, request_id = %request_id.0, "保存 PWA 推送设备失败");
        ApiError::internal(request_id.clone())
    })?;
    transaction.commit().await.map_err(|error| {
        tracing::error!(error = %error, request_id = %request_id.0, "提交 PWA 推送设备事务失败");
        ApiError::internal(request_id.clone())
    })?;
    Ok(Json(PushSubscriptionEnvelope {
        data: PushSubscriptionData { registered: true },
    }))
}

#[utoipa::path(
    delete,
    path = "/api/me/push-subscriptions",
    request_body = PushSubscriptionDeleteRequest,
    params(("x-csrf-token" = String, Header, description = "当前 Session 的 CSRF token")),
    responses(
        (status = 200, description = "PWA 推送设备已注销", body = PushSubscriptionEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 无效", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn delete_subscription(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<PushSubscriptionDeleteRequest>,
) -> Result<Json<PushSubscriptionEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    if request.endpoint.len() > 4096 || request.endpoint.is_empty() {
        return Err(ApiError::invalid_push_subscription(request_id));
    }
    sqlx::query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2")
        .bind(actor.user_id)
        .bind(request.endpoint)
        .execute(&state.pool)
        .await
        .map_err(|error| {
            tracing::error!(error = %error, request_id = %request_id.0, "注销 PWA 推送设备失败");
            ApiError::internal(request_id.clone())
        })?;
    Ok(Json(PushSubscriptionEnvelope {
        data: PushSubscriptionData { registered: false },
    }))
}

async fn load_preferences(
    state: &AppState,
    user_id: Uuid,
    request_id: &RequestId,
) -> Result<PushPreferencesData, ApiError> {
    let row = sqlx::query_as::<_, (bool, bool, bool, bool)>(
        "SELECT membership_enabled, expense_enabled, settlement_enabled, activity_enabled
         FROM notification_push_preferences WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|error| {
        tracing::error!(error = %error, request_id = %request_id.0, "读取 PWA 推送偏好失败");
        ApiError::internal(request_id.clone())
    })?;
    let (membership, expense, settlement, activity) = row.unwrap_or((true, true, true, true));
    Ok(PushPreferencesData {
        membership,
        expense,
        settlement,
        activity,
    })
}
