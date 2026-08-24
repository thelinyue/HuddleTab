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

function cookieRequestHeader(setCookies: string[]): string {
  return setCookies
    .map((setCookie) => setCookie.slice(0, setCookie.indexOf(";")))
    .join("; ");
}

async function register(body: Record<string, unknown>): Promise<Response> {
  const { POST } = await import("@/app/api/auth/register/route");
  return POST(
    new Request("http://localhost:5660/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function countsForUser(
  column: "email" | "username",
  value: string,
): Promise<{
  users: number;
  accounts: number;
  profiles: number;
  sessions: number;
}> {
  if (column === "email") {
    const [record] = await harness.sql<
      { users: number; accounts: number; profiles: number; sessions: number }[]
    >`
      select
        (select count(*)::int from "user" where email = ${value}) as users,
        (select count(*)::int from account a join "user" u on u.id = a.user_id where u.email = ${value}) as accounts,
        (select count(*)::int from user_profiles p join "user" u on u.id = p.user_id where u.email = ${value}) as profiles,
        (select count(*)::int from session s join "user" u on u.id = s.user_id where u.email = ${value}) as sessions
    `;
    return record;
  }

  const [record] = await harness.sql<
    { users: number; accounts: number; profiles: number; sessions: number }[]
  >`
    select
      (select count(*)::int from "user" where username = ${value}) as users,
      (select count(*)::int from account a join "user" u on u.id = a.user_id where u.username = ${value}) as accounts,
      (select count(*)::int from user_profiles p join "user" u on u.id = p.user_id where u.username = ${value}) as profiles,
      (select count(*)::int from session s join "user" u on u.id = s.user_id where u.username = ${value}) as sessions
  `;
  return record;
}
/** 注册路由必须用真实 Better Auth 会话和正式 PostgreSQL 18 验证 cookie 与冲突边界。 */
describe("注册路由运行时", () => {
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
    await harness.sql`update system_settings set registration_policy = 'OPEN' where id = 'singleton'`;
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

  it("OPEN 注册透传每条 Set-Cookie，并可用 cookie 查询到新会话", async () => {
    const response = await register({
      username: "route-session-user",
      password: "valid-password-123",
      nickname: "会话用户",
    });
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      data: {
        id: expect.any(String),
        username: "route-session-user",
        nickname: "会话用户",
      },
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /token|local\.invalid|email|password/i,
    );

    const setCookies = response.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThan(0);
    const { auth } = await import("@/server/auth/auth");
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookieRequestHeader(setCookies) }),
    });
    expect(session?.user.id).toBe(payload.data.id);
  }, 60_000);

  it("将重复真实邮箱映射为 409，且不新增认证或 profile 记录", async () => {
    const email = "duplicate-email@example.test";
    const first = await register({
      username: "duplicate-email-first",
      password: "valid-password-123",
      nickname: "首位用户",
      email,
    });
    expect(first.status).toBe(201);
    const before = await countsForUser("email", email);

    const duplicate = await register({
      username: "duplicate-email-second",
      password: "valid-password-123",
      nickname: "重复邮箱",
      email,
    });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: {
        code: "EMAIL_ALREADY_REGISTERED",
        message: "该邮箱已注册，请使用其他邮箱。",
        fieldErrors: {},
        details: {},
      },
    });
    expect(duplicate.headers.getSetCookie()).toHaveLength(0);
    expect(await countsForUser("email", email)).toEqual(before);
  }, 60_000);

  it("将重复 canonical username 映射为 409，且不新增认证或 profile 记录", async () => {
    const username = "duplicate-canonical-user";
    const first = await register({
      username,
      password: "valid-password-123",
      nickname: "首位用户名用户",
      email: "duplicate-username-first@example.test",
    });
    expect(first.status).toBe(201);
    const before = await countsForUser("username", username);

    const duplicate = await register({
      username: "  DUPLICATE-CANONICAL-USER  ",
      password: "valid-password-123",
      nickname: "重复用户名",
      email: "duplicate-username-second@example.test",
    });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({
      error: {
        code: "USERNAME_ALREADY_TAKEN",
        message: "该用户名已被占用，请使用其他用户名。",
        fieldErrors: {},
        details: {},
      },
    });
    expect(duplicate.headers.getSetCookie()).toHaveLength(0);
    expect(await countsForUser("username", username)).toEqual(before);
  }, 60_000);
});
