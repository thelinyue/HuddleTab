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
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function request(body: unknown) {
  return new Request("http://localhost:5660/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cookieRequestHeader(setCookies: string[]) {
  return setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

/** Setup Route 必须运行于真实认证与 PostgreSQL，避免 Cookie 或补偿语义被 mock 掩盖。 */
describe("初始化路由运行时", () => {
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
      if (databaseBeforeTest === undefined) delete globalForDb.database;
      else globalForDb.database = databaseBeforeTest;
      vi.resetModules();
      restoreAuthEnvironment();
      originalEnvironment.clear();
      if (harness) await harness.stop();
    }
  });

  it("GET 返回 setupRequired，POST 对无效输入和 token 使用固定错误信封", async () => {
    const { GET, POST } = await import("@/app/api/setup/route");
    const before = await GET();
    expect(await before.json()).toEqual({ data: { setupRequired: true } });

    const malformedJson = await POST(
      new Request("http://localhost:5660/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(malformedJson.status).toBe(422);
    expect(await malformedJson.json()).toEqual({
      error: {
        code: "INVALID_SETUP_INPUT",
        message: "初始化信息格式不正确。",
        fieldErrors: {},
        details: {},
      },
    });

    const invalidInput = await POST(request({ username: "owner" }));
    expect(invalidInput.status).toBe(422);
    expect(await invalidInput.json()).toEqual({
      error: {
        code: "INVALID_SETUP_INPUT",
        message: "初始化信息格式不正确。",
        fieldErrors: {},
        details: {},
      },
    });

    const invalidToken = await POST(
      request({
        setupToken: "z".repeat(43),
        username: "owner",
        password: "valid-password-123",
        nickname: "管理员",
      }),
    );
    expect(invalidToken.status).toBe(403);
    expect(await invalidToken.json()).toEqual({
      error: {
        code: "INVALID_SETUP_TOKEN",
        message: "初始化口令无效或已失效。",
        fieldErrors: {},
        details: {},
      },
    });
  }, 60_000);

  it("成功 setup 仅返回 initialized，并透传可查询管理员会话的 Cookie", async () => {
    const { SetupService } = await import("@/server/services/setup-service");
    const { createSetupCredentialUser, compensateSetupCredentialUser } =
      await import("@/server/services/registration-service");
    const { POST, GET } = await import("@/app/api/setup/route");
    const service = new SetupService(harness.sql, {
      create: createSetupCredentialUser,
      compensate: compensateSetupCredentialUser,
    });
    const token = await service.rotateForUninitializedStartup();

    const response = await POST(
      request({
        setupToken: token,
        username: "route-setup-owner",
        password: "valid-password-123",
        nickname: "路由管理员",
      }),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { initialized: true } });
    expect(response.headers.getSetCookie()).not.toHaveLength(0);

    const { auth } = await import("@/server/auth/auth");
    const session = await auth.api.getSession({
      headers: new Headers({
        cookie: cookieRequestHeader(response.headers.getSetCookie()),
      }),
    });
    expect(session?.user.username).toBe("route-setup-owner");
    expect(await (await GET()).json()).toEqual({
      data: { setupRequired: false },
    });
  }, 60_000);
});
