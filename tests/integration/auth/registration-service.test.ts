import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { createDatabaseClient } from "@/server/db/factory";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

const authEnvironmentKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
] as const;
const originalEnvironment = new Map<string, string | undefined>();
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
const globalForDb = globalThis as typeof globalThis & {
  database?: DatabaseClient;
};

let harness: PostgresHarness;
let databaseBeforeTest: DatabaseClient | undefined;

function restoreAuthEnvironment() {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * 正常路径始终调用真实 Better Auth 与 PostgreSQL 18；仅 profile 失败通过数据库 trigger
 * 注入，使补偿验证不会被 mock 的认证结果掩盖。
 */
describe("RegistrationService", () => {
  beforeAll(async () => {
    databaseBeforeTest = globalForDb.database;
    delete globalForDb.database;
    harness = await startPostgres();

    for (const key of authEnvironmentKeys) {
      originalEnvironment.set(key, process.env[key]);
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
      if (database && database !== databaseBeforeTest) {
        delete globalForDb.database;
        await database.sql.end();
      }
    } finally {
      if (databaseBeforeTest === undefined) {
        delete globalForDb.database;
      } else {
        globalForDb.database = databaseBeforeTest;
      }
      vi.resetModules();
      restoreAuthEnvironment();
      originalEnvironment.clear();
      if (harness) {
        await harness.stop();
      }
    }
  });

  it("OPEN 注册写入真实认证 user/account 与 SYNTHETIC profile，响应不泄露内部邮箱", async () => {
    await harness.sql`update system_settings set registration_policy = 'OPEN' where id = 'singleton'`;
    const { RegistrationService } =
      await import("@/server/services/registration-service");

    const result = await new RegistrationService({
      verify: async () => false,
    }).register({
      username: "  ＡLICE＿０１  ",
      password: "valid-password-123",
      nickname: "小艾",
    });

    expect(result.user).toEqual({
      id: expect.any(String),
      username: "alice_01",
      nickname: "小艾",
    });
    expect(result.user).not.toHaveProperty("email");
    expect(JSON.stringify(result.user)).not.toContain("local.invalid");
    expect(result.headers.getSetCookie()).not.toHaveLength(0);

    const [record] = await harness.sql<
      {
        email: string;
        username: string;
        emailKind: string;
        providerId: string;
        password: string | null;
      }[]
    >`
      select u.email, u.username, p.email_kind as "emailKind",
             a.provider_id as "providerId", a.password
      from "user" u
      join user_profiles p on p.user_id = u.id
      join account a on a.user_id = u.id
      where u.id = ${result.user.id}
    `;
    expect(record).toMatchObject({
      username: "alice_01",
      emailKind: "SYNTHETIC",
      providerId: "credential",
      password: expect.any(String),
    });
    expect(record.email).toMatch(/^u_[0-9a-f]{32}@local\.invalid$/);
  }, 60_000);

  it("将提供的真实邮箱规范化后标记为 REAL", async () => {
    const { RegistrationService } =
      await import("@/server/services/registration-service");
    const result = await new RegistrationService({
      verify: async () => false,
    }).register({
      username: "real-email-user",
      password: "valid-password-123",
      nickname: "真实邮箱",
      email: "  Real.User@EXAMPLE.TEST  ",
    });

    const [record] = await harness.sql<{ email: string; emailKind: string }[]>`
      select u.email, p.email_kind as "emailKind"
      from "user" u
      join user_profiles p on p.user_id = u.id
      where u.id = ${result.user.id}
    `;
    expect(record).toEqual({
      email: "real.user@example.test",
      emailKind: "REAL",
    });
    expect(result.user).not.toHaveProperty("email");
  }, 60_000);

  it.each([undefined, "bad-invite-proof"])(
    "INVITE_ONLY 的无效邀请证明不会创建认证用户: %s",
    async (inviteProof) => {
      await harness.sql`update system_settings set registration_policy = 'INVITE_ONLY' where id = 'singleton'`;
      const { RegistrationService } =
        await import("@/server/services/registration-service");
      const username = `invite-blocked-${inviteProof ? "bad" : "none"}`;

      await expect(
        new RegistrationService({ verify: async () => false }).register({
          username,
          password: "valid-password-123",
          nickname: "受限用户",
          inviteProof,
        }),
      ).rejects.toMatchObject({
        code: "REGISTRATION_INVITE_REQUIRED",
        status: 403,
      });

      const [record] = await harness.sql<{ users: number; accounts: number }[]>`
        select
          (select count(*)::int from "user" where username = ${username}) as users,
          (select count(*)::int from account a join "user" u on u.id = a.user_id where u.username = ${username}) as accounts
      `;
      expect(record).toEqual({ users: 0, accounts: 0 });
    },
  );

  it("profile 写入失败时删除刚创建的认证 user 和 credential account", async () => {
    await harness.sql`update system_settings set registration_policy = 'OPEN' where id = 'singleton'`;
    await harness.sql`
      create function reject_registration_profile() returns trigger as $$
      begin
        raise exception 'profile insert intentionally failed';
      end;
      $$ language plpgsql
    `;
    await harness.sql`
      create trigger reject_registration_profile_trigger
      before insert on user_profiles
      for each row execute function reject_registration_profile()
    `;

    const { RegistrationService } =
      await import("@/server/services/registration-service");
    const username = "compensation-user";
    await expect(
      new RegistrationService({ verify: async () => false }).register({
        username,
        password: "valid-password-123",
        nickname: "补偿用户",
      }),
    ).rejects.toThrow();

    const [record] = await harness.sql<
      { users: number; accounts: number; sessions: number }[]
    >`
      select
        (select count(*)::int from "user" where username = ${username}) as users,
        (select count(*)::int from account a join "user" u on u.id = a.user_id where u.username = ${username}) as accounts,
        (select count(*)::int from session s join "user" u on u.id = s.user_id where u.username = ${username}) as sessions
    `;
    expect(record).toEqual({ users: 0, accounts: 0, sessions: 0 });
  }, 60_000);
});
