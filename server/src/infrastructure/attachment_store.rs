use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use thiserror::Error;
use time::OffsetDateTime;
use tokio::io::AsyncWriteExt as _;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct LocalAttachmentStore {
    root: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StoredAttachmentFile {
    pub storage_key: String,
    pub modified_at: OffsetDateTime,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AttachmentStoreError {
    #[error("附件存储键无效")]
    InvalidKey,
    #[error("附件文件不存在")]
    NotFound,
    #[error("附件存储不可用")]
    Unavailable,
}

impl LocalAttachmentStore {
    /// 建立并固定规范化后的私有附件根目录。
    ///
    /// # Errors
    ///
    /// 根目录无法创建或规范化时返回存储不可用。
    pub fn new(root: impl AsRef<Path>) -> Result<Self, AttachmentStoreError> {
        fs::create_dir_all(root.as_ref()).map_err(|_| AttachmentStoreError::Unavailable)?;
        let root =
            fs::canonicalize(root.as_ref()).map_err(|_| AttachmentStoreError::Unavailable)?;
        Ok(Self { root })
    }

    /// 在受限根目录内用同目录临时文件原子写入处理后的附件。
    ///
    /// # Errors
    ///
    /// 存储键非法、父目录越界或文件系统操作失败时返回对应错误。
    pub async fn write(&self, storage_key: &str, bytes: &[u8]) -> Result<(), AttachmentStoreError> {
        let target = self.resolve_key(storage_key)?;
        let parent = target.parent().ok_or(AttachmentStoreError::InvalidKey)?;
        self.create_and_validate_parents(parent).await?;
        self.reject_symlink(&target).await?;
        let temporary = parent.join(format!(".{}.tmp", Uuid::new_v4()));
        let write_result = self.write_temporary(&temporary, bytes).await;
        if let Err(error) = write_result {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error);
        }
        if tokio::fs::rename(&temporary, &target).await.is_err() {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(AttachmentStoreError::Unavailable);
        }
        Ok(())
    }

    /// 读取数据库持有的私有存储键。
    ///
    /// # Errors
    ///
    /// 存储键非法、文件不存在或文件系统不可用时返回对应错误。
    pub async fn read(&self, storage_key: &str) -> Result<Vec<u8>, AttachmentStoreError> {
        let target = self.resolve_key(storage_key)?;
        self.validate_existing_parent(&target)?;
        self.reject_symlink(&target).await?;
        tokio::fs::read(target).await.map_err(map_read_error)
    }

    /// 删除一个受限存储键；文件已经不存在时仍视为成功，便于事务补偿。
    ///
    /// # Errors
    ///
    /// 存储键非法、路径越界或文件系统不可用时返回对应错误。
    pub async fn remove(&self, storage_key: &str) -> Result<(), AttachmentStoreError> {
        let target = self.resolve_key(storage_key)?;
        self.validate_existing_parent(&target)?;
        self.reject_symlink(&target).await?;
        match tokio::fs::remove_file(target).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(AttachmentStoreError::Unavailable),
        }
    }

    /// 返回截止时间之前的普通 WebP 文件，不跟随目录或文件符号链接。
    ///
    /// # Errors
    ///
    /// 遍历或读取元数据失败时返回存储不可用。
    pub async fn files_older_than(
        &self,
        cutoff: OffsetDateTime,
    ) -> Result<Vec<StoredAttachmentFile>, AttachmentStoreError> {
        let root = self.root.clone();
        tokio::task::spawn_blocking(move || scan_files(&root, cutoff))
            .await
            .map_err(|_| AttachmentStoreError::Unavailable)?
    }

    fn resolve_key(&self, storage_key: &str) -> Result<PathBuf, AttachmentStoreError> {
        let path = Path::new(storage_key);
        if path.is_absolute() {
            return Err(AttachmentStoreError::InvalidKey);
        }
        let components = path.components().collect::<Vec<_>>();
        if components.len() != 3
            || components
                .iter()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(AttachmentStoreError::InvalidKey);
        }
        let activity = components[0].as_os_str().to_string_lossy();
        let expense = components[1].as_os_str().to_string_lossy();
        let file = Path::new(components[2].as_os_str());
        let attachment = file
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or(AttachmentStoreError::InvalidKey)?;
        if Uuid::parse_str(&activity).is_err()
            || Uuid::parse_str(&expense).is_err()
            || Uuid::parse_str(attachment).is_err()
            || file.extension().and_then(|value| value.to_str()) != Some("webp")
        {
            return Err(AttachmentStoreError::InvalidKey);
        }
        Ok(self.root.join(path))
    }

    async fn create_and_validate_parents(&self, parent: &Path) -> Result<(), AttachmentStoreError> {
        let relative = parent
            .strip_prefix(&self.root)
            .map_err(|_| AttachmentStoreError::InvalidKey)?;
        let mut current = self.root.clone();
        for component in relative.components() {
            current.push(component);
            match tokio::fs::symlink_metadata(&current).await {
                Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                    return Err(AttachmentStoreError::InvalidKey);
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    tokio::fs::create_dir(&current)
                        .await
                        .map_err(|_| AttachmentStoreError::Unavailable)?;
                }
                Err(_) => return Err(AttachmentStoreError::Unavailable),
            }
            let canonical = tokio::fs::canonicalize(&current)
                .await
                .map_err(|_| AttachmentStoreError::Unavailable)?;
            if !canonical.starts_with(&self.root) {
                return Err(AttachmentStoreError::InvalidKey);
            }
        }
        Ok(())
    }

    fn validate_existing_parent(&self, target: &Path) -> Result<(), AttachmentStoreError> {
        let parent = target.parent().ok_or(AttachmentStoreError::InvalidKey)?;
        let canonical = fs::canonicalize(parent).map_err(map_read_error)?;
        if !canonical.starts_with(&self.root) {
            return Err(AttachmentStoreError::InvalidKey);
        }
        Ok(())
    }

    async fn reject_symlink(&self, target: &Path) -> Result<(), AttachmentStoreError> {
        match tokio::fs::symlink_metadata(target).await {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                Err(AttachmentStoreError::InvalidKey)
            }
            Ok(_) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(AttachmentStoreError::Unavailable),
        }
    }

    async fn write_temporary(&self, path: &Path, bytes: &[u8]) -> Result<(), AttachmentStoreError> {
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options
            .open(path)
            .await
            .map_err(|_| AttachmentStoreError::Unavailable)?;
        file.write_all(bytes)
            .await
            .map_err(|_| AttachmentStoreError::Unavailable)?;
        file.flush()
            .await
            .map_err(|_| AttachmentStoreError::Unavailable)?;
        file.sync_all()
            .await
            .map_err(|_| AttachmentStoreError::Unavailable)
    }
}

