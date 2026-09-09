use anyhow::{Context, Result};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::time::Duration;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// 建立 `PostgreSQL` 连接并执行嵌入二进制的数据库初始化。
///
/// 本次安装起点不承接旧版本迁移；保留 `SQLx` 的事务、锁与迁移记录校验，
/// 让本版本重复启动安全跳过初始化，旧库则校验失败退出，不自动清理或转换数据。
/// 初始化在监听 HTTP 端口前完成，避免对外提供半初始化服务。
///
/// # Errors
///
/// 数据库无法连接、迁移记录不匹配或初始化失败时返回带中文部署上下文的错误。
pub async fn connect_and_migrate(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(Duration::from_secs(10))
        .connect(database_url)
        .await
        .context("无法连接 PostgreSQL，请检查 DATABASE_URL 和数据库状态")?;

    MIGRATOR
        .run(&pool)
        .await
        .context("数据库初始化或迁移记录校验失败，未启动 HuddleTab 服务。本版本需要全新安装，不支持从旧版本原地升级；请使用新的数据库和应用数据目录，保留旧数据供旧版本恢复")?;

    Ok(pool)
}
