import "server-only";
import { createDatabaseClient } from "./factory";

/** Next.js 请求路径使用的单例连接；CLI 与测试必须改用 factory，避免绕过服务端边界。 */
const globalForDb = globalThis as unknown as {
  database?: ReturnType<typeof createDatabaseClient>;
};
const database =
  globalForDb.database ?? createDatabaseClient(process.env.DATABASE_URL ?? "");

if (process.env.NODE_ENV !== "production") {
  globalForDb.database = database;
}

export const sql = database.sql;
export const db = database.db;
