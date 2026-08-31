use anyhow::{Context, Result};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::time::Duration;

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// 建立 `PostgreSQL` 连接并执行嵌入二进制的向前 migration。
///
/// migration 在监听 HTTP 端口前完成；失败时进程直接退出，避免对外提供半初始化服务。
///
/// # Errors
///
/// 数据库无法连接或任一 migration 执行失败时返回带中文部署上下文的错误。
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
        .context("数据库升级失败，未启动 HuddleTab 服务")?;

    Ok(pool)
}
