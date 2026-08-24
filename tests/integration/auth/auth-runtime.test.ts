import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { startPostgres, type PostgresHarness } from "../../support/postgres";

const authEnvironmentKeys = [
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
] as const;
const originalAuthEnvironment = new Map<string, string | undefined>();

let harness: PostgresHarness;

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
    vi.resetModules();
    restoreAuthEnvironment();

    if (harness) {
      await harness.stop();
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
  }, 60_000);
});
