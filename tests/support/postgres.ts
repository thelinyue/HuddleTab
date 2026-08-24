import { resolve } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres, { type Sql } from "postgres";

const migrationsFolder = resolve(process.cwd(), "drizzle");

export type PostgresHarness = {
  readonly connectionUri: string;
  sql: Sql;
  seedCredentialAdmin(userId: string): Promise<void>;
  stop(): Promise<void>;
};

/**
 * 为集成测试启动隔离 PostgreSQL 并应用正式迁移。
 * 通过同一份 drizzle 目录验证真实数据库约束，避免测试 schema 与部署迁移发生漂移。
 */
export async function startPostgres(): Promise<PostgresHarness> {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const connectionUri = container.getConnectionUri();
  const sql = postgres(connectionUri, { max: 1 });

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
    connectionUri,
    sql,
    async seedCredentialAdmin(userId: string) {
      await sql.begin(async (transaction) => {
        await transaction`
          insert into "user" (id, name, email, email_verified, created_at, updated_at)
          values (${userId}, ${userId}, ${`${userId}@example.com`}, false, now(), now())
        `;
        await transaction`
          insert into user_profiles (
            user_id, username_normalized, nickname, email_kind, created_at, updated_at
          )
          values (${userId}, ${userId}, ${userId}, 'REAL', now(), now())
        `;
        await transaction`
          insert into account (
            id, account_id, provider_id, issuer, user_id, password, created_at, updated_at
          )
          values (
            ${`${userId}-credential`}, ${userId}, 'credential', 'credential',
            ${userId}, 'test-password-hash', now(), now()
          )
        `;
        await transaction`
          insert into system_roles (user_id, role, granted_at)
          values (${userId}, 'system_admin', now())
        `;
      });
    },
    async stop() {
      try {
        await sql.end();
      } finally {
        await container.stop();
      }
    },
  };
}
