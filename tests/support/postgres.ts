import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { createDatabaseClient } from "@/server/db/factory";

export interface PostgresHarness {
  readonly sql: ReturnType<typeof postgres>;
  readonly db: ReturnType<typeof createDatabaseClient>["db"];
  seedCredentialUser(userId: string, email: string): Promise<void>;
  stop(): Promise<void>;
}

/** 集成测试统一使用临时 PostgreSQL 18，并只通过已提交的 Drizzle migration 建表。 */
export async function startPostgres(): Promise<PostgresHarness> {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const { sql, db } = createDatabaseClient(container.getConnectionUri(), 1);

  await migrate(db, { migrationsFolder: "drizzle" });

  return {
    sql,
    db,
    async seedCredentialUser(userId, email) {
      await sql.begin(async (transaction) => {
        await transaction`insert into "user" (id, name, email, email_verified, created_at, updated_at)
          values (${userId}, ${userId}, ${email}, false, now(), now())`;
        await transaction`insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
          values (${`${userId}-credential`}, ${userId}, 'credential', ${userId}, 'test-password-hash', now(), now())`;
      });
    },
    async stop() {
      await sql.end();
      await container.stop();
    },
  };
}
