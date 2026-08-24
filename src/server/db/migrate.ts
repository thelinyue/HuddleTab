import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client";

const migrationsFolder = resolve(process.cwd(), "drizzle");
const journalPath = join(migrationsFolder, "meta", "_journal.json");

/**
 * Drizzle 在零 schema 时也会生成空 journal；只有存在实际迁移条目时才连接数据库。
 * 损坏的 journal 会由外层捕获并中止启动，不能被误判为可安全跳过。
 */
function hasPendingMigrations() {
  if (!existsSync(journalPath)) return false;

  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: unknown[];
  };
  return journal.entries.length > 0;
}

/**
 * 迁移入口只执行 Drizzle 已生成的迁移；没有实际迁移时安全退出，避免首次部署被空目录阻塞。
 */
try {
  if (!hasPendingMigrations()) {
    console.info("当前版本尚无数据库迁移，已安全跳过");
  } else {
    await migrate(db, { migrationsFolder });
    console.info("数据库迁移完成");
  }
} catch (error) {
  console.error("数据库迁移失败，应用不会继续启动", error);
  process.exitCode = 1;
} finally {
  await sql.end();
}