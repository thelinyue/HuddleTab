import "server-only";

import { createDatabaseClient } from "./factory";

/**
 * 此模块是应用运行时唯一读取 DATABASE_URL 和缓存数据库连接的位置。
 * 通过惰性获取器延后配置校验，使健康检查能够将部署配置错误转换为既定的 503 响应，
 * 而不是在路由导入阶段提前中断请求处理。
 */
const globalForDb = globalThis as unknown as {
  database?: ReturnType<typeof createDatabaseClient>;
};

export function getDatabaseClient() {
  const database =
    globalForDb.database ?? createDatabaseClient(process.env.DATABASE_URL);

  if (process.env.NODE_ENV !== "production") {
    globalForDb.database = database;
  }

  return database;
}
