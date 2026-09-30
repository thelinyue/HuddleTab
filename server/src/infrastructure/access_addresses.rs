//! 数据库是访问地址的唯一运行时来源；不缓存，保证保存后的下一次请求立即使用新配置。
use crate::application::access_addresses::normalize_origin;
use anyhow::{Context, Result};
use sqlx::PgPool;

#[derive(Clone, Debug)]
pub struct AccessAddresses {
    /// NULL 表示尚未配置；已配置的列表始终非空。
    pub origins: Option<Vec<String>>,
    pub version: i64,
}

/// # Errors
///
/// 数据库读取失败时返回 `SQLx` 错误，由调用方拒绝当前请求。
pub async fn load(pool: &PgPool) -> Result<AccessAddresses, sqlx::Error> {
    let (origins, version) = sqlx::query_as::<_, (Option<Vec<String>>, i64)>(
        "SELECT access_origins, version FROM system_settings WHERE id = 'singleton'",
    )
    .fetch_one(pool)
    .await?;
    Ok(AccessAddresses { origins, version })
}

/// 只在尚未配置时导入旧环境变量；事务锁防止并发启动覆盖管理员已经保存的地址。
///
/// # Errors
///
/// 旧地址非法或数据库操作失败时返回错误，阻止服务启动。
pub async fn import_legacy(pool: &PgPool, legacy: Option<&str>) -> Result<()> {
    let mut transaction = pool.begin().await.context("无法开始访问地址升级")?;
    let configured = sqlx::query_scalar::<_, Option<Vec<String>>>(
        "SELECT access_origins FROM system_settings WHERE id = 'singleton' FOR UPDATE",
    )
    .fetch_one(&mut *transaction)
    .await
    .context("无法读取已有访问地址")?;
    if configured.is_none()
        && let Some(value) = legacy
    {
        let origin = normalize_origin(value)
            .map_err(anyhow::Error::msg)
            .context("旧 APP_BASE_URL 无效，请修正后重启；未放宽访问限制")?;
        sqlx::query("UPDATE system_settings SET access_origins = $1, version = version + 1, updated_at = NOW() WHERE id = 'singleton'")
            .bind(vec![origin]).execute(&mut *transaction).await.context("无法导入旧访问地址")?;
        tracing::info!("已将旧 APP_BASE_URL 导入访问地址，后续请在系统管理中修改");
    }
    transaction.commit().await.context("无法提交访问地址升级")
}
