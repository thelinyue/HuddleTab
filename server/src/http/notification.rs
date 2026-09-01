use std::collections::BTreeMap;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::HeaderMap,
};
use axum_extra::extract::cookie::CookieJar;
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::notification::{
        NotificationError, NotificationView, list_notifications, mark_notification_read,
    },
    infrastructure::{clock::SystemClock, notification_repository::PostgresNotificationRepository},
};

use super::{
    collaboration::{authenticate, authenticate_mutation},
    error::{ApiError, RequestId},
    router::AppState,
};

#[derive(Serialize, ToSchema)]
pub struct NotificationListEnvelope {
    pub data: NotificationListData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListData {
    pub items: Vec<NotificationData>,
    pub unread_count: usize,
}

#[derive(Serialize, ToSchema)]
pub struct NotificationEnvelope {
    pub data: NotificationData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationData {
    pub notification_id: String,
    pub kind: String,
    pub target_type: String,
    pub target_id: String,
    pub activity_id: String,
    pub payload: BTreeMap<String, String>,
    pub read_at: Option<String>,
    pub created_at: String,
}

#[utoipa::path(
    get,
    path = "/api/notifications",
    responses(
        (status = 200, description = "当前用户通知", body = NotificationListEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn list(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    jar: CookieJar,
) -> Result<Json<NotificationListEnvelope>, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let repository = PostgresNotificationRepository::new(state.pool);
    let list = list_notifications(&repository, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id.clone()))?;
    let items = list
        .items
        .into_iter()
        .map(|item| notification_data(item, &request_id))
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(Json(NotificationListEnvelope {
        data: NotificationListData {
            items,
            unread_count: list.unread_count,
        },
    }))
}

#[utoipa::path(
    post,
    path = "/api/notifications/{notification_id}/read",
    params(
        ("notification_id" = String, Path, description = "通知 UUID"),
        ("x-csrf-token" = String, Header, description = "当前 Session 的 CSRF token")
    ),
    responses(
        (status = 200, description = "通知已读", body = NotificationEnvelope),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 403, description = "CSRF 无效", body = super::error::ErrorEnvelope),
        (status = 404, description = "通知不存在", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn mark_read(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(notification_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<Json<NotificationEnvelope>, ApiError> {
    let actor = authenticate_mutation(&state, &jar, &headers, request_id.clone()).await?;
    let notification_id =
        Uuid::parse_str(&notification_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    let repository = PostgresNotificationRepository::new(state.pool);
    let notification =
        mark_notification_read(&repository, &SystemClock, notification_id, actor.user_id)
            .await
            .map_err(|error| map_error(error, request_id.clone()))?;
    Ok(Json(NotificationEnvelope {
        data: notification_data(notification, &request_id)?,
    }))
}

/// payload 只允许审批事务写入的字符串定位字段，页面导航继续使用受控 target 列。
fn notification_data(
    notification: NotificationView,
    request_id: &RequestId,
) -> Result<NotificationData, ApiError> {
    let payload = notification
        .payload
        .as_object()
        .ok_or_else(|| ApiError::internal(request_id.clone()))?
        .iter()
        .map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.to_owned()))
                .ok_or_else(|| ApiError::internal(request_id.clone()))
        })
        .collect::<Result<BTreeMap<_, _>, ApiError>>()?;
    Ok(NotificationData {
        notification_id: notification.id.to_string(),
        kind: notification.kind,
        target_type: notification.target_type,
        target_id: notification.target_id.to_string(),
        activity_id: notification.activity_id.to_string(),
        payload,
        read_at: notification.read_at.map(|value| value.to_string()),
        created_at: notification.created_at.to_string(),
    })
}

fn map_error(error: NotificationError, request_id: RequestId) -> ApiError {
    match error {
        NotificationError::NotFound => ApiError::not_found(request_id),
        NotificationError::Integrity | NotificationError::Unavailable => {
            ApiError::internal(request_id)
        }
    }
}
