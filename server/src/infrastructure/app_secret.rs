use rand_core::{OsRng, RngCore};
use std::{
    fmt,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
};
use thiserror::Error;
use uuid::Uuid;

const SECRET_BYTES: usize = 32;

#[derive(Clone, Eq, PartialEq)]
pub struct AppSecret([u8; SECRET_BYTES]);

#[derive(Debug, Error)]
pub enum AppSecretError {
    #[error("无法读取或创建持久化 app-secret：{0}")]
    Io(#[from] io::Error),
    #[error("持久化 app-secret 长度无效，必须为 32 bytes")]
    InvalidLength,
}

impl AppSecret {
    /// 读取既有 secret；不存在时先写完整临时文件，再以不可覆盖的 hard link 原子发布。
    ///
    /// # Errors
    ///
    /// 路径不可读写、文件系统不支持同目录发布，或既有文件长度错误时返回错误。
    pub fn load_or_create(path: &Path) -> Result<Self, AppSecretError> {
        match read_secret(path) {
            Ok(secret) => return Ok(secret),
            Err(AppSecretError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }

        let parent = path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "app-secret 路径缺少父目录")
        })?;
        fs::create_dir_all(parent)?;
        let temporary_path = parent.join(format!(".app-secret-{}.tmp", Uuid::new_v4()));
        let mut bytes = [0_u8; SECRET_BYTES];
        OsRng.fill_bytes(&mut bytes);

        let write_result = write_private_file(&temporary_path, &bytes).and_then(|()| {
            match fs::hard_link(&temporary_path, path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Ok(()),
                Err(error) => Err(error),
            }
        });
        let _ = fs::remove_file(&temporary_path);
        write_result?;
        read_secret(path)
    }

    #[must_use]
    pub const fn from_bytes(bytes: [u8; SECRET_BYTES]) -> Self {
        Self(bytes)
    }

    pub(crate) const fn as_bytes(&self) -> &[u8; SECRET_BYTES] {
        &self.0
    }
}

impl fmt::Debug for AppSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AppSecret([REDACTED])")
    }
}

fn read_secret(path: &Path) -> Result<AppSecret, AppSecretError> {
    let bytes = fs::read(path)?;
    let bytes: [u8; SECRET_BYTES] = bytes
        .try_into()
        .map_err(|_| AppSecretError::InvalidLength)?;
    Ok(AppSecret(bytes))
}

#[cfg(unix)]
fn write_private_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(not(unix))]
fn write_private_file(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}
