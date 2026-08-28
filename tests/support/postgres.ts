import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { createDatabaseClient } from "@/server/db/factory";

export interface PostgresHarness {
  readonly sql: ReturnType<typeof postgres>;
  readonly db: ReturnType<typeof createDatabaseClient>["db"];
  seedCredentialUser(
    userId: string,
    email: string,
    includeProfile?: boolean,
  ): Promise<void>;
  seedCredentialAdmin(userId: string): Promise<void>;
  stop(): Promise<void>;
}

/**
 * 集成测试统一使用临时 PostgreSQL 18，并只通过已提交的 Drizzle migration 建表。
 * 并发 Setup 会占用两条外层事务连接，凭证创建回调还需第三条连接写入测试账号，
 * 因此测试连接池至少保留三条连接，避免夹具与自身事务形成连接池饥饿。
 */
export async function startPostgres(): Promise<PostgresHarness> {
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const { sql, db } = createDatabaseClient(container.getConnectionUri(), 3);

  await migrate(db, { migrationsFolder: "drizzle" });

  return {
    sql,
    db,
    async seedCredentialUser(userId, email, includeProfile = true) {
      await sql.begin(async (transaction) => {
        await transaction`insert into "user" (id, name, email, email_verified, created_at, updated_at)
          values (${userId}, ${userId}, ${email}, false, now(), now()) on conflict (id) do nothing`;
        if (includeProfile) {
          await transaction`insert into user_profiles (user_id, username_normalized, nickname, email_kind, created_at, updated_at)
            values (${userId}, ${userId}, ${userId}, ${email.endsWith("@local.invalid") ? "SYNTHETIC" : "REAL"}, now(), now())
            on conflict (user_id) do nothing`;
        }
        await transaction`insert into account (id, account_id, provider_id, issuer, user_id, password, created_at, updated_at)
          values (${`${userId}-credential`}, ${userId}, 'credential', 'local:credential', ${userId}, 'test-password-hash', now(), now())
          on conflict (id) do nothing`;
      });
    },
    async seedCredentialAdmin(userId) {
      await sql.begin(async (transaction) => {
        await transaction`insert into "user" (id, name, email, email_verified, created_at, updated_at)
          values (${userId}, ${userId}, ${`${userId}@example.com`}, false, now(), now())`;
        await transaction`insert into user_profiles (user_id, username_normalized, nickname, email_kind, created_at, updated_at)
          values (${userId}, ${userId}, ${userId}, 'REAL', now(), now())`;
        await transaction`insert into account (id, account_id, provider_id, issuer, user_id, password, created_at, updated_at)
          values (${`${userId}-credential`}, ${userId}, 'credential', 'local:credential', ${userId}, 'test-password-hash', now(), now())`;
        await transaction`insert into system_roles (user_id, role, granted_at)
          values (${userId}, 'system_admin', now())`;
      });
    },
    async stop() {
      await sql.end();
      await container.stop();
    },
  };
}
