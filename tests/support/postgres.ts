import { resolve } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";

const migrationsFolder = resolve(process.cwd(), "drizzle");

export type PostgresHarness = {
  sql: Sql;
  stop(): Promise<void>;
};

/**
 * 为集成测试启动隔离 PostgreSQL 并应用正式迁移。
 * 通过同一份 drizzle 目录验证真实数据库约束，避免测试 schema 与部署迁移发生漂移。
 */
export async function startPostgres(): Promise<PostgresHarness> {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const sql = postgres(container.getConnectionUri(), { max: 1 });

  try {
    await migrate(drizzle(sql), { migrationsFolder });
  } catch (error) {
    try {
      await sql.end();
    } finally {
      await container.stop();
    }
    throw error;
  }

  return {
    sql,
    async stop() {
      try {
        await sql.end();
      } finally {
        await container.stop();
      }
    },
  };
}
