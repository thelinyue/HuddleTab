import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

import type { createDatabaseClient } from "@/server/db/factory";
import { startPostgres, type PostgresHarness } from "../support/postgres";

const authEnvironmentKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
] as const;
const originalEnvironment = new Map<string, string | undefined>();
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
type ApiResponse<T = unknown> = { status: number; json: T };
type AuthenticatedSession = {
  user: { id: string; email: string };
  headers: Headers;
  password: string;
};

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

function cookieRequestHeader(setCookies: string[]): string {
  return setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function toApiResponse(response: Response): Promise<ApiResponse> {
  return {
    status: response.status,
    json: response.status === 204 ? undefined : await response.json(),
  };
}

function request(
  path: string,
  method: string,
  session: AuthenticatedSession,
  body?: unknown,
): Request {
  const headers = new Headers(session.headers);
  if (body !== undefined) headers.set("content-type", "application/json");

  return new Request(`http://localhost:5660${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const api = {
  async get(path: string, session: AuthenticatedSession): Promise<ApiResponse> {
    if (path === "/api/me/profile") {
      const { GET } = await import("@/app/api/me/profile/route");
      return toApiResponse(await GET(request(path, "GET", session)));
    }
    if (path === "/api/me/email") {
      const { GET } = await import("@/app/api/me/email/route");
      return toApiResponse(await GET(request(path, "GET", session)));
    }
    if (path === "/api/me/sessions") {
      const { GET } = await import("@/app/api/me/sessions/route");
      return toApiResponse(await GET(request(path, "GET", session)));
    }
    throw new Error(`未实现的测试 GET 路径：${path}`);
  },

  async patch(
    path: string,
    session: AuthenticatedSession,
    body: unknown,
  ): Promise<ApiResponse> {
    if (path === "/api/me/profile") {
      const { PATCH } = await import("@/app/api/me/profile/route");
      return toApiResponse(await PATCH(request(path, "PATCH", session, body)));
    }
    if (path === "/api/me/email") {
      const { PATCH } = await import("@/app/api/me/email/route");
      return toApiResponse(await PATCH(request(path, "PATCH", session, body)));
    }
    if (path === "/api/me/theme") {
      const { PATCH } = await import("@/app/api/me/theme/route");
      return toApiResponse(await PATCH(request(path, "PATCH", session, body)));
    }
    throw new Error(`未实现的测试 PATCH 路径：${path}`);
  },

  async post(
    path: string,
    session: AuthenticatedSession,
    body: unknown,
  ): Promise<ApiResponse> {
    if (path === "/api/me/password") {
      const { POST } = await import("@/app/api/me/password/route");
      return toApiResponse(await POST(request(path, "POST", session, body)));
    }
    throw new Error(`未实现的测试 POST 路径：${path}`);
  },

  async delete(
    path: string,
    session: AuthenticatedSession,
  ): Promise<ApiResponse> {
    const { DELETE } = await import("@/app/api/me/sessions/route");
    return toApiResponse(await DELETE(request(path, "DELETE", session)));
  },

  async seedSecondSession(user: AuthenticatedSession): Promise<{ id: string }> {
    const { auth } = await import("@/server/auth/auth");
    const signIn = await auth.api.signInEmail({
      body: { email: user.user.email, password: user.password },
      returnHeaders: true,
    });
    const session = await auth.api.getSession({
      headers: new Headers({
        cookie: cookieRequestHeader(signIn.headers.getSetCookie()),
      }),
    });
    if (!session) throw new Error("未能创建第二个测试会话。");
    return { id: session.session.id };
  },
};

async function createSyntheticUser(
  username = "alice",
): Promise<AuthenticatedSession> {
  const password = "valid-password-123";
  const { POST } = await import("@/app/api/auth/register/route");
  const response = await POST(
    new Request("http://localhost:5660/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, nickname: "Alice" }),
    }),
  );
  expect(response.status).toBe(201);

  const { auth } = await import("@/server/auth/auth");
  const headers = new Headers({
    cookie: cookieRequestHeader(response.headers.getSetCookie()),
  });
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("注册后未能读取测试会话。");

  return {
    user: { id: session.user.id, email: session.user.email },
    headers,
    password,
  };
}

async function resetDatabase(): Promise<void> {
  await harness.sql`delete from session`;
  await harness.sql`delete from account`;
  await harness.sql`delete from system_roles`;
  await harness.sql`delete from user_profiles`;
  await harness.sql`delete from "user"`;
  await harness.sql`update system_settings set registration_policy = 'OPEN' where id = 'singleton'`;
}

/**
 * 此组测试通过真实 Next Route Handler、Better Auth 1.7.1 与 PostgreSQL 迁移验证账户边界；
 * 不模拟认证框架，以确保密码哈希、HttpOnly Cookie 和 session 所有权保持由 Better Auth 管理。
 */
describe("已登录账户 API", () => {
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

  beforeEach(async () => {
    await resetDatabase();
  });

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
  }, 60_000);

  it("returns profile without exposing Synthetic Email", async () => {
    const syntheticUserSession = await createSyntheticUser();

    const response = await api.get("/api/me/profile", syntheticUserSession);

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      data: {
        username: "alice",
        nickname: "Alice",
        emailBound: false,
        themePreference: "SYSTEM",
      },
    });
    expect(JSON.stringify(response.json)).not.toContain("@local.invalid");
  });

  it("updates nickname and theme preference for the authenticated user", async () => {
    const syntheticUserSession = await createSyntheticUser();

    await expect(
      api.patch("/api/me/profile", syntheticUserSession, {
        nickname: "Alice 新昵称",
      }),
    ).resolves.toMatchObject({ status: 204 });
    await expect(
      api.patch("/api/me/theme", syntheticUserSession, { theme: "DARK" }),
    ).resolves.toMatchObject({ status: 204 });

    await expect(
      api.get("/api/me/profile", syntheticUserSession),
    ).resolves.toMatchObject({
      status: 200,
      json: {
        data: {
          nickname: "Alice 新昵称",
          themePreference: "DARK",
        },
      },
    });
  });

  it("binds a real email and only exposes it after the profile is REAL", async () => {
    const syntheticUserSession = await createSyntheticUser();

    await expect(
      api.get("/api/me/email", syntheticUserSession),
    ).resolves.toMatchObject({
      status: 200,
      json: { data: { emailBound: false } },
    });
    await expect(
      api.patch("/api/me/email", syntheticUserSession, {
        email: " Alice@Example.com ",
      }),
    ).resolves.toMatchObject({ status: 204 });

    const response = await api.get("/api/me/email", syntheticUserSession);
    expect(response).toMatchObject({
      status: 200,
      json: { data: { emailBound: true, email: "alice@example.com" } },
    });
    expect(JSON.stringify(response.json)).not.toContain("@local.invalid");
  });

  it("validates the current password and delegates a successful password change", async () => {
    const syntheticUserSession = await createSyntheticUser();

    await expect(
      api.post("/api/me/password", syntheticUserSession, {
        currentPassword: "incorrect-password",
        newPassword: "new-valid-password-456",
      }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      api.post("/api/me/password", syntheticUserSession, {
        currentPassword: syntheticUserSession.password,
        newPassword: "new-valid-password-456",
      }),
    ).resolves.toMatchObject({ status: 204 });

    const { auth } = await import("@/server/auth/auth");
    const oldPasswordResponse = await auth.handler(
      new Request("http://localhost:5660/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: syntheticUserSession.user.email,
          password: syntheticUserSession.password,
        }),
      }),
    );
    const newPasswordResponse = await auth.handler(
      new Request("http://localhost:5660/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: syntheticUserSession.user.email,
          password: "new-valid-password-456",
        }),
      }),
    );
    expect(oldPasswordResponse.status).toBe(401);
    expect(newPasswordResponse.status).toBe(200);
  });

  it("lists sessions without leaking session tokens or Synthetic Email", async () => {
    const syntheticUserSession = await createSyntheticUser();
    await api.seedSecondSession(syntheticUserSession);

    const response = await api.get("/api/me/sessions", syntheticUserSession);

    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({
      data: expect.arrayContaining([
        expect.objectContaining({
          id: expect.any(String),
          current: expect.any(Boolean),
        }),
      ]),
    });
    expect(JSON.stringify(response.json)).not.toMatch(/token|@local\.invalid/i);
  });

  it("revokes one selected session without revoking the current session", async () => {
    const syntheticUserSession = await createSyntheticUser();
    const target = await api.seedSecondSession(syntheticUserSession);

    await expect(
      api.delete(
        `/api/me/sessions?sessionId=${target.id}`,
        syntheticUserSession,
      ),
    ).resolves.toMatchObject({ status: 204 });

    await expect(
      api.get("/api/me/profile", syntheticUserSession),
    ).resolves.toMatchObject({
      status: 200,
    });
    await expect(
      api.get("/api/me/sessions", syntheticUserSession),
    ).resolves.toMatchObject({
      json: {
        data: expect.not.arrayContaining([
          expect.objectContaining({ id: target.id }),
        ]),
      },
    });
  });

  it("does not revoke a session owned by another user", async () => {
    const syntheticUserSession = await createSyntheticUser("alice");
    const anotherUserSession = await createSyntheticUser("bob");
    const target = await api.seedSecondSession(anotherUserSession);

    await expect(
      api.delete(
        `/api/me/sessions?sessionId=${target.id}`,
        syntheticUserSession,
      ),
    ).resolves.toMatchObject({ status: 404 });

    await expect(
      api.get("/api/me/sessions", anotherUserSession),
    ).resolves.toMatchObject({
      json: {
        data: expect.arrayContaining([
          expect.objectContaining({ id: target.id }),
        ]),
      },
    });
  });
});
