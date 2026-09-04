use std::collections::BTreeMap;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::HeaderMap,
};
use axum_extra::extract::cookie::CookieJar;
use serde::Serialize;
use time::format_description::well_known::Rfc3339;
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
    pub time_zone: String,
}

#[derive(Serialize, ToSchema)]
pub struct NotificationEnvelope {
    pub data: NotificationData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NotificationData {
    pub notification_id: String,
    pub kind: NotificationKindData,
    pub target_type: NotificationTargetTypeData,
    pub target_id: String,
    pub activity_id: String,
    pub payload: BTreeMap<String, String>,
    pub read_at: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NotificationKindData {
    JoinApprovalRequested,
    JoinApprovalResolved,
    MemberJoined,
    ParticipatingExpenseChanged,
    ParticipatingExpenseDeleted,
    SettlementReceived,
    ActivityStatusChanged,
    OwnershipChanged,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NotificationTargetTypeData {
    Activity,
    Expense,
    Settlement,
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
    let repository = PostgresNotificationRepository::new(state.pool.clone());
    let list = list_notifications(&repository, actor.user_id)
        .await
        .map_err(|error| map_error(error, request_id.clone()))?;
    let items = list
        .items
        .into_iter()
        .map(|item| notification_data(&item, &request_id))
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(Json(NotificationListEnvelope {
        data: NotificationListData {
            items,
            unread_count: list.unread_count,
            time_zone: state.time_zone,
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
        data: notification_data(&notification, &request_id)?,
    }))
}

/// payload 只承载通知文案所需的最小字符串字段，页面导航继续使用受控 kind/target 列。
fn notification_data(
    notification: &NotificationView,
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
        kind: parse_kind(&notification.kind)
            .ok_or_else(|| ApiError::internal(request_id.clone()))?,
        target_type: parse_target_type(&notification.target_type)
            .ok_or_else(|| ApiError::internal(request_id.clone()))?,
        target_id: notification.target_id.to_string(),
        activity_id: notification.activity_id.to_string(),
        payload,
        read_at: notification
            .read_at
            .map(|value| value.format(&Rfc3339).expect("数据库时间始终可格式化")),
        created_at: notification
            .created_at
            .format(&Rfc3339)
            .expect("数据库时间始终可格式化"),
    })
}

fn parse_kind(value: &str) -> Option<NotificationKindData> {
    Some(match value {
        "JOIN_APPROVAL_REQUESTED" => NotificationKindData::JoinApprovalRequested,
        "JOIN_APPROVAL_RESOLVED" => NotificationKindData::JoinApprovalResolved,
        "MEMBER_JOINED" => NotificationKindData::MemberJoined,
        "PARTICIPATING_EXPENSE_CHANGED" => NotificationKindData::ParticipatingExpenseChanged,
        "PARTICIPATING_EXPENSE_DELETED" => NotificationKindData::ParticipatingExpenseDeleted,
        "SETTLEMENT_RECEIVED" => NotificationKindData::SettlementReceived,
        "ACTIVITY_STATUS_CHANGED" => NotificationKindData::ActivityStatusChanged,
        "OWNERSHIP_CHANGED" => NotificationKindData::OwnershipChanged,
        _ => return None,
    })
}

fn parse_target_type(value: &str) -> Option<NotificationTargetTypeData> {
    Some(match value {
        "ACTIVITY" => NotificationTargetTypeData::Activity,
        "EXPENSE" => NotificationTargetTypeData::Expense,
        "SETTLEMENT" => NotificationTargetTypeData::Settlement,
        _ => return None,
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
