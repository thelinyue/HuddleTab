use std::str::FromStr as _;

use axum::{
    Extension, Json,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header::CACHE_CONTROL},
    response::{IntoResponse as _, Response},
};
use axum_extra::extract::cookie::CookieJar;
use headers::{ETag, HeaderMapExt as _, IfNoneMatch};
use serde::Serialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    application::snapshot::{
        ActivitySnapshot, SnapshotCondition, SnapshotError, SnapshotResult, load_snapshot,
    },
    infrastructure::snapshot_repository::PostgresSnapshotRepository,
};

use super::{
    accounting::{BalanceData, LedgerData, RecommendationData, RecommendationItemData},
    activity::{ActivityData, ActivityMemberData, activity_data, member_data},
    collaboration::authenticate,
    error::{ApiError, RequestId},
    expense::{ExpenseAggregateData, aggregate_data},
    router::AppState,
    settlement::{SettlementData, settlement_data},
};

const PRIVATE_NO_STORE: &str = "private, no-store";

#[derive(Serialize, ToSchema)]
pub struct ActivitySnapshotEnvelope {
    pub data: ActivitySnapshotData,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshotData {
    pub revision: String,
    pub activity: ActivityData,
    pub members: Vec<ActivityMemberData>,
    pub expenses: Vec<ExpenseAggregateData>,
    pub settlements: Vec<SettlementData>,
    pub ledger: LedgerData,
    pub recommendations: RecommendationData,
}

struct HeaderCondition(Option<IfNoneMatch>);

impl SnapshotCondition for HeaderCondition {
    fn matches(&self, revision: i64) -> bool {
        let Some(condition) = &self.0 else {
            return false;
        };
        let etag = ETag::from_str(&weak_etag(revision)).expect("正整数 revision 始终是合法 ETag");
        !condition.precondition_passes(&etag)
    }
}

#[utoipa::path(
    get,
    path = "/api/activities/{activity_id}/snapshot",
    operation_id = "getActivitySnapshot",
    params(
        ("activity_id" = String, Path, description = "活动 UUID"),
        ("If-None-Match" = Option<String>, Header, description = "上次完整 Snapshot 的 weak ETag")
    ),
    responses(
        (status = 200, description = "完整 Activity Snapshot", body = ActivitySnapshotEnvelope,
            headers(
                ("ETag" = String, description = "基于 Activity revision 的 weak ETag"),
                ("Cache-Control" = String, description = "private, no-store")
            )),
        (status = 304, description = "Activity revision 未变化",
            headers(
                ("ETag" = String, description = "当前 weak ETag"),
                ("Cache-Control" = String, description = "private, no-store")
            )),
        (status = 401, description = "未登录", body = super::error::ErrorEnvelope),
        (status = 404, description = "活动不存在或不可访问", body = super::error::ErrorEnvelope),
        (status = 500, description = "Snapshot 数据不完整", body = super::error::ErrorEnvelope)
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Extension(request_id): Extension<RequestId>,
    Path(activity_id): Path<String>,
    jar: CookieJar,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let actor = authenticate(&state, &jar, request_id.clone()).await?;
    let activity_id =
        Uuid::parse_str(&activity_id).map_err(|_| ApiError::not_found(request_id.clone()))?;
    // typed_get 对非法 If-None-Match 返回 None；非法条件头因此退化为无条件 200。
    let condition = HeaderCondition(headers.typed_get::<IfNoneMatch>());
    let repository = PostgresSnapshotRepository::new(state.pool);
    let result = load_snapshot(&repository, activity_id, actor.user_id, &condition)
        .await
        .map_err(|error| map_error(error, request_id))?;
    match result {
        SnapshotResult::NotModified { revision } => {
            Ok((StatusCode::NOT_MODIFIED, snapshot_headers(revision)).into_response())
        }
        SnapshotResult::Modified(snapshot) => {
            let revision = snapshot.revision;
            Ok((
                snapshot_headers(revision),
                Json(ActivitySnapshotEnvelope {
                    data: snapshot_data(*snapshot),
                }),
            )
                .into_response())
        }
    }
}

fn snapshot_headers(revision: i64) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.typed_insert(
        ETag::from_str(&weak_etag(revision)).expect("正整数 revision 始终是合法 ETag"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static(PRIVATE_NO_STORE));
    headers
}

fn weak_etag(revision: i64) -> String {
    format!("W/\"{revision}\"")
}

fn snapshot_data(snapshot: ActivitySnapshot) -> ActivitySnapshotData {
    let revision = snapshot.revision.to_string();
    let base_currency = snapshot.ledger.base_currency.clone();
    ActivitySnapshotData {
        revision: revision.clone(),
        activity: activity_data(snapshot.activity),
        members: snapshot.members.into_iter().map(member_data).collect(),
        expenses: snapshot.expenses.into_iter().map(aggregate_data).collect(),
        settlements: snapshot
            .settlements
            .into_iter()
            .map(settlement_data)
            .collect(),
        ledger: LedgerData {
            base_currency: base_currency.clone(),
            revision: revision.clone(),
            balances: snapshot
                .ledger
                .balances
                .into_iter()
                .map(|balance| BalanceData {
                    member_id: balance.member_id().to_string(),
                    net_minor: balance.net_minor().to_string(),
                })
                .collect(),
        },
        recommendations: RecommendationData {
            base_currency,
            revision,
            recommendations: snapshot
                .ledger
                .recommendations
                .into_iter()
                .map(|item| RecommendationItemData {
                    payer_member_id: item.payer_member_id().to_string(),
                    receiver_member_id: item.receiver_member_id().to_string(),
                    amount_minor: item.amount_minor().to_string(),
                })
                .collect(),
        },
    }
}

fn map_error(error: SnapshotError, request_id: RequestId) -> ApiError {
    match error {
        SnapshotError::NotFound => ApiError::not_found(request_id),
        SnapshotError::Integrity | SnapshotError::Unavailable => ApiError::internal(request_id),
    }
}
