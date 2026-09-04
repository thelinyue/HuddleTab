use thiserror::Error;
use time::{Date, format_description::FormatItem, macros::format_description};

const DATE_FORMAT: &[FormatItem<'static>] = format_description!("[year]-[month]-[day]");

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InviteMode {
    DirectJoin,
    RequireApproval,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum InviteModeError {
    #[error("活动加入方式无效")]
    Invalid,
}

impl InviteMode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::DirectJoin => "DIRECT_JOIN",
            Self::RequireApproval => "REQUIRE_APPROVAL",
        }
    }

    /// 只接受 HTTP 与数据库共同冻结的 Activity 级加入方式。
    ///
    /// # Errors
    ///
    /// 未知值返回错误，不能降级为直接加入。
    pub fn parse(value: &str) -> Result<Self, InviteModeError> {
        match value {
            "DIRECT_JOIN" => Ok(Self::DirectJoin),
            "REQUIRE_APPROVAL" => Ok(Self::RequireApproval),
            _ => Err(InviteModeError::Invalid),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActivityName(String);

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ActivityNameError {
    #[error("活动名称长度必须为 1 到 120 个字符")]
    InvalidLength,
}

impl ActivityName {
    /// 去除首尾空白后验证活动名；内部空白和原始 Unicode 保持不变。
    ///
    /// # Errors
    ///
    /// 规范化后的字符数不在 1–120 时返回错误。
    pub fn parse(input: &str) -> Result<Self, ActivityNameError> {
        let normalized = input.trim();
        if !(1..=120).contains(&normalized.chars().count()) {
            return Err(ActivityNameError::InvalidLength);
        }
        Ok(Self(normalized.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum ActivityDetailsError {
    #[error("活动地点长度不能超过 120 个字符")]
    InvalidLocation,
    #[error("活动日期必须是有效的 ISO 日期")]
    InvalidDate,
    #[error("活动结束日期不能早于开始日期")]
    InvalidDateRange,
    #[error("活动状态无效")]
    InvalidStatus,
}

/// 地点属于可选描述字段；空白输入统一存为 NULL，避免数据库中同时出现空串和空值。
///
/// # Errors
///
/// 去除首尾空白后的地点超过 120 个字符时返回错误。
pub fn normalize_activity_location(input: &str) -> Result<Option<String>, ActivityDetailsError> {
    let normalized = input.trim();
    if normalized.chars().count() > 120 {
        return Err(ActivityDetailsError::InvalidLocation);
    }
    Ok((!normalized.is_empty()).then(|| normalized.to_owned()))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ActivityPeriod {
    start_date: Date,
    end_date: Option<Date>,
}

impl ActivityPeriod {
    /// 解析 ISO 日历日期并保证结束日期不早于开始日期。
    ///
    /// # Errors
    ///
    /// 日期格式无效或区间倒置时返回错误。
    pub fn parse(start_date: &str, end_date: Option<&str>) -> Result<Self, ActivityDetailsError> {
        let start_date = parse_activity_date(start_date)?;
        let end_date = end_date.map(parse_activity_date).transpose()?;
        Self::new(start_date, end_date)
    }

    /// 从已解析日期构造活动区间。
    ///
    /// # Errors
    ///
    /// 结束日期早于开始日期时返回错误。
    pub fn new(start_date: Date, end_date: Option<Date>) -> Result<Self, ActivityDetailsError> {
        if end_date.is_some_and(|value| value < start_date) {
            return Err(ActivityDetailsError::InvalidDateRange);
        }
        Ok(Self {
            start_date,
            end_date,
        })
    }

    #[must_use]
    pub fn start_date(self) -> Date {
        self.start_date
    }

    #[must_use]
    pub fn end_date(self) -> Option<Date> {
        self.end_date
    }
}

/// 解析活动合同使用的 `YYYY-MM-DD` 日历日期。
///
/// # Errors
///
/// 输入不是有效日历日期时返回错误。
pub fn parse_activity_date(input: &str) -> Result<Date, ActivityDetailsError> {
    Date::parse(input, DATE_FORMAT).map_err(|_| ActivityDetailsError::InvalidDate)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActivityStatus {
    Active,
    Ended,
    Archived,
}

impl ActivityStatus {
    /// 状态迁移使用封闭矩阵，调用方不能直接指定任意目标状态。
    #[must_use]
    pub fn transition(self, action: ActivityAction) -> Option<Self> {
        match (self, action) {
            (Self::Active, ActivityAction::End) | (Self::Archived, ActivityAction::Unarchive) => {
                Some(Self::Ended)
            }
            (Self::Ended, ActivityAction::Reopen) => Some(Self::Active),
            (Self::Ended, ActivityAction::Archive) => Some(Self::Archived),
            _ => None,
        }
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Ended => "ENDED",
            Self::Archived => "ARCHIVED",
        }
    }

    /// 将数据库中的稳定状态值转换为领域枚举。
    ///
    /// # Errors
    ///
    /// 遇到未知状态时返回错误，避免把损坏数据默认为某个生命周期。
    pub fn parse(value: &str) -> Result<Self, ActivityDetailsError> {
        match value {
            "ACTIVE" => Ok(Self::Active),
            "ENDED" => Ok(Self::Ended),
            "ARCHIVED" => Ok(Self::Archived),
            _ => Err(ActivityDetailsError::InvalidStatus),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActivityAction {
    End,
    Reopen,
    Archive,
    Unarchive,
}

impl ActivityAction {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::End => "END",
            Self::Reopen => "REOPEN",
            Self::Archive => "ARCHIVE",
            Self::Unarchive => "UNARCHIVE",
        }
    }

    /// 解析 HTTP 合同中的稳定命令字面量。
    ///
    /// # Errors
    ///
    /// 未知动作返回错误，不允许调用方直接指定目标状态。
    pub fn parse(value: &str) -> Result<Self, ActivityDetailsError> {
        match value {
            "END" => Ok(Self::End),
            "REOPEN" => Ok(Self::Reopen),
            "ARCHIVE" => Ok(Self::Archive),
            "UNARCHIVE" => Ok(Self::Unarchive),
            _ => Err(ActivityDetailsError::InvalidStatus),
        }
    }

    #[must_use]
    pub const fn audit_action(self) -> &'static str {
        match self {
            Self::End => "ACTIVITY_ENDED",
            Self::Reopen => "ACTIVITY_REOPENED",
            Self::Archive => "ACTIVITY_ARCHIVED",
            Self::Unarchive => "ACTIVITY_UNARCHIVED",
        }
    }
}

/// 字段权限按 API 字段逐项输出，显式布尔值可避免前端再次推导权限矩阵。
#[allow(clippy::struct_excessive_bools)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ActivityFieldPermissions {
    pub name: bool,
    pub location: bool,
    pub base_currency: bool,
    pub start_date: bool,
    pub end_date: bool,
    pub invite_mode: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActivityCapabilities {
    pub fields: ActivityFieldPermissions,
    pub lifecycle_actions: Vec<ActivityAction>,
    pub can_delete: bool,
    pub can_restore: bool,
}

impl ActivityCapabilities {
    /// 根据服务端已验证的角色、生命周期和账务事实生成 UI 能力；实际写入仍会重复授权。
    #[must_use]
    pub fn for_actor(
        is_owner: bool,
        status: ActivityStatus,
        has_accounting_records: bool,
        is_deleted: bool,
    ) -> Self {
        if !is_owner || is_deleted {
            return Self {
                fields: ActivityFieldPermissions::default(),
                lifecycle_actions: Vec::new(),
                can_delete: false,
                can_restore: is_owner && is_deleted,
            };
        }

        let fields = match status {
            ActivityStatus::Active => ActivityFieldPermissions {
                name: true,
                location: true,
                base_currency: !has_accounting_records,
                start_date: true,
                end_date: true,
                invite_mode: true,
            },
            ActivityStatus::Ended | ActivityStatus::Archived => ActivityFieldPermissions::default(),
        };
        let lifecycle_actions = match status {
            ActivityStatus::Active => vec![ActivityAction::End],
            ActivityStatus::Ended => vec![ActivityAction::Reopen, ActivityAction::Archive],
            ActivityStatus::Archived => vec![ActivityAction::Unarchive],
        };
        Self {
            fields,
            lifecycle_actions,
            can_delete: true,
            can_restore: false,
        }
    }
}
