use super::settlement::SettlementScope;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// null 日期代表全部日期；空数组不是全选，防止清空选择后误结算整个活动。
#[derive(Clone, Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettlementPreviewRequest {
    pub dates: Option<Vec<String>>,
    pub time_zone: String,
    pub strategy: Option<String>,
    pub hub_member_id: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettlementDateOption {
    pub date: String,
    pub expense_count: i64,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScopeBalance {
    pub member_id: String,
    pub net_minor: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScopeRecommendation {
    pub payer_member_id: String,
    pub receiver_member_id: String,
    pub amount_minor: String,
}

/// 同一个只读快照包含日期选项、余额、建议和待确认抵销，避免界面混用不同范围的数据。
#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettlementPreview {
    pub scope: SettlementScope,
    pub base_currency: String,
    pub revision: String,
    pub expense_ids: Vec<String>,
    pub date_options: Vec<SettlementDateOption>,
    pub balances: Vec<ScopeBalance>,
    pub recommendations: Vec<ScopeRecommendation>,
    pub effective_strategy: String,
    pub hub_member_id: Option<String>,
    pub offset_minor: String,
    pub offset_expense_count: usize,
    pub requires_offset_confirmation: bool,
    pub settled: bool,
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConfirmBillOffsetsRequest {
    pub client_mutation_id: String,
    pub scope: SettlementScope,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmBillOffsetsData {
    pub confirmation_id: String,
    pub revision: String,
    pub idempotent_replay: bool,
}
