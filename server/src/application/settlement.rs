use async_trait::async_trait;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    application::ports::Clock,
    domain::{currency::Currency, money::Money},
};

#[derive(Clone, Debug)]
pub struct ActivitySettlementContext {
    pub base_currency: String,
    pub actor_member_id: Uuid,
    pub actor_is_owner: bool,
}

#[derive(Clone, Debug)]
pub struct SettlementRecord {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub created_by_user_id: Uuid,
    pub client_mutation_id: Uuid,
    pub payer_member_id: Uuid,
    pub receiver_member_id: Uuid,
    pub currency: String,
    pub amount_minor: i64,
    pub status: String,
    pub version: i64,
    pub revision: i64,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub voided_at: Option<OffsetDateTime>,
}

#[derive(Clone, Debug)]
pub struct NewSettlement {
    pub id: Uuid,
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub actor_member_id: Uuid,
    pub client_mutation_id: Uuid,
    pub payer_member_id: Uuid,
    pub receiver_member_id: Uuid,
    pub currency: String,
    pub amount_minor: i64,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct SettlementUpdate {
    pub activity_id: Uuid,
    pub settlement_id: Uuid,
    pub actor_user_id: Uuid,
    pub actor_member_id: Uuid,
    pub actor_is_owner: bool,
    pub expected_version: i64,
    pub payer_member_id: Uuid,
    pub receiver_member_id: Uuid,
    pub amount_minor: i64,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct SettlementVoid {
    pub activity_id: Uuid,
    pub settlement_id: Uuid,
    pub actor_user_id: Uuid,
    pub actor_member_id: Uuid,
    pub actor_is_owner: bool,
    pub expected_version: i64,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct CreatedSettlement {
    pub settlement: SettlementRecord,
    pub idempotent_replay: bool,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum SettlementRepositoryError {
    #[error("没有结算操作权限")]
    Forbidden,
    #[error("结算不存在")]
    NotFound,
    #[error("结算版本冲突")]
    VersionConflict,
    #[error("幂等键与其他结算冲突")]
    MutationConflict,
    #[error("结算成员无效")]
    InvalidMember,
    #[error("结算数据访问失败")]
    Unavailable,
}

#[async_trait]
pub trait SettlementRepository: Send + Sync {
    async fn activity_context(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<ActivitySettlementContext, SettlementRepositoryError>;
    async fn create(
        &self,
        settlement: NewSettlement,
    ) -> Result<CreatedSettlement, SettlementRepositoryError>;
    async fn list(
        &self,
        activity_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<Vec<SettlementRecord>, SettlementRepositoryError>;
    async fn get(
        &self,
        activity_id: Uuid,
        settlement_id: Uuid,
        actor_user_id: Uuid,
    ) -> Result<SettlementRecord, SettlementRepositoryError>;
    async fn update(
        &self,
        settlement: SettlementUpdate,
    ) -> Result<SettlementRecord, SettlementRepositoryError>;
    async fn void(
        &self,
        settlement: SettlementVoid,
    ) -> Result<SettlementRecord, SettlementRepositoryError>;
}

#[derive(Clone, Debug)]
pub struct CreateSettlementInput {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub client_mutation_id: Uuid,
    pub payer_member_id: Uuid,
    pub receiver_member_id: Uuid,
    pub currency: String,
    pub amount_minor: String,
}

#[derive(Clone, Debug)]
pub struct UpdateSettlementInput {
    pub activity_id: Uuid,
    pub settlement_id: Uuid,
    pub actor_user_id: Uuid,
    pub version: String,
    pub payer_member_id: Uuid,
    pub receiver_member_id: Uuid,
    pub amount_minor: String,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum SettlementError {
    #[error("结算输入无效")]
    InvalidInput,
    #[error("没有结算操作权限")]
    Forbidden,
    #[error("结算不存在")]
    NotFound,
    #[error("结算版本冲突")]
    VersionConflict,
    #[error("幂等键冲突")]
    MutationConflict,
    #[error("结算服务暂时不可用")]
    Unavailable,
}

/// 创建活动主币种 Settlement，幂等 replay 由 Repository 在活动锁内判定。
///
/// # Errors
///
/// 金额、币种、成员、权限、幂等状态或存储异常时返回对应错误。
pub async fn create_settlement(
    repository: &dyn SettlementRepository,
    clock: &dyn Clock,
    input: CreateSettlementInput,
) -> Result<CreatedSettlement, SettlementError> {
    let context = repository
        .activity_context(input.activity_id, input.actor_user_id)
        .await
        .map_err(map_repository_error)?;
    if input.currency.trim().to_ascii_uppercase() != context.base_currency
        || input.payer_member_id == input.receiver_member_id
    {
        return Err(SettlementError::InvalidInput);
    }
    let amount_minor = parse_amount(&context.base_currency, &input.amount_minor)?;
    repository
        .create(NewSettlement {
            id: Uuid::new_v4(),
            activity_id: input.activity_id,
            actor_user_id: input.actor_user_id,
            actor_member_id: context.actor_member_id,
            client_mutation_id: input.client_mutation_id,
            payer_member_id: input.payer_member_id,
            receiver_member_id: input.receiver_member_id,
            currency: context.base_currency,
            amount_minor,
            now: clock.now(),
        })
        .await
        .map_err(map_repository_error)
}

/// 使用乐观锁更新 ACTIVE Settlement 的付款人、收款人和金额。
///
/// # Errors
///
/// 输入、权限、成员、版本、状态或存储异常时返回对应错误。
pub async fn update_settlement(
    repository: &dyn SettlementRepository,
    clock: &dyn Clock,
    input: UpdateSettlementInput,
) -> Result<SettlementRecord, SettlementError> {
    let context = repository
        .activity_context(input.activity_id, input.actor_user_id)
        .await
        .map_err(map_repository_error)?;
    if input.payer_member_id == input.receiver_member_id {
        return Err(SettlementError::InvalidInput);
    }
    let amount_minor = parse_amount(&context.base_currency, &input.amount_minor)?;
    repository
        .update(SettlementUpdate {
            activity_id: input.activity_id,
            settlement_id: input.settlement_id,
            actor_user_id: input.actor_user_id,
            actor_member_id: context.actor_member_id,
            actor_is_owner: context.actor_is_owner,
            expected_version: parse_version(&input.version)?,
            payer_member_id: input.payer_member_id,
            receiver_member_id: input.receiver_member_id,
            amount_minor,
            now: clock.now(),
        })
        .await
        .map_err(map_repository_error)
}

/// 将 ACTIVE Settlement 标记为 VOID，禁止物理删除账务事实。
///
/// # Errors
///
/// 权限、版本、状态或存储异常时返回对应错误。
pub async fn void_settlement(
    repository: &dyn SettlementRepository,
    clock: &dyn Clock,
    activity_id: Uuid,
    settlement_id: Uuid,
    actor_user_id: Uuid,
    version: &str,
) -> Result<SettlementRecord, SettlementError> {
    let context = repository
        .activity_context(activity_id, actor_user_id)
        .await
        .map_err(map_repository_error)?;
    repository
        .void(SettlementVoid {
            activity_id,
            settlement_id,
            actor_user_id,
            actor_member_id: context.actor_member_id,
            actor_is_owner: context.actor_is_owner,
            expected_version: parse_version(version)?,
            now: clock.now(),
        })
        .await
        .map_err(map_repository_error)
}

/// 列出活动中的 ACTIVE 与 VOID Settlement 事实。
///
/// # Errors
///
/// 操作者无读取权限或存储不可用时返回对应错误。
pub async fn list_settlements(
    repository: &dyn SettlementRepository,
    activity_id: Uuid,
    actor_user_id: Uuid,
) -> Result<Vec<SettlementRecord>, SettlementError> {
    repository
        .list(activity_id, actor_user_id)
        .await
        .map_err(map_repository_error)
}

/// 读取一笔 Settlement 的当前事实与版本。
///
/// # Errors
///
/// 操作者无读取权限、资源不存在或存储不可用时返回对应错误。
pub async fn get_settlement(
    repository: &dyn SettlementRepository,
    activity_id: Uuid,
    settlement_id: Uuid,
    actor_user_id: Uuid,
) -> Result<SettlementRecord, SettlementError> {
    repository
        .get(activity_id, settlement_id, actor_user_id)
        .await
        .map_err(map_repository_error)
}

fn parse_amount(currency: &str, value: &str) -> Result<i64, SettlementError> {
    let currency = Currency::parse(currency).map_err(|_| SettlementError::InvalidInput)?;
    let amount = Money::from_api(currency, value)
        .map_err(|_| SettlementError::InvalidInput)?
        .amount_minor();
    if amount <= 0 {
        return Err(SettlementError::InvalidInput);
    }
    Ok(amount)
}

fn parse_version(value: &str) -> Result<i64, SettlementError> {
    let version = value
        .parse::<i64>()
        .map_err(|_| SettlementError::InvalidInput)?;
    if version <= 0 || version.to_string() != value {
        return Err(SettlementError::InvalidInput);
    }
    Ok(version)
}

fn map_repository_error(error: SettlementRepositoryError) -> SettlementError {
    match error {
        SettlementRepositoryError::Forbidden => SettlementError::Forbidden,
        SettlementRepositoryError::NotFound => SettlementError::NotFound,
        SettlementRepositoryError::VersionConflict => SettlementError::VersionConflict,
        SettlementRepositoryError::MutationConflict => SettlementError::MutationConflict,
        SettlementRepositoryError::InvalidMember => SettlementError::InvalidInput,
        SettlementRepositoryError::Unavailable => SettlementError::Unavailable,
    }
}
