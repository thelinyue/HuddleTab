use async_trait::async_trait;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    application::ports::Clock,
    domain::expense::{ExpenseSplitInput, PaymentInput, PreparedExpense, prepare_expense},
};

#[derive(Clone, Debug)]
pub struct ActivityExpenseContext {
    pub base_currency: String,
    pub actor_member_id: Uuid,
    pub actor_is_owner: bool,
}

#[derive(Clone, Debug)]
pub struct ExpenseRecord {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub created_by_user_id: Uuid,
    pub client_mutation_id: Uuid,
    pub title: String,
    pub category: String,
    pub note: Option<String>,
    pub occurred_at: OffsetDateTime,
    pub original_currency: String,
    pub original_amount_minor: i64,
    pub base_currency: String,
    pub base_amount_minor: i64,
    pub exchange_rate_kind: String,
    pub exchange_rate: String,
    pub split_mode: String,
    pub version: i64,
    pub revision: i64,
    pub deleted: bool,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct ExpensePayment {
    pub id: Uuid,
    pub member_id: Uuid,
    pub original_amount_minor: i64,
    pub base_amount_minor: i64,
}

#[derive(Clone, Debug)]
pub struct ExpenseShare {
    pub id: Uuid,
    pub member_id: Uuid,
    pub original_amount_minor: i64,
    pub base_amount_minor: i64,
}

/// Attachment 只暴露展示所需元数据；私有存储键不得离开 infrastructure 边界。
#[derive(Clone, Debug)]
pub struct ExpenseAttachmentRecord {
    pub id: Uuid,
    pub mime_type: String,
    pub width: i32,
    pub height: i32,
    pub byte_size: i64,
    pub created_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct ExpenseAggregate {
    pub expense: ExpenseRecord,
    pub payments: Vec<ExpensePayment>,
    pub shares: Vec<ExpenseShare>,
    pub attachments: Vec<ExpenseAttachmentRecord>,
}

#[derive(Clone, Debug)]
pub struct NewExpense {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub actor_member_id: Uuid,
    pub client_mutation_id: Uuid,
    pub title: String,
    pub category: String,
    pub note: Option<String>,
    pub occurred_at: OffsetDateTime,
    pub prepared: PreparedExpense,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct ExpenseUpdate {
    pub activity_id: Uuid,
    pub expense_id: Uuid,
    pub actor_user_id: Uuid,
    pub actor_member_id: Uuid,
    pub actor_is_owner: bool,
    pub expected_version: i64,
    pub title: String,
    pub category: String,
    pub note: Option<String>,
    pub occurred_at: OffsetDateTime,
    pub prepared: PreparedExpense,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct ExpenseDelete {
    pub activity_id: Uuid,
    pub expense_id: Uuid,
    pub actor_user_id: Uuid,
    pub actor_member_id: Uuid,
    pub actor_is_owner: bool,
    pub expected_version: i64,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct CreatedExpense {
    pub aggregate: ExpenseAggregate,
    pub idempotent_replay: bool,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ExpenseRepositoryError {
    #[error("没有账单操作权限")]
    Forbidden,
    #[error("账单不存在")]
    NotFound,
    #[error("账单版本冲突")]
    VersionConflict,
    #[error("幂等键与其他账单冲突")]
    MutationConflict,
    #[error("账单成员无效")]
    InvalidMember,
    #[error("账单数据访问失败")]
    Unavailable,
}

/// Expense Repository 以完整聚合为读写单位，禁止让 `SQLx` row 穿过应用层边界。
#[async_trait]
pub trait ExpenseRepository: Send + Sync {
    async fn activity_context(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<ActivityExpenseContext, ExpenseRepositoryError>;

    async fn create(&self, expense: NewExpense) -> Result<CreatedExpense, ExpenseRepositoryError>;

    async fn list(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Vec<ExpenseAggregate>, ExpenseRepositoryError>;

    async fn get(
        &self,
        activity_id: Uuid,
        expense_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<ExpenseAggregate, ExpenseRepositoryError>;

    async fn update(
        &self,
        expense: ExpenseUpdate,
    ) -> Result<ExpenseAggregate, ExpenseRepositoryError>;

    async fn delete(&self, expense: ExpenseDelete) -> Result<(i64, i64), ExpenseRepositoryError>;
}

#[derive(Clone, Debug)]
pub struct ExpenseDraftInput {
    pub client_mutation_id: Uuid,
    pub title: String,
    pub category: String,
    pub note: Option<String>,
    pub occurred_at: OffsetDateTime,
    pub original_currency: String,
    pub original_amount_minor: String,
    pub exchange_rate_kind: String,
    pub exchange_rate: String,
    pub payments: Vec<PaymentInput>,
    pub split: ExpenseSplitInput,
}

#[derive(Clone, Debug)]
pub struct CreateExpenseInput {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub draft: ExpenseDraftInput,
}

#[derive(Clone, Debug)]
pub struct UpdateExpenseInput {
    pub activity_id: Uuid,
    pub expense_id: Uuid,
    pub actor_user_id: Uuid,
    pub version: String,
    pub draft: ExpenseDraftInput,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ExpenseError {
    #[error("账单输入无效")]
    InvalidInput,
    #[error("没有账单操作权限")]
    Forbidden,
    #[error("账单不存在")]
    NotFound,
    #[error("账单版本冲突")]
    VersionConflict,
    #[error("幂等键冲突")]
    MutationConflict,
    #[error("账单成员无效")]
    InvalidMember,
    #[error("账单服务暂时不可用")]
    Unavailable,
}

/// 验证并创建 Expense 聚合；Repository 负责幂等重放与单事务副作用。
///
/// # Errors
///
/// 输入、权限、成员、幂等状态或存储异常时返回稳定业务错误。
pub async fn create_expense(
    repository: &dyn ExpenseRepository,
    clock: &dyn Clock,
    input: CreateExpenseInput,
) -> Result<CreatedExpense, ExpenseError> {
    validate_metadata(&input.draft)?;
    let context = repository
        .activity_context(input.activity_id, input.actor_user_id)
        .await
        .map_err(map_repository_error)?;
    let prepared = prepare(&context.base_currency, &input.draft)?;
    repository
        .create(NewExpense {
            id: Uuid::new_v4(),
            activity_id: input.activity_id,
            actor_user_id: input.actor_user_id,
            actor_member_id: context.actor_member_id,
            client_mutation_id: input.draft.client_mutation_id,
            title: input.draft.title.trim().to_owned(),
            category: input.draft.category.trim().to_owned(),
            note: normalize_note(input.draft.note),
            occurred_at: input.draft.occurred_at,
            prepared,
            now: clock.now(),
        })
        .await
        .map_err(map_repository_error)
}

/// 验证乐观锁版本并原子替换 Expense、Payment 与 Share 事实。
///
/// # Errors
///
/// 输入、权限、成员、版本或存储异常时返回稳定业务错误。
pub async fn update_expense(
    repository: &dyn ExpenseRepository,
    clock: &dyn Clock,
    input: UpdateExpenseInput,
) -> Result<ExpenseAggregate, ExpenseError> {
    validate_metadata(&input.draft)?;
    let expected_version = parse_version(&input.version)?;
    let context = repository
        .activity_context(input.activity_id, input.actor_user_id)
        .await
        .map_err(map_repository_error)?;
    let prepared = prepare(&context.base_currency, &input.draft)?;
    repository
        .update(ExpenseUpdate {
            activity_id: input.activity_id,
            expense_id: input.expense_id,
            actor_user_id: input.actor_user_id,
            actor_member_id: context.actor_member_id,
            actor_is_owner: context.actor_is_owner,
            expected_version,
            title: input.draft.title.trim().to_owned(),
            category: input.draft.category.trim().to_owned(),
            note: normalize_note(input.draft.note),
            occurred_at: input.draft.occurred_at,
            prepared,
            now: clock.now(),
        })
        .await
        .map_err(map_repository_error)
}

/// 软删除 Expense，保留原始双金额事实供 Audit 和历史检查使用。
///
/// # Errors
///
/// 版本格式、权限、资源状态或存储异常时返回稳定业务错误。
pub async fn delete_expense(
    repository: &dyn ExpenseRepository,
    clock: &dyn Clock,
    activity_id: Uuid,
    expense_id: Uuid,
    actor_user_id: Uuid,
    version: &str,
) -> Result<(i64, i64), ExpenseError> {
    let expected_version = parse_version(version)?;
    let context = repository
        .activity_context(activity_id, actor_user_id)
        .await
        .map_err(map_repository_error)?;
    repository
        .delete(ExpenseDelete {
            activity_id,
            expense_id,
            actor_user_id,
            actor_member_id: context.actor_member_id,
            actor_is_owner: context.actor_is_owner,
            expected_version,
            now: clock.now(),
        })
        .await
        .map_err(map_repository_error)
}

/// 列出当前成员可见的非删除 Expense 聚合。
///
/// # Errors
///
/// 操作者无读取权限或存储不可用时返回对应错误。
pub async fn list_expenses(
    repository: &dyn ExpenseRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Vec<ExpenseAggregate>, ExpenseError> {
    repository
        .list(activity_id, actor_user_id)
        .await
        .map_err(map_repository_error)
}

/// 读取一笔非删除 Expense 的完整双金额事实。
///
/// # Errors
///
/// 操作者无读取权限、资源不存在或存储不可用时返回对应错误。
pub async fn get_expense(
    repository: &dyn ExpenseRepository,
    activity_id: Uuid,
    expense_id: Uuid,
    actor_user_id: Uuid,
) -> Result<ExpenseAggregate, ExpenseError> {
    repository
        .get(activity_id, expense_id, actor_user_id)
        .await
        .map_err(map_repository_error)
}

fn prepare(
    base_currency: &str,
    draft: &ExpenseDraftInput,
) -> Result<PreparedExpense, ExpenseError> {
    prepare_expense(
        base_currency,
        &draft.original_currency,
        &draft.original_amount_minor,
        &draft.exchange_rate_kind,
        &draft.exchange_rate,
        draft.payments.clone(),
        draft.split.clone(),
    )
    .map_err(|_| ExpenseError::InvalidInput)
}

fn validate_metadata(draft: &ExpenseDraftInput) -> Result<(), ExpenseError> {
    if !(1..=120).contains(&draft.title.trim().chars().count())
        || draft.category.trim().is_empty()
        || draft.category.trim().chars().count() > 64
        || draft
            .note
            .as_deref()
            .is_some_and(|note| note.trim().chars().count() > 2000)
    {
        return Err(ExpenseError::InvalidInput);
    }
    Ok(())
}

fn normalize_note(note: Option<String>) -> Option<String> {
    note.map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn parse_version(value: &str) -> Result<i64, ExpenseError> {
    let version = value
        .parse::<i64>()
        .map_err(|_| ExpenseError::InvalidInput)?;
    if version <= 0 || version.to_string() != value {
        return Err(ExpenseError::InvalidInput);
    }
    Ok(version)
}

fn map_repository_error(error: ExpenseRepositoryError) -> ExpenseError {
    match error {
        ExpenseRepositoryError::Forbidden => ExpenseError::Forbidden,
        ExpenseRepositoryError::NotFound => ExpenseError::NotFound,
        ExpenseRepositoryError::VersionConflict => ExpenseError::VersionConflict,
        ExpenseRepositoryError::MutationConflict => ExpenseError::MutationConflict,
        ExpenseRepositoryError::InvalidMember => ExpenseError::InvalidMember,
        ExpenseRepositoryError::Unavailable => ExpenseError::Unavailable,
    }
}
