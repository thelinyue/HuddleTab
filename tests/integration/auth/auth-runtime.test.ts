import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { createDatabaseClient } from "@/server/db/factory";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

const authEnvironmentKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
] as const;
const originalAuthEnvironment = new Map<string, string | undefined>();
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
const globalForDb = globalThis as typeof globalThis & {
  database?: DatabaseClient;
};

let harness: PostgresHarness;
let databaseBeforeAuthRuntime: DatabaseClient | undefined;
let firstRuntimeDatabase: DatabaseClient | undefined;

function restoreAuthEnvironment() {
  for (const [key, value] of originalAuthEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/** 真实 Better Auth handler 必须使用迁移后的 PostgreSQL，而不能用 mock 掩盖适配器边界。 */
describe("Better Auth 运行时", () => {
  beforeAll(async () => {
    databaseBeforeAuthRuntime = globalForDb.database;
    delete globalForDb.database;
    harness = await startPostgres();

    for (const key of authEnvironmentKeys) {
      originalAuthEnvironment.set(key, process.env[key]);
    }

    process.env.DATABASE_URL = harness.connectionUri;
    process.env.BETTER_AUTH_URL = "http://localhost:5660";
    process.env.BETTER_AUTH_SECRET =
      "test-secret-with-at-least-thirty-two-characters";
    vi.resetModules();
  }, 60_000);

  afterAll(async () => {
    try {
      const database = globalForDb.database;
      if (database && database !== databaseBeforeAuthRuntime) {
        delete globalForDb.database;
        await database.sql.end();
      }
    } finally {
      if (databaseBeforeAuthRuntime === undefined) {
        delete globalForDb.database;
      } else {
        globalForDb.database = databaseBeforeAuthRuntime;
      }

      vi.resetModules();
      restoreAuthEnvironment();

      if (harness) {
        await harness.stop();
      }
    }
  });

  it("将规范化用户名写入真实数据库并创建 credential 账户", async () => {
    const { auth } = await import("@/server/auth/auth");
    const email = "auth-runtime@example.test";
    const response = await auth.handler(
      new Request("http://localhost:5660/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          name: "Auth Runtime",
          password: "valid-password-123",
          username: "  ＡLICE＿０１  ",
        }),
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);

    const [user] = await harness.sql<
      { id: string; username: string; email: string }[]
    >`
      select id, username, email
      from "user"
      where email = ${email}
    `;
    expect(user).toMatchObject({ email, username: "alice_01" });

    const [account] = await harness.sql<
      { providerId: string; password: string | null }[]
    >`
      select provider_id as "providerId", password
      from account
      where user_id = ${user.id}
    `;
    expect(account.providerId).toBe("credential");
    expect(account.password).toEqual(expect.any(String));

    const { getDatabaseClient } = await import("@/server/db");
    firstRuntimeDatabase = getDatabaseClient();
  }, 60_000);
});

let secondHarness: PostgresHarness;
let databaseUrlBeforeSecondRuntime: string | undefined;
let secondRuntimeDatabase: DatabaseClient | undefined;

/**
 * 此回归和首次 handler 测试运行在同一 Vitest 隔离上下文中，专门验证 afterAll 不会
 * 遗留指向已停止首个容器的全局客户端；第二个容器必须获得全新的 Drizzle 连接。
 */
describe("Better Auth 运行时数据库缓存清理", () => {
  beforeAll(async () => {
    secondHarness = await startPostgres();
    databaseUrlBeforeSecondRuntime = process.env.DATABASE_URL;
    process.env.DATABASE_URL = secondHarness.connectionUri;
    vi.resetModules();
  }, 60_000);

  afterAll(async () => {
    try {
      const database = secondRuntimeDatabase;
      if (database && globalForDb.database === database) {
        delete globalForDb.database;
        await database.sql.end();
      }
    } finally {
      if (databaseBeforeAuthRuntime === undefined) {
        delete globalForDb.database;
      } else {
        globalForDb.database = databaseBeforeAuthRuntime;
      }

      vi.resetModules();
      if (databaseUrlBeforeSecondRuntime === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = databaseUrlBeforeSecondRuntime;
      }

      if (secondHarness) {
        await secondHarness.stop();
      }
    }
  });

  it("在首个 runtime 测试结束后恢复测试前的全局客户端", () => {
    expect(globalForDb.database).toBe(databaseBeforeAuthRuntime);
  });

  it("清理首套缓存后连接第二个真实数据库", async () => {
    if (globalForDb.database === databaseBeforeAuthRuntime) {
      delete globalForDb.database;
    } else if (globalForDb.database) {
      const leakedDatabase = globalForDb.database;
      delete globalForDb.database;
      await leakedDatabase.sql.end();
    }

    const { getDatabaseClient } = await import("@/server/db");
    secondRuntimeDatabase = getDatabaseClient();
    expect(secondRuntimeDatabase).not.toBe(firstRuntimeDatabase);

    const [users] = await secondRuntimeDatabase.sql<{ count: number }[]>`
      select count(*)::int as count from "user"
    `;
    expect(users.count).toBe(0);
  }, 60_000);
});
