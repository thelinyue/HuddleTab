use async_trait::async_trait;
use thiserror::Error;
use uuid::Uuid;

use crate::domain::{
    ledger::{LedgerEntry, SettlementFact, calculate_ledger},
    settlement::recommend_settlements,
};

#[derive(Clone, Debug)]
pub struct SnapshotMember {
    pub member_id: Uuid,
    pub display_name: String,
}

/// 分享快照保留原始账务金额，摘要层先校验总消费、付款和分摊三方一致，再交给领域总账计算。
#[derive(Clone, Debug)]
pub struct SnapshotLedgerEntry {
    member_id: Uuid,
    amount_minor: i64,
}

impl SnapshotLedgerEntry {
    #[must_use]
    pub const fn new(member_id: Uuid, amount_minor: i64) -> Self {
        Self {
            member_id,
            amount_minor,
        }
    }
}

#[derive(Clone, Debug)]
pub struct CsvNamedAmount {
    pub display_name: String,
    pub amount_minor: i64,
}

#[derive(Clone, Debug)]
pub struct CsvExpenseRow {
    pub occurred_at: String,
    pub title: String,
    pub category: String,
    pub original_amount_minor: i64,
    pub original_currency: String,
    pub exchange_rate: String,
    pub base_amount_minor: i64,
    pub payers: Vec<CsvNamedAmount>,
    pub participants: Vec<CsvNamedAmount>,
    pub split_mode: String,
    pub creator_name: String,
    pub created_at: String,
    pub note: Option<String>,
}

/// 一个快照同时服务摘要与 CSV，确保同一请求内的金额、成员和行项目来自同一账务视图。
#[derive(Clone, Debug)]
pub struct SharingSnapshot {
    pub activity_name: String,
    pub base_currency: String,
    pub revision: i64,
    pub current_user_member_id: Uuid,
    pub members: Vec<SnapshotMember>,
    pub total_expense_minor: i64,
    pub payments: Vec<SnapshotLedgerEntry>,
    pub shares: Vec<SnapshotLedgerEntry>,
    pub settlements: Vec<SettlementFact>,
    pub expenses: Vec<CsvExpenseRow>,
}

#[derive(Clone, Debug)]
pub struct NamedBalance {
    pub member_id: Uuid,
    pub display_name: String,
    pub net_minor: i64,
}

#[derive(Clone, Debug)]
pub struct SummaryRecommendation {
    pub payer_member_id: Uuid,
    pub receiver_member_id: Uuid,
    pub amount_minor: i64,
}

