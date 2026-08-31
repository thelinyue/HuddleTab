use thiserror::Error;

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
