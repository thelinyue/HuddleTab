use async_trait::async_trait;
use thiserror::Error;
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

use crate::{
    application::ports::Clock,
    domain::{
        activity::{
            ActivityAction, ActivityName, ActivityPeriod, InviteMode, normalize_activity_location,
            parse_activity_date,
        },
        currency::Currency,
    },
};

#[derive(Clone, Debug)]
pub struct CreateActivityInput {
    pub name: String,
    pub location: Option<String>,
    pub base_currency: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub actor_user_id: Uuid,
    pub actor_display_name: String,
}

#[derive(Clone, Debug)]
pub struct NewActivity {
    pub activity_id: Uuid,
    pub owner_member_id: Uuid,
    pub name: String,
    pub location: Option<String>,
    pub base_currency: String,
    pub start_date: Date,
    pub end_date: Option<Date>,
    pub actor_user_id: Uuid,
    pub actor_display_name: String,
    pub created_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct CreatedActivity {
    pub activity_id: Uuid,
    pub owner_member_id: Uuid,
    pub name: String,
    pub location: Option<String>,
    pub base_currency: String,
    pub start_date: Date,
    pub end_date: Option<Date>,
    pub invite_mode: String,
    pub version: i64,
    pub revision: i64,
}

#[derive(Clone, Debug)]
pub struct ActivityView {
    pub activity_id: Uuid,
    pub owner_member_id: Uuid,
    pub name: String,
    pub location: Option<String>,
    pub base_currency: String,
    pub start_date: Date,
    pub end_date: Option<Date>,
    pub invite_mode: String,
    pub status: String,
    pub version: i64,
    pub revision: i64,
    pub current_member_id: Uuid,
    pub current_member_role: String,
    pub deleted_at: Option<OffsetDateTime>,
    pub purge_after: Option<OffsetDateTime>,
    pub has_accounting_records: bool,
    pub earliest_expense_date: Option<Date>,
}

#[derive(Clone, Debug)]
pub struct ActivityMemberView {
    pub member_id: Uuid,
    pub activity_id: Uuid,
    pub user_id: Option<Uuid>,
    pub display_name: String,
    pub avatar_preset: Option<i16>,
    pub role: String,
    pub status: String,
    pub version: i64,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ActivityRepositoryError {
    #[error("活动不存在或当前用户不可访问")]
    NotFound,
    #[error("当前用户不能管理该活动")]
    Forbidden,
    #[error("活动版本冲突")]
    VersionConflict,
    #[error("当前活动状态不允许修改所选字段")]
    FieldLocked,
    #[error("活动已有账务记录，主币种不可修改")]
    BaseCurrencyLocked,
    #[error("当前活动状态不能执行此转换")]
    InvalidTransition,
    #[error("活动已超过恢复期限")]
    RestoreExpired,
    #[error("活动数据访问失败")]
    Unavailable,
}

#[async_trait]
pub trait ActivityRepository: Send + Sync {
    async fn create(
        &self,
        activity: NewActivity,
    ) -> Result<CreatedActivity, ActivityRepositoryError>;

