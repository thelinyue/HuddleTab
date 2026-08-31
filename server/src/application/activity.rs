use async_trait::async_trait;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    application::ports::Clock,
    domain::{activity::ActivityName, currency::Currency},
};

#[derive(Clone, Debug)]
pub struct CreateActivityInput {
    pub name: String,
    pub base_currency: String,
    pub actor_user_id: Uuid,
    pub actor_display_name: String,
}

#[derive(Clone, Debug)]
pub struct NewActivity {
    pub activity_id: Uuid,
    pub owner_member_id: Uuid,
    pub name: String,
    pub base_currency: String,
    pub actor_user_id: Uuid,
    pub actor_display_name: String,
    pub created_at: OffsetDateTime,
}

#[derive(Clone, Debug)]
pub struct CreatedActivity {
    pub activity_id: Uuid,
    pub owner_member_id: Uuid,
    pub name: String,
    pub base_currency: String,
    pub version: i64,
    pub revision: i64,
}

#[derive(Clone, Debug)]
pub struct ActivityView {
    pub activity_id: Uuid,
    pub owner_member_id: Uuid,
    pub name: String,
    pub base_currency: String,
    pub status: String,
    pub version: i64,
    pub revision: i64,
    pub current_member_id: Uuid,
    pub current_member_role: String,
}

#[derive(Clone, Debug)]
pub struct ActivityMemberView {
    pub member_id: Uuid,
    pub activity_id: Uuid,
    pub user_id: Option<Uuid>,
    pub display_name: String,
    pub role: String,
    pub status: String,
    pub version: i64,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ActivityRepositoryError {
    #[error("活动不存在或当前用户不可访问")]
    NotFound,
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
}

#[derive(Debug, Error)]
pub enum CreateActivityError {
    #[error("活动名称无效")]
    InvalidName,
    #[error("活动主币种无效")]
    InvalidCurrency,
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
    repository
        .create(NewActivity {
            activity_id: Uuid::new_v4(),
            owner_member_id: Uuid::new_v4(),
            name: name.as_str().to_owned(),
            base_currency: currency.code().to_owned(),
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

fn map_read_error(error: ActivityRepositoryError) -> ReadActivityError {
    match error {
        ActivityRepositoryError::NotFound => ReadActivityError::NotFound,
        ActivityRepositoryError::Unavailable => ReadActivityError::Unavailable,
    }
}
