import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * 测试、迁移命令和 Next.js 服务端共用的数据库工厂。
 * 它不依赖 Next.js 专用运行时，因此 CLI 可以安全调用；业务事务和权限不应放入此处。
 */
export function createDatabaseClient(connectionString: string, max = 10) {
  // 完整恢复会由 pg_restore 重建表结构。禁用长驻 prepared statement 可避免同一
  // 应用进程继续使用恢复前的行类型计划，进而在恢复后的首个业务查询中失败。
  const sql = postgres(connectionString, { max, prepare: false });

  return { sql, db: drizzle(sql) };
}
