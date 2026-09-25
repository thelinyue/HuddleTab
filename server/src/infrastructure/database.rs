use anyhow::{Context, Result, ensure};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{borrow::Cow, time::Duration};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");
const BASELINE_VERSION: i64 = 202_609_230_001;
const V030_MIGRATIONS: [i64; 8] = [
    202_609_090_001,
    202_609_190_001,
    202_609_190_002,
    202_609_190_003,
    202_609_200_001,
    202_609_210_001,
    202_609_210_002,
    202_609_210_003,
];

/// 建立 `PostgreSQL` 连接并执行嵌入二进制的数据库初始化。
///
/// 空库执行 v0.0.30 结构的单份建库迁移；已有 v0.0.30 库保留原有八条记录，
/// 只执行后续迁移。先校验旧记录再允许 `SQLx` 忽略已移除的迁移文件，
/// 防止不完整或未知历史被误当作受支持的升级起点。
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

    let has_migration_table: bool =
        sqlx::query_scalar("SELECT to_regclass('_sqlx_migrations') IS NOT NULL")
            .fetch_one(&pool)
            .await
            .context("无法检查数据库迁移记录")?;

    if has_migration_table {
        let applied: Vec<(i64, bool)> =
            sqlx::query_as("SELECT version, success FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .context("无法读取数据库迁移记录")?;
        let old_versions: Vec<i64> = applied
            .iter()
            .filter_map(|(version, _)| (*version < BASELINE_VERSION).then_some(*version))
            .collect();

        if !old_versions.is_empty() {
            ensure!(
                old_versions == V030_MIGRATIONS
                    && applied.iter().all(|(version, success)| {
                        *success
                            && *version != BASELINE_VERSION
                            && (*version < BASELINE_VERSION || MIGRATOR.version_exists(*version))
                    }),
                "数据库迁移记录不属于受支持的 v0.0.30 升级起点，未修改原数据"
            );

            let later_migrator = sqlx::migrate::Migrator {
                migrations: Cow::Owned(
                    MIGRATOR
                        .iter()
                        .filter(|migration| migration.version != BASELINE_VERSION)
                        .cloned()
                        .collect(),
                ),
                ignore_missing: true,
                ..sqlx::migrate::Migrator::DEFAULT
            };
            later_migrator
                .run(&pool)
                .await
                .context("v0.0.30 数据库升级失败，未启动 HuddleTab 服务")?;
            backfill_bill_clearing(&pool).await?;
            return Ok(pool);
        }

        ensure!(
            applied.is_empty()
                || applied
                    .iter()
                    .any(|(version, _)| *version == BASELINE_VERSION),
            "数据库缺少新安装迁移记录，未修改原数据"
        );
    }

    let has_existing_schema: bool = sqlx::query_scalar(
        "SELECT to_regclass('users') IS NOT NULL OR to_regclass('activities') IS NOT NULL",
    )
    .fetch_one(&pool)
    .await
    .context("无法检查现有数据库结构")?;
    let has_baseline: bool = if has_migration_table {
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM _sqlx_migrations WHERE version = $1)")
            .bind(BASELINE_VERSION)
            .fetch_one(&pool)
            .await
            .context("无法检查新安装迁移记录")?
    } else {
        false
    };
    ensure!(
        has_existing_schema == has_baseline,
        "数据库结构与迁移记录不匹配，未修改原数据"
    );

    MIGRATOR.run(&pool).await.context(
        "数据库初始化或迁移记录校验失败，未启动 HuddleTab 服务；仅支持全新安装或从 v0.0.30 升级",
    )?;

    backfill_bill_clearing(&pool).await?;

    Ok(pool)
}

/// 升级时按当前历史事实生成首次对账结果；已有投影不因服务重启而改写。
async fn backfill_bill_clearing(pool: &PgPool) -> Result<()> {
    let activities = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT a.id FROM activities a WHERE EXISTS \
         (SELECT 1 FROM expenses e WHERE e.activity_id = a.id AND e.deleted_at IS NULL) \
         AND NOT EXISTS (SELECT 1 FROM bill_clearing_entries b WHERE b.activity_id = a.id)",
    )
    .fetch_all(pool)
    .await
    .context("无法读取需要自动对账的历史活动")?;
    for activity_id in activities {
        let mut transaction = pool.begin().await.context("无法开始历史账单对账")?;
        sqlx::query("SELECT id FROM activities WHERE id = $1 FOR UPDATE")
            .bind(activity_id)
            .execute(&mut *transaction)
            .await
            .context("无法锁定历史活动")?;
        let already_reconciled = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM bill_clearing_entries WHERE activity_id = $1)",
        )
        .bind(activity_id)
        .fetch_one(&mut *transaction)
        .await
        .context("无法检查历史账单对账状态")?;
        if already_reconciled {
            continue;
        }
        super::bill_clearing::reconcile_activity(
            &mut transaction,
            activity_id,
            false,
            "HISTORICAL_AUTO",
            time::OffsetDateTime::now_utc(),
        )
        .await
        .context("历史账单自动对账失败，未启动服务")?;
        transaction.commit().await.context("无法提交历史账单对账")?;
    }
    Ok(())
}
