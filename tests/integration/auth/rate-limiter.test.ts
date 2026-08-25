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

import postgres from "postgres";

import type { createDatabaseClient } from "@/server/db/factory";
import {
  RATE_LIMIT_ATTEMPT_LIMIT,
  RateLimiter,
} from "@/server/security/rate-limiter";
import { startPostgres, type PostgresHarness } from "../../support/postgres";

const authEnvironmentKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "TRUST_PROXY",
  "SECURE_COOKIES",
] as const;
const originalEnvironment = new Map<string, string | undefined>();
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
const globalForDb = globalThis as typeof globalThis & {
  database?: DatabaseClient;
};

let harness: PostgresHarness;
let databaseBeforeTest: DatabaseClient | undefined;

function restoreEnvironment() {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function headers(values: Record<string, string> = {}): Headers {
  return new Headers({ "content-type": "application/json", ...values });
}

async function register(
  body: Record<string, unknown>,
  requestHeaders: Headers = headers(),
): Promise<Response> {
  const { POST } = await import("@/app/api/auth/register/route");
  return POST(
    new Request("http://localhost:5660/api/auth/register", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    }),
  );
}

async function setup(
  body: Record<string, unknown>,
  requestHeaders: Headers = headers(),
): Promise<Response> {
  const { POST } = await import("@/app/api/setup/route");
  return POST(
    new Request("http://localhost:5660/api/setup", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    }),
  );
}

async function login(
  body: Record<string, unknown>,
  requestHeaders: Headers = headers(),
): Promise<Response> {
  const { POST } = await import("@/app/api/auth/[...all]/route");
  return POST(
    new Request("http://localhost:5660/api/auth/sign-in/username", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
    }),
  );
}

function registrationBody(username: string) {
  return {
    username,
    password: "valid-password-123",
    nickname: "限流测试用户",
  };
}

async function bucketKeys(): Promise<string[]> {
  const rows = await harness.sql<{ bucket_key: string }[]>`
    select bucket_key from security_rate_limit_buckets order by bucket_key
  `;
  return rows.map((row) => row.bucket_key);
}

/**
 * 认证限流必须使用正式 PostgreSQL upsert 验证并发安全的持久化边界；测试只断言
 * HMAC bucket，不读取或记录实际密码、token、用户名或客户端地址。
 */
