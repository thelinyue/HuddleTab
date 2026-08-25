import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const authEnvironmentKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
] as const;
const originalEnvironment = new Map<string, string | undefined>();
const globalForDb = globalThis as typeof globalThis & { database?: unknown };
let databaseBeforeTest: unknown;

function removeAuthEnvironment() {
  databaseBeforeTest = globalForDb.database;
  for (const key of authEnvironmentKeys) {
    originalEnvironment.set(key, process.env[key]);
    delete process.env[key];
  }
}

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  originalEnvironment.clear();

  if (databaseBeforeTest === undefined) {
    delete globalForDb.database;
  } else {
    globalForDb.database = databaseBeforeTest;
  }
});

describe("Better Auth 公共注册旁路", () => {
  it.each([
    "/api/auth/sign-up/email",
    "/api/auth/sign-up/email/",
    "/api/auth/sign-up/email///",
  ])("在认证运行时初始化前拒绝原生 sign-up/email 路径：%s", async (path) => {
    removeAuthEnvironment();
    const { POST } = await import("@/app/api/auth/[...all]/route");

    const response = await POST(
      new Request(`http://localhost:5660${path}`, {
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_REGISTRATION_PATH_DISABLED",
        message: "请使用 /api/auth/register 完成注册。",
        fieldErrors: {},
        details: {},
      },
    });
    expect(globalForDb.database).toBe(databaseBeforeTest);
  });

  it("不会用同一判断阻断其他 Better Auth 路由", async () => {
    removeAuthEnvironment();
    const { POST } = await import("@/app/api/auth/[...all]/route");

    await expect(
      POST(
        new Request("http://localhost:5660/api/auth/sign-in/email", {
          method: "POST",
        }),
      ),
    ).rejects.toThrow("认证服务缺少 BETTER_AUTH_URL 配置。");
  });
});
