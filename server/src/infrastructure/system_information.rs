use async_trait::async_trait;
use sqlx::PgPool;
use std::{
    fs,
    path::{Path, PathBuf},
};

use crate::application::system_information::{SystemInformationError, SystemInformationProbe};

#[derive(Clone, Debug)]
pub struct PostgresSystemInformationProbe {
    pool: PgPool,
    uploads_dir: PathBuf,
}

impl PostgresSystemInformationProbe {
    #[must_use]
    pub fn new(pool: PgPool, uploads_dir: PathBuf) -> Self {
        Self { pool, uploads_dir }
    }
}

#[async_trait]
impl SystemInformationProbe for PostgresSystemInformationProbe {
    async fn database_bytes(&self) -> Result<u128, SystemInformationError> {
        let bytes = sqlx::query_scalar::<_, i64>("SELECT pg_database_size(current_database())")
            .fetch_one(&self.pool)
            .await
            .map_err(|_| {
                // 不记录 sqlx 原始错误，避免把连接信息或 SQL 上下文带进部署日志。
                tracing::error!("读取数据库占用失败，请检查 PostgreSQL 状态");
                SystemInformationError::Unavailable
            })?;
        u128::try_from(bytes).map_err(|_| SystemInformationError::Unavailable)
    }

    async fn uploads_bytes(&self) -> Result<u128, SystemInformationError> {
        let directory = self.uploads_dir.clone();
        tokio::task::spawn_blocking(move || directory_size(&directory))
            .await
            .map_err(|_| {
                tracing::error!("读取附件目录占用失败，请检查数据目录权限");
                SystemInformationError::Unavailable
            })?
    }

    async fn database_version(&self) -> Result<String, SystemInformationError> {
        let version = sqlx::query_scalar::<_, String>("SELECT current_setting('server_version')")
            .fetch_one(&self.pool)
            .await
            .map_err(|_| {
                tracing::error!("读取数据库版本失败，请检查 PostgreSQL 状态");
                SystemInformationError::Unavailable
            })?;
        Ok(format!("PostgreSQL {version}"))
    }
}

fn directory_size(root: &Path) -> Result<u128, SystemInformationError> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(_) => {
            tracing::error!("读取附件根目录失败，请检查数据目录权限");
            return Err(SystemInformationError::Unavailable);
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Ok(0);
    }

    let mut directories = vec![root.to_path_buf()];
    let mut total = 0_u128;
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).map_err(|_| {
            tracing::error!("扫描附件目录失败，请检查数据目录权限");
            SystemInformationError::Unavailable
        })? {
            let entry = entry.map_err(|_| {
                tracing::error!("读取附件目录项失败，请检查数据目录权限");
                SystemInformationError::Unavailable
            })?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|_| {
                tracing::error!("读取附件文件属性失败，请检查数据目录权限");
                SystemInformationError::Unavailable
            })?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                directories.push(entry.path());
            } else if metadata.is_file() {
                total = total
                    .checked_add(u128::from(metadata.len()))
                    .ok_or(SystemInformationError::Unavailable)?;
            }
        }
    }
    Ok(total)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    #[test]
    fn missing_and_symlinked_files_are_not_counted() {
        let directory = tempdir().expect("应创建临时目录");
        let uploads = directory.path().join("uploads");
        fs::create_dir_all(uploads.join("nested")).expect("应创建目录");
        fs::write(uploads.join("one.webp"), [0_u8; 7]).expect("应写入文件");
        fs::write(uploads.join("nested/two.webp"), [0_u8; 13]).expect("应写入文件");
        let outside = directory.path().join("outside.bin");
        fs::write(&outside, [0_u8; 97]).expect("应写入文件");
        symlink(&outside, uploads.join("outside-link")).expect("应创建链接");
        assert_eq!(directory_size(&uploads).expect("统计应成功"), 20);
        assert_eq!(
            directory_size(&directory.path().join("missing")).expect("缺失目录应为零"),
            0
        );
    }
}