describe("认证持久化限流", () => {
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
    process.env.TRUST_PROXY = "false";
    delete process.env.SECURE_COOKIES;
    await harness.sql`update system_settings set registration_policy = 'OPEN' where id = 'singleton'`;
    vi.resetModules();
  }, 60_000);

  beforeEach(async () => {
    await harness.sql`delete from security_rate_limit_buckets`;
    process.env.TRUST_PROXY = "false";
    delete process.env.SECURE_COOKIES;
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
      restoreEnvironment();
      originalEnvironment.clear();
      if (harness) await harness.stop();
    }
  });

  it("第六次消费被拒绝，且数据库只保存 HMAC bucket", async () => {
    const stableIdentifier = "rate-limit-stable-identifier";
    const clientAddress = "198.51.100.200";
    const limiter = new RateLimiter(
      harness.sql,
      process.env.BETTER_AUTH_SECRET!,
    );
    const buckets = [
      { scope: "LOGIN_USERNAME" as const, identifier: stableIdentifier },
      { scope: "LOGIN_IP" as const, identifier: clientAddress },
    ];

    for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPT_LIMIT; attempt += 1) {
      await expect(limiter.consumeAll(buckets)).resolves.toBeUndefined();
    }
    await expect(limiter.consumeAll(buckets)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "尝试次数过多，请稍后再试。",
      status: 429,
    });

    const keys = await bucketKeys();
    expect(keys).toHaveLength(2);
    for (const key of keys) {
      expect(key).toMatch(/^[a-f0-9]{64}$/);
      expect(key).not.toContain(stableIdentifier);
      expect(key).not.toContain(clientAddress);
    }
  });
  it("独立数据库客户端并发消费同一 bucket 时仅允许前五次", async () => {
    const clients = Array.from({ length: RATE_LIMIT_ATTEMPT_LIMIT + 3 }, () =>
      postgres(harness.connectionUri, { max: 1 }),
    );
    try {
      const results = await Promise.allSettled(
        clients.map((client) =>
          new RateLimiter(client, process.env.BETTER_AUTH_SECRET!).consume(
            "LOGIN_USERNAME",
            "concurrent-rate-limit-user",
          ),
        ),
      );
      const fulfilled = results.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = results.filter((result) => result.status === "rejected");

      expect(fulfilled).toHaveLength(RATE_LIMIT_ATTEMPT_LIMIT);
      expect(rejected).toHaveLength(3);
      for (const result of rejected) {
        expect(result.reason).toMatchObject({
          code: "RATE_LIMITED",
          status: 429,
        });
      }

      const [bucket] = await harness.sql<{ attempts: number }[]>`
        select attempts from security_rate_limit_buckets
      `;
      expect(bucket).toEqual({ attempts: RATE_LIMIT_ATTEMPT_LIMIT });
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  }, 60_000);

  it("第二个 bucket 已满时回滚同一 consumeAll 事务中的第一个 bucket", async () => {
    const limiter = new RateLimiter(
      harness.sql,
      process.env.BETTER_AUTH_SECRET!,
    );
    for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPT_LIMIT; attempt += 1) {
      await limiter.consume("LOGIN_IP", "already-full-ip-bucket");
    }

    await expect(
      limiter.consumeAll([
        { scope: "LOGIN_USERNAME", identifier: "must-roll-back-user" },
        { scope: "LOGIN_IP", identifier: "already-full-ip-bucket" },
      ]),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });

    const buckets = await harness.sql<{ attempts: number }[]>`
      select attempts from security_rate_limit_buckets order by attempts
    `;
    expect(buckets).toEqual([{ attempts: RATE_LIMIT_ATTEMPT_LIMIT }]);
  });
  it("正常 consume 会在事务内清理过期 bucket 并保留当前计数", async () => {
    await harness.sql`
      insert into security_rate_limit_buckets (
        bucket_key, window_started_at, attempts, expires_at
      ) values (
        ${"expired-rate-limit-bucket"}, ${"2000-01-01T00:00:00.000Z"}, 3,
        ${"2000-01-01T00:15:00.000Z"}
      )
    `;
    const limiter = new RateLimiter(
      harness.sql,
      process.env.BETTER_AUTH_SECRET!,
    );

    await limiter.consume("LOGIN_USERNAME", "expiry-cleanup-user");

    const rows = await harness.sql<{ attempts: number; is_expired: boolean }[]>`
      select attempts, expires_at <= now() as is_expired
      from security_rate_limit_buckets
      order by bucket_key
    `;
    expect(rows).toEqual([{ attempts: 1, is_expired: false }]);
  });
  it("TRUST_PROXY=false 时稳定标识仍分别保护注册、Setup 与登录", async () => {
    const username = "stable-register-user";
    for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPT_LIMIT; attempt += 1) {
      await register(
        registrationBody(username),
        headers({ "X-Real-IP": "198.51.100.1" }),
      );
    }
    const blockedRegistration = await register(
      registrationBody(username),
      headers({ "X-Real-IP": "198.51.100.1" }),
    );
    expect(blockedRegistration.status).toBe(429);
    expect(await blockedRegistration.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });

    const setupToken = "invalid-setup-token-for-rate-limit-test";
    for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPT_LIMIT; attempt += 1) {
      await setup({
        setupToken,
        username: "stable-setup-user",
        password: "valid-password-123",
        nickname: "初始化用户",
      });
    }
    const blockedSetup = await setup({
      setupToken,
      username: "stable-setup-user",
      password: "valid-password-123",
      nickname: "初始化用户",
    });
    expect(blockedSetup.status).toBe(429);
    expect(await blockedSetup.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });

    const loginUser = await register(registrationBody("stable-login-user"));
    expect(loginUser.status).toBe(201);
    for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPT_LIMIT; attempt += 1) {
      const response = await login({
        username: "stable-login-user",
        password: "wrong-password-123",
      });
      expect(response.status).toBe(401);
    }
    const blockedLogin = await login({
      username: "stable-login-user",
      password: "wrong-password-123",
    });
    expect(blockedLogin.status).toBe(429);
    expect(await blockedLogin.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });

    expect(await bucketKeys()).toHaveLength(4);
  }, 60_000);

  it("完整 schema 失败前仍消费可提取的注册用户名与 Setup Token", async () => {
    const invalidRegistration = {
      username: "early-register-user",
      password: "short",
      nickname: "提前限流注册",
    };
    for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPT_LIMIT; attempt += 1) {
      const response = await register(invalidRegistration);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_REGISTER_INPUT" },
      });
    }
    const blockedRegistration = await register(invalidRegistration);
    expect(blockedRegistration.status).toBe(429);
    expect(await blockedRegistration.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });

    const invalidSetup = {
      setupToken: "early-setup-token-that-is-long-enough",
      username: "early-setup-user",
      password: "short",
      nickname: "提前限流初始化",
    };
    for (let attempt = 0; attempt < RATE_LIMIT_ATTEMPT_LIMIT; attempt += 1) {
      const response = await setup(invalidSetup);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_SETUP_INPUT" },
      });
    }
    const blockedSetup = await setup(invalidSetup);
    expect(blockedSetup.status).toBe(429);
    expect(await blockedSetup.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });

    expect(await bucketKeys()).toHaveLength(2);
  }, 60_000);
  it.each(["", "too-short-token"])(
    "不为不符合 Setup Token 字段边界的字符串创建 bucket：%s",
    async (setupToken) => {
      const invalidSetup = {
        setupToken,
        username: "invalid-token-setup-user",
        password: "valid-password-123",
        nickname: "无效口令初始化",
      };
      for (let attempt = 0; attempt <= RATE_LIMIT_ATTEMPT_LIMIT; attempt += 1) {
        const response = await setup(invalidSetup);
        expect(response.status).toBe(422);
        expect(await response.json()).toMatchObject({
          error: { code: "INVALID_SETUP_INPUT" },
        });
      }

      expect(await bucketKeys()).toHaveLength(0);
    },
  );
  it("TRUST_PROXY=true 仅为单一合法 X-Real-IP 增加第二个 bucket", async () => {
    process.env.TRUST_PROXY = "true";

    const trustedProxyResponse = await register(
      registrationBody("proxy-valid-user"),
      headers({ "X-Real-IP": "198.51.100.20" }),
    );
    expect(trustedProxyResponse.status).toBe(201);
    expect(await bucketKeys()).toHaveLength(2);

    const forgedForwardedResponse = await register(
      registrationBody("proxy-forged-header-user"),
      headers({
        Forwarded: "for=198.51.100.21",
        "X-Forwarded-For": "198.51.100.22",
      }),
    );
    expect(forgedForwardedResponse.status).toBe(201);
    expect(await bucketKeys()).toHaveLength(3);

    const duplicateHeaders = headers();
    duplicateHeaders.append("X-Real-IP", "198.51.100.23");
    duplicateHeaders.append("X-Real-IP", "198.51.100.24");
    const duplicateAddressResponse = await register(
      registrationBody("proxy-duplicate-header-user"),
      duplicateHeaders,
    );
    expect(duplicateAddressResponse.status).toBe(201);
    expect(await bucketKeys()).toHaveLength(4);
  }, 60_000);

  it.each([
    ["http://localhost:5660", undefined, false],
    ["https://huddle.example.test", undefined, true],
    ["http://localhost:5660", "", false],
    ["https://huddle.example.test", "", true],
    ["https://huddle.example.test", "false", false],
    ["http://localhost:5660", "true", true],
  ])(
    "根据 BETTER_AUTH_URL 和 SECURE_COOKIES 配置 Secure Cookie：%s / %s",
    async (baseUrl, secureCookies, expectedSecure) => {
      process.env.BETTER_AUTH_URL = baseUrl;
      if (secureCookies === undefined) delete process.env.SECURE_COOKIES;
      else process.env.SECURE_COOKIES = secureCookies;
      vi.resetModules();

      const userId = `cookie-user-${Math.random().toString(16).slice(2)}`;
      const email = `${userId}@example.test`;
      await harness.seedCredentialUser(userId, email);
      const { auth } = await import("@/server/auth/auth");
      const response = await auth.handler(
        new Request(`${baseUrl}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email,
            password: "test-only-password",
          }),
        }),
      );

      expect(response.status).toBe(200);
      const hasSecureCookie = response.headers
        .getSetCookie()
        .some((cookie) => /;\s*secure(?:;|$)/i.test(cookie));
      expect(hasSecureCookie).toBe(expectedSecure);
    },
    60_000,
  );
  it.each([" ", "unexpected"])(
    "拒绝非精确 SECURE_COOKIES 覆盖值：%s",
    async (secureCookies) => {
      process.env.BETTER_AUTH_URL = "http://localhost:5660";
      process.env.SECURE_COOKIES = secureCookies;
      vi.resetModules();
      const { auth } = await import("@/server/auth/auth");

      await expect(
        (async () => {
          const handler = auth.handler;
          return handler(
            new Request("http://localhost:5660/api/auth/sign-in/email", {
              method: "POST",
            }),
          );
        })(),
      ).rejects.toThrow(
        "认证服务配置无效：SECURE_COOKIES 仅支持 true 或 false。",
      );
    },
  );
});