    async fn list_for_user(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ActivityView>, ActivityRepositoryError>;

    async fn list_deleted_for_owner(
        &self,
        user_id: Uuid,
        now: OffsetDateTime,
    ) -> Result<Vec<ActivityView>, ActivityRepositoryError>;

    async fn get_for_user(
        &self,
        activity_id: Uuid,
        user_id: Uuid,
    ) -> Result<ActivityView, ActivityRepositoryError>;

    async fn list_members(
        &self,
        activity_id: Uuid,
        user_id: Uuid,
    ) -> Result<Vec<ActivityMemberView>, ActivityRepositoryError>;

    async fn update(
        &self,
        activity: ActivityUpdate,
    ) -> Result<ActivityMutationResult, ActivityRepositoryError>;

    async fn transition(
        &self,
        transition: ActivityTransition,
    ) -> Result<ActivityView, ActivityRepositoryError>;

    async fn delete(
        &self,
        deletion: ActivityDeletion,
    ) -> Result<ActivityView, ActivityRepositoryError>;

    async fn restore(
        &self,
        restoration: ActivityRestoration,
    ) -> Result<ActivityView, ActivityRepositoryError>;

    async fn transfer_ownership(
        &self,
        transfer: ActivityOwnershipTransfer,
    ) -> Result<ActivityView, ActivityRepositoryError>;
}

#[derive(Clone, Debug)]
pub struct ActivityUpdate {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub expected_version: i64,
    pub name: Option<String>,
    pub location: Option<Option<String>>,
    pub base_currency: Option<String>,
    pub start_date: Option<Date>,
    pub end_date: Option<Option<Date>>,
    pub invite_mode: Option<String>,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct ActivityMutationResult {
    pub activity: ActivityView,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct UpdateActivityInput {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub version: String,
    pub name: Option<String>,
    pub location: Option<Option<String>>,
    pub base_currency: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<Option<String>>,
    pub invite_mode: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ActivityTransition {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub expected_version: i64,
    pub action: ActivityAction,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct ActivityDeletion {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub expected_version: i64,
    pub deleted_at: OffsetDateTime,
    pub purge_after: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct ActivityRestoration {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub expected_version: i64,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct ActivityOwnershipTransfer {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub new_owner_member_id: Uuid,
    pub expected_version: i64,
    pub now: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct TransferActivityOwnershipInput {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub new_owner_member_id: String,
    pub version: String,
}

#[derive(Clone, Debug)]
pub struct ActivityLifecycleInput {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub version: String,
    pub action: String,
}

#[derive(Clone, Debug)]
pub struct ActivityVersionInput {
    pub activity_id: Uuid,
    pub actor_user_id: Uuid,
    pub version: String,
}

#[derive(Debug, Error)]
pub enum CreateActivityError {
    #[error("活动名称无效")]
    InvalidName,
    #[error("活动主币种无效")]
    InvalidCurrency,
    #[error("活动地点或日期无效")]
    InvalidDetails,
    #[error("创建活动失败")]
    Unavailable,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ReadActivityError {
    #[error("活动不存在或当前用户不可访问")]
    NotFound,
    #[error("读取活动失败")]
    Unavailable,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum UpdateActivityError {
    #[error("活动输入无效")]
    InvalidInput,
    #[error("活动不存在")]
    NotFound,
    #[error("没有活动管理权限")]
    Forbidden,
    #[error("活动版本冲突")]
    VersionConflict,
    #[error("当前活动状态不允许修改所选字段")]
    FieldLocked,
    #[error("活动已有账务记录，主币种不可修改")]
    BaseCurrencyLocked,
    #[error("当前活动状态不能执行此转换")]
    InvalidTransition,
    #[error("活动已超过恢复期限")]
    RestoreExpired,
    #[error("更新活动失败")]
    Unavailable,
}

/// 创建活动时同步创建唯一 OWNER member，账务 owner 永远引用 member 身份。
///
/// # Errors
///
/// 名称/币种无效或 Repository 事务失败时返回稳定错误。
pub async fn create_activity(
    repository: &dyn ActivityRepository,
    clock: &dyn Clock,
    input: CreateActivityInput,
) -> Result<CreatedActivity, CreateActivityError> {
    let name = ActivityName::parse(&input.name).map_err(|_| CreateActivityError::InvalidName)?;
    let currency =
        Currency::parse(&input.base_currency).map_err(|_| CreateActivityError::InvalidCurrency)?;
    let location = normalize_activity_location(input.location.as_deref().unwrap_or_default())
        .map_err(|_| CreateActivityError::InvalidDetails)?;
    let period = ActivityPeriod::parse(&input.start_date, input.end_date.as_deref())
        .map_err(|_| CreateActivityError::InvalidDetails)?;
    repository
        .create(NewActivity {
            activity_id: Uuid::new_v4(),
            owner_member_id: Uuid::new_v4(),
            name: name.as_str().to_owned(),
            location,
            base_currency: currency.code().to_owned(),
            start_date: period.start_date(),
            end_date: period.end_date(),
            actor_user_id: input.actor_user_id,
            actor_display_name: input.actor_display_name,
            created_at: clock.now(),
        })
        .await
        .map_err(|_| CreateActivityError::Unavailable)
}

/// 读取用例统一从 Repository 的成员关系查询，HTTP 层不直接拼接权限 SQL。
///
/// # Errors
///
/// 数据访问失败时返回 [`ReadActivityError`]，不会泄露底层数据库错误。
pub async fn list_activities(
    repository: &dyn ActivityRepository,
    user_id: Uuid,
) -> Result<Vec<ActivityView>, ReadActivityError> {
    repository
        .list_for_user(user_id)
        .await
        .map_err(map_read_error)
}

/// 列出 Owner 在恢复窗口内可恢复的活动。
///
/// # Errors
///
/// 数据访问失败时返回 [`ReadActivityError`]。
pub async fn list_deleted_activities(
    repository: &dyn ActivityRepository,
    clock: &dyn Clock,
    user_id: Uuid,
) -> Result<Vec<ActivityView>, ReadActivityError> {
    repository
        .list_deleted_for_owner(user_id, clock.now())
        .await
        .map_err(map_read_error)
}

/// 读取当前用户可访问的单个活动。
///
/// # Errors
///
/// 活动不可见、不存在或数据访问失败时返回 [`ReadActivityError`]。
pub async fn get_activity(
    repository: &dyn ActivityRepository,
    activity_id: Uuid,
    user_id: Uuid,
) -> Result<ActivityView, ReadActivityError> {
    repository
        .get_for_user(activity_id, user_id)
        .await
        .map_err(map_read_error)
}

/// 读取活动内的账务成员，权限由 Repository 的成员关系查询统一约束。
///
/// # Errors
///
/// 活动不可见、不存在或数据访问失败时返回 [`ReadActivityError`]。
pub async fn list_activity_members(
    repository: &dyn ActivityRepository,
    activity_id: Uuid,
    user_id: Uuid,
) -> Result<Vec<ActivityMemberView>, ReadActivityError> {
    repository
        .list_members(activity_id, user_id)
        .await
        .map_err(map_read_error)
}

/// 更新活动资料；Repository 在活动行锁内完成权限、版本、Audit 与 revision 副作用。
///
/// # Errors
///
/// 输入、权限、版本、字段锁定或持久化失败时返回稳定业务错误。
pub async fn update_activity(
    repository: &dyn ActivityRepository,
    clock: &dyn Clock,
    input: UpdateActivityInput,
) -> Result<ActivityMutationResult, UpdateActivityError> {
    if input.name.is_none()
        && input.location.is_none()
        && input.base_currency.is_none()
        && input.start_date.is_none()
        && input.end_date.is_none()
        && input.invite_mode.is_none()
    {
        return Err(UpdateActivityError::InvalidInput);
    }
    let version = parse_version(&input.version)?;
    let name = input
        .name
        .as_deref()
        .map(ActivityName::parse)
        .transpose()
        .map_err(|_| UpdateActivityError::InvalidInput)?
        .map(|value| value.as_str().to_owned());
    let location = input
        .location
        .map(|value| {
            value
                .as_deref()
                .map(normalize_activity_location)
                .transpose()
                .map(Option::flatten)
        })
        .transpose()
        .map_err(|_| UpdateActivityError::InvalidInput)?;
    let base_currency = input
        .base_currency
        .as_deref()
        .map(Currency::parse)
        .transpose()
        .map_err(|_| UpdateActivityError::InvalidInput)?
        .map(|value| value.code().to_owned());
    let start_date = input
        .start_date
        .as_deref()
        .map(parse_activity_date)
        .transpose()
        .map_err(|_| UpdateActivityError::InvalidInput)?;
    let end_date = input
        .end_date
        .map(|value| value.as_deref().map(parse_activity_date).transpose())
        .transpose()
        .map_err(|_| UpdateActivityError::InvalidInput)?;
    let invite_mode = input
        .invite_mode
        .as_deref()
        .map(InviteMode::parse)
        .transpose()
        .map_err(|_| UpdateActivityError::InvalidInput)?
        .map(|value| value.as_str().to_owned());

    repository
        .update(ActivityUpdate {
            activity_id: input.activity_id,
            actor_user_id: input.actor_user_id,
            expected_version: version,
            name,
            location,
            base_currency,
            start_date,
            end_date,
            invite_mode,
            now: clock.now(),
        })
        .await
        .map_err(map_update_error)
}

/// 执行封闭生命周期动作并返回更新后的活动事实。
///
/// # Errors
///
/// 动作、版本、权限、当前状态或存储失败时返回稳定业务错误。
pub async fn transition_activity(
    repository: &dyn ActivityRepository,
    clock: &dyn Clock,
    input: ActivityLifecycleInput,
) -> Result<ActivityView, UpdateActivityError> {
    let action =
        ActivityAction::parse(&input.action).map_err(|_| UpdateActivityError::InvalidInput)?;
    repository
        .transition(ActivityTransition {
            activity_id: input.activity_id,
            actor_user_id: input.actor_user_id,
            expected_version: parse_version(&input.version)?,
            action,
            now: clock.now(),
        })
        .await
        .map_err(map_update_error)
}

/// 将活动放入 30 天恢复窗口，保留原生命周期状态。
///
/// # Errors
///
/// 版本、权限、资源状态或存储失败时返回稳定业务错误。
pub async fn delete_activity(
    repository: &dyn ActivityRepository,
    clock: &dyn Clock,
    input: ActivityVersionInput,
) -> Result<ActivityView, UpdateActivityError> {
    let deleted_at = clock.now();
    repository
        .delete(ActivityDeletion {
            activity_id: input.activity_id,
            actor_user_id: input.actor_user_id,
            expected_version: parse_version(&input.version)?,
            deleted_at,
            purge_after: deleted_at + Duration::days(30),
        })
        .await
        .map_err(map_update_error)
}

/// 在恢复窗口内清除删除标记；原 status 不变，因此恢复到删除前生命周期。
///
/// # Errors
///
/// 版本、Owner 权限、恢复期限或存储失败时返回稳定业务错误。
pub async fn restore_activity(
    repository: &dyn ActivityRepository,
    clock: &dyn Clock,
    input: ActivityVersionInput,
) -> Result<ActivityView, UpdateActivityError> {
    repository
        .restore(ActivityRestoration {
            activity_id: input.activity_id,
            actor_user_id: input.actor_user_id,
            expected_version: parse_version(&input.version)?,
            now: clock.now(),
        })
        .await
        .map_err(map_update_error)
}

/// 将唯一 OWNER 身份原子转交给同活动内的已绑定 ACTIVE 成员。
///
/// # Errors
///
/// 目标成员、权限、版本或活动状态不符合约束时返回稳定业务错误。
pub async fn transfer_activity_ownership(
    repository: &dyn ActivityRepository,
    clock: &dyn Clock,
    input: TransferActivityOwnershipInput,
) -> Result<ActivityView, UpdateActivityError> {
    let new_owner_member_id = Uuid::parse_str(&input.new_owner_member_id)
        .map_err(|_| UpdateActivityError::InvalidInput)?;
    repository
        .transfer_ownership(ActivityOwnershipTransfer {
            activity_id: input.activity_id,
            actor_user_id: input.actor_user_id,
            new_owner_member_id,
            expected_version: parse_version(&input.version)?,
            now: clock.now(),
        })
        .await
        .map_err(map_update_error)
}

fn map_read_error(error: ActivityRepositoryError) -> ReadActivityError {
    match error {
        ActivityRepositoryError::Unavailable => ReadActivityError::Unavailable,
        ActivityRepositoryError::NotFound
        | ActivityRepositoryError::Forbidden
        | ActivityRepositoryError::VersionConflict
        | ActivityRepositoryError::FieldLocked
        | ActivityRepositoryError::BaseCurrencyLocked
        | ActivityRepositoryError::InvalidTransition
        | ActivityRepositoryError::RestoreExpired => ReadActivityError::NotFound,
    }
}

fn parse_version(value: &str) -> Result<i64, UpdateActivityError> {
    let version = value
        .parse::<i64>()
        .map_err(|_| UpdateActivityError::InvalidInput)?;
    if version <= 0 || version.to_string() != value {
        return Err(UpdateActivityError::InvalidInput);
    }
    Ok(version)
}

fn map_update_error(error: ActivityRepositoryError) -> UpdateActivityError {
    match error {
        ActivityRepositoryError::NotFound => UpdateActivityError::NotFound,
        ActivityRepositoryError::Forbidden => UpdateActivityError::Forbidden,
        ActivityRepositoryError::VersionConflict => UpdateActivityError::VersionConflict,
        ActivityRepositoryError::FieldLocked => UpdateActivityError::FieldLocked,
        ActivityRepositoryError::BaseCurrencyLocked => UpdateActivityError::BaseCurrencyLocked,
        ActivityRepositoryError::InvalidTransition => UpdateActivityError::InvalidTransition,
        ActivityRepositoryError::RestoreExpired => UpdateActivityError::RestoreExpired,
        ActivityRepositoryError::Unavailable => UpdateActivityError::Unavailable,
    }
}
