import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * 测试、迁移命令和 Next.js 服务端共用的数据库工厂。
 * 它不依赖 Next.js 专用运行时，因此 CLI 可以安全调用；业务事务和权限不应放入此处。
 */
export function createDatabaseClient(connectionString: string, max = 10) {
  const sql = postgres(connectionString, { max });

  return { sql, db: drizzle(sql) };
}
