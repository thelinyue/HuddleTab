import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabaseClient } from "./factory";

const migrationsFolder = resolve(process.cwd(), "drizzle");
let sql: ReturnType<typeof createDatabaseClient>["sql"] | undefined;

try {
  if (!existsSync(join(migrationsFolder, "meta", "_journal.json"))) {
    console.info("当前版本尚无数据库迁移，已安全跳过");
  } else {
    const database = createDatabaseClient(process.env.DATABASE_URL ?? "");
    sql = database.sql;
    await migrate(database.db, { migrationsFolder });
    console.info("数据库迁移完成");
  }
} catch {
  console.error("数据库迁移失败，应用不会继续启动");
  process.exitCode = 1;
} finally {
  await sql?.end();
}
