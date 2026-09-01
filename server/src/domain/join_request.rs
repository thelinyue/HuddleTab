use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JoinRequestStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JoinDecision {
    Approve,
    Reject,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecisionEffect {
    Apply(JoinRequestStatus),
    Replay,
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum JoinRequestTransitionError {
    #[error("加入申请状态无效")]
    InvalidValue,
    #[error("加入申请已经处理")]
    Closed,
}

impl JoinRequestStatus {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Approved => "APPROVED",
            Self::Rejected => "REJECTED",
        }
    }

    /// 已关闭申请只允许相同决定幂等重放，禁止反向覆盖原决定。
    ///
    /// # Errors
    ///
    /// 已有决定与本次决定相反时返回关闭冲突。
    pub fn decide(
        self,
        decision: JoinDecision,
    ) -> Result<DecisionEffect, JoinRequestTransitionError> {
        let target = decision.status();
        match self {
            Self::Pending => Ok(DecisionEffect::Apply(target)),
            current if current == target => Ok(DecisionEffect::Replay),
            Self::Approved | Self::Rejected => Err(JoinRequestTransitionError::Closed),
        }
    }

    /// 从数据库稳定字面量恢复状态。
    ///
    /// # Errors
    ///
    /// 未知值说明持久化数据损坏。
    pub fn parse(value: &str) -> Result<Self, JoinRequestTransitionError> {
        match value {
            "PENDING" => Ok(Self::Pending),
            "APPROVED" => Ok(Self::Approved),
            "REJECTED" => Ok(Self::Rejected),
            _ => Err(JoinRequestTransitionError::InvalidValue),
        }
    }
}

impl JoinDecision {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Approve => "APPROVE",
            Self::Reject => "REJECT",
        }
    }

    #[must_use]
    pub const fn status(self) -> JoinRequestStatus {
        match self {
            Self::Approve => JoinRequestStatus::Approved,
            Self::Reject => JoinRequestStatus::Rejected,
        }
    }

    /// 解析审批命令，不接受评论或任意目标状态。
    ///
    /// # Errors
    ///
    /// 未知命令返回输入错误。
    pub fn parse(value: &str) -> Result<Self, JoinRequestTransitionError> {
        match value {
            "APPROVE" => Ok(Self::Approve),
            "REJECT" => Ok(Self::Reject),
            _ => Err(JoinRequestTransitionError::InvalidValue),
        }
    }
}
