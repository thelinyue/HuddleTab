import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export interface PostgresHarness {
  readonly sql: ReturnType<typeof postgres>;
  stop(): Promise<void>;
}

/** 集成测试统一使用临时 PostgreSQL 18，并只通过已提交的 Drizzle migration 建表。 */
export async function startPostgres(): Promise<PostgresHarness> {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const sql = postgres(container.getConnectionUri(), { max: 1 });

  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });

  return {
    sql,
    async stop() {
      await sql.end();
      await container.stop();
    },
  };
}
