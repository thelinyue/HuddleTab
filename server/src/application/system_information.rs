use async_trait::async_trait;
use thiserror::Error;

/// 平台管理员看到的持久化空间统计；金额以外的容量也保持字符串化，避免 HTTP 层精度损失。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageUsage {
    pub database_bytes: u128,
    pub uploads_bytes: u128,
    pub total_bytes: u128,
}

/// 与具体文件系统和 `PostgreSQL` 实现隔离的只读探针，保证系统信息不会读取 Activity 数据。
#[async_trait]
pub trait SystemInformationProbe: Send + Sync {
    async fn database_bytes(&self) -> Result<u128, SystemInformationError>;
    async fn uploads_bytes(&self) -> Result<u128, SystemInformationError>;
    async fn database_version(&self) -> Result<String, SystemInformationError>;
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum SystemInformationError {
    #[error("系统信息探针不可用")]
    Unavailable,
}

/// 读取管理员系统信息中的存储部分；所有加法都在应用边界检查溢出。
///
/// # Errors
///
/// 任一底层探针不可用或字节数相加溢出时返回 [`SystemInformationError::Unavailable`]。
pub async fn read_storage(
    probe: &dyn SystemInformationProbe,
) -> Result<StorageUsage, SystemInformationError> {
    let database_bytes = probe.database_bytes().await?;
    let uploads_bytes = probe.uploads_bytes().await?;
    let total_bytes = database_bytes
        .checked_add(uploads_bytes)
        .ok_or(SystemInformationError::Unavailable)?;
    Ok(StorageUsage {
        database_bytes,
        uploads_bytes,
        total_bytes,
    })
}

/// 读取数据库版本；版本和部署目录由 HTTP 层在管理员授权后组合进响应。
///
/// # Errors
///
/// 底层数据库版本探针不可用时返回 [`SystemInformationError::Unavailable`]。
pub async fn read_database_version(
    probe: &dyn SystemInformationProbe,
) -> Result<String, SystemInformationError> {
    probe.database_version().await
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Probe {
        database: u128,
        uploads: u128,
    }

    #[async_trait]
    impl SystemInformationProbe for Probe {
        async fn database_bytes(&self) -> Result<u128, SystemInformationError> {
            Ok(self.database)
        }

        async fn uploads_bytes(&self) -> Result<u128, SystemInformationError> {
            Ok(self.uploads)
        }

        async fn database_version(&self) -> Result<String, SystemInformationError> {
            Ok("PostgreSQL 18.6".to_owned())
        }
    }

    #[tokio::test]
    async fn storage_sums_without_number_precision_loss() {
        let usage = read_storage(&Probe {
            database: 9_007_199_254_740_993,
            uploads: 7,
        })
        .await
        .expect("探针应成功");
        assert_eq!(usage.total_bytes, 9_007_199_254_741_000);
    }
}