fn scan_files(
    root: &Path,
    cutoff: OffsetDateTime,
) -> Result<Vec<StoredAttachmentFile>, AttachmentStoreError> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut directories = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).map_err(|_| AttachmentStoreError::Unavailable)? {
            let entry = entry.map_err(|_| AttachmentStoreError::Unavailable)?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|_| AttachmentStoreError::Unavailable)?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                directories.push(entry.path());
                continue;
            }
            if !metadata.is_file()
                || entry.path().extension().and_then(|value| value.to_str()) != Some("webp")
            {
                continue;
            }
            let modified_at = OffsetDateTime::from(
                metadata
                    .modified()
                    .map_err(|_| AttachmentStoreError::Unavailable)?,
            );
            if modified_at >= cutoff {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|_| AttachmentStoreError::InvalidKey)?
                .to_string_lossy()
                .replace('\\', "/");
            files.push(StoredAttachmentFile {
                storage_key: relative,
                modified_at,
            });
        }
    }
    files.sort_by(|left, right| left.storage_key.cmp(&right.storage_key));
    Ok(files)
}

fn map_read_error(error: std::io::Error) -> AttachmentStoreError {
    let kind = error.kind();
    drop(error);
    if kind == std::io::ErrorKind::NotFound {
        AttachmentStoreError::NotFound
    } else {
        AttachmentStoreError::Unavailable
    }
}
