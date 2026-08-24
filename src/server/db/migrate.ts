import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
import { createDatabaseClient, DatabaseConfigurationError } from "./factory";

const migrationsFolder = resolve(process.cwd(), "drizzle");
const journalPath = join(migrationsFolder, "meta", "_journal.json");

/** 迁移日志格式错误必须中止启动，避免将未知状态误判为没有迁移。 */
class MigrationJournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationJournalError";
  }
}

/**
 * 在连接数据库前验证 Drizzle journal。
 * 零 schema 生成的空 journal 是可安全跳过的唯一 journal 特例；其他格式问题一律失败。
 */
function hasMigrations() {
  if (!existsSync(journalPath)) return false;

  let journal: unknown;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    throw new MigrationJournalError("数据库迁移日志已损坏：无法解析 JSON");
  }

  if (
    typeof journal !== "object" ||
    journal === null ||
    Array.isArray(journal) ||
    !Array.isArray((journal as { entries?: unknown }).entries)
  ) {
    throw new MigrationJournalError("数据库迁移日志已损坏：entries 必须是数组");
  }

  const entries = (journal as { entries: unknown[] }).entries;
  return entries.length > 0;
}

/**
 * 迁移入口先验证本地 journal，再在确有迁移时创建数据库客户端。
 * 这样空项目不需要 DATABASE_URL，也不会因为 postgres.js 默认值意外连接本机数据库。
 */
let sql: Sql | undefined;

try {
  if (!hasMigrations()) {
    console.info("当前版本尚无数据库迁移，已安全跳过");
  } else {
    const database = createDatabaseClient(process.env.DATABASE_URL);
    sql = database.sql;
    await migrate(database.db, { migrationsFolder });
    console.info("数据库迁移完成");
  }
} catch (error) {
  if (
    error instanceof MigrationJournalError ||
    error instanceof DatabaseConfigurationError
  ) {
    console.error(`数据库迁移失败：${error.message}`);
  } else {
    console.error(
      "数据库迁移失败：执行迁移时发生未知错误，请检查数据库连接和迁移文件",
    );
  }
  process.exitCode = 1;
} finally {
  if (sql) {
    try {
      await sql.end();
    } catch {
      console.error("数据库迁移失败：关闭数据库连接时发生错误");
      process.exitCode = 1;
    }
  }
}