#[derive(Clone, Debug)]
pub struct ActivitySummary {
    pub activity_name: String,
    pub member_count: usize,
    pub total_expense_minor: i64,
    pub currency: String,
    pub revision: i64,
    pub current_user_balance_minor: i64,
    pub balances: Vec<NamedBalance>,
    pub recommendations: Vec<SummaryRecommendation>,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum SharingRepositoryError {
    #[error("没有活动分享读取权限")]
    Forbidden,
    #[error("活动分享数据读取失败")]
    Unavailable,
}

#[async_trait]
pub trait SharingRepository: Send + Sync {
    async fn load_snapshot(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<SharingSnapshot, SharingRepositoryError>;
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum SharingError {
    #[error("没有活动分享读取权限")]
    Forbidden,
    #[error("活动分享账务事实不完整")]
    Integrity,
    #[error("活动分享服务暂时不可用")]
    Unavailable,
}

/// 从数据库快照计算活动摘要，余额和转账建议始终复用领域层的权威规则。
///
/// # Errors
///
/// 无读取权限、账务事实不守恒或存储不可用时返回对应错误。
pub async fn load_summary(
    repository: &dyn SharingRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<ActivitySummary, SharingError> {
    let snapshot = load_snapshot(repository, activity_id, actor_user_id).await?;
    let payment_total = checked_fact_total(&snapshot.payments)?;
    let share_total = checked_fact_total(&snapshot.shares)?;
    if snapshot.total_expense_minor != payment_total || payment_total != share_total {
        return Err(SharingError::Integrity);
    }
    let balances = calculate_ledger(
        snapshot
            .members
            .iter()
            .map(|member| member.member_id)
            .collect(),
        snapshot
            .payments
            .into_iter()
            .map(|entry| LedgerEntry::new(entry.member_id, entry.amount_minor))
            .collect(),
        snapshot
            .shares
            .into_iter()
            .map(|entry| LedgerEntry::new(entry.member_id, entry.amount_minor))
            .collect(),
        snapshot.settlements,
    )
    .map_err(|_| SharingError::Integrity)?;
    let recommendations = recommend_settlements(&balances).map_err(|_| SharingError::Integrity)?;
    let current_user_balance_minor = balances
        .iter()
        .find(|balance| balance.member_id() == snapshot.current_user_member_id)
        .map(crate::domain::ledger::Balance::net_minor)
        .ok_or(SharingError::Integrity)?;
    let named_balances = balances
        .into_iter()
        .map(|balance| {
            let member_id = balance.member_id();
            let display_name = snapshot
                .members
                .iter()
                .find(|member| member.member_id == member_id)
                .map(|member| member.display_name.clone())
                .ok_or(SharingError::Integrity)?;
            Ok(NamedBalance {
                member_id,
                display_name,
                net_minor: balance.net_minor(),
            })
        })
        .collect::<Result<Vec<_>, SharingError>>()?;

    Ok(ActivitySummary {
        activity_name: snapshot.activity_name,
        member_count: snapshot.members.len(),
        total_expense_minor: snapshot.total_expense_minor,
        currency: snapshot.base_currency,
        revision: snapshot.revision,
        current_user_balance_minor,
        balances: named_balances,
        recommendations: recommendations
            .into_iter()
            .map(|item| SummaryRecommendation {
                payer_member_id: item.payer_member_id(),
                receiver_member_id: item.receiver_member_id(),
                amount_minor: item.amount_minor(),
            })
            .collect(),
    })
}

fn checked_fact_total(entries: &[SnapshotLedgerEntry]) -> Result<i64, SharingError> {
    entries.iter().try_fold(0_i64, |sum, entry| {
        sum.checked_add(entry.amount_minor)
            .ok_or(SharingError::Integrity)
    })
}

/// 读取 CSV 所需的已授权快照。CSV 不重算账务，也不接触邮箱、附件或审计等私有数据。
///
/// # Errors
///
/// 权限不足或存储不可用时返回对应错误。
pub async fn load_export(
    repository: &dyn SharingRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Vec<CsvExpenseRow>, SharingError> {
    Ok(load_snapshot(repository, activity_id, actor_user_id)
        .await?
        .expenses)
}

async fn load_snapshot(
    repository: &dyn SharingRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<SharingSnapshot, SharingError> {
    repository
        .load_snapshot(activity_id, actor_user_id)
        .await
        .map_err(|error| match error {
            SharingRepositoryError::Forbidden => SharingError::Forbidden,
            SharingRepositoryError::Unavailable => SharingError::Unavailable,
        })
}

const CSV_HEADERS: [&str; 13] = [
    "消费时间",
    "用途",
    "分类",
    "原始金额",
    "原始币种",
    "汇率",
    "主币种金额",
    "付款人",
    "参与成员",
    "分摊方式",
    "创建人",
    "创建时间",
    "备注",
];

/// 生成可被 Excel 直接识别的 UTF-8 CSV。所有用户可控单元格都转义引号并中和公式前缀。
#[must_use]
pub fn serialize_expense_csv(rows: &[CsvExpenseRow]) -> String {
    let mut lines = Vec::with_capacity(rows.len() + 1);
    lines.push(
        CSV_HEADERS
            .into_iter()
            .map(quote_csv)
            .collect::<Vec<_>>()
            .join(","),
    );
    lines.extend(rows.iter().map(|row| {
        [
            row.occurred_at.clone(),
            row.title.clone(),
            row.category.clone(),
            row.original_amount_minor.to_string(),
            row.original_currency.clone(),
            row.exchange_rate.clone(),
            row.base_amount_minor.to_string(),
            join_named_amounts(&row.payers),
            join_named_amounts(&row.participants),
            row.split_mode.clone(),
            row.creator_name.clone(),
            row.created_at.clone(),
            row.note.clone().unwrap_or_default(),
        ]
        .into_iter()
        .map(|value| quote_csv(&neutralize_formula(&value)))
        .collect::<Vec<_>>()
        .join(",")
    }));
    format!("\u{feff}{}\r\n", lines.join("\r\n"))
}

fn join_named_amounts(values: &[CsvNamedAmount]) -> String {
    values
        .iter()
        .map(|value| format!("{}:{}", value.display_name, value.amount_minor))
        .collect::<Vec<_>>()
        .join(" | ")
}

fn neutralize_formula(value: &str) -> String {
    if matches!(
        value.trim_start().chars().next(),
        Some('=' | '+' | '-' | '@')
    ) {
        format!("'{value}")
    } else {
        value.to_owned()
    }
}

fn quote_csv(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
