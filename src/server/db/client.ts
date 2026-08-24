import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/** 测试和生产共用同一数据库工厂；它只建立连接，不承载事务或权限。 */
export function createDatabaseClient(connectionString: string, max = 10) {
  const sql = postgres(connectionString, { max });
  return { sql, db: drizzle(sql) };
}

const globalForDb = globalThis as unknown as {
  database?: ReturnType<typeof createDatabaseClient>;
};
const database =
  globalForDb.database ??
  createDatabaseClient(process.env.DATABASE_URL ?? "");

if (process.env.NODE_ENV !== "production") globalForDb.database = database;

export const sql = database.sql;
export const db = database.db;