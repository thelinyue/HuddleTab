import { describe, expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  fromStatus: vi.fn((status, body) => ({ status, body })),
}));

vi.mock("server-only", () => ({}));
vi.mock("better-auth", () => ({
  betterAuth: (options: unknown) => ({ options }),
}));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: vi.fn(),
}));
vi.mock("better-auth/api", () => ({
  APIError: { fromStatus: mocks.fromStatus },
  createAuthMiddleware: (handler: unknown) => handler,
}));
vi.mock("better-auth/plugins", () => ({ username: vi.fn() }));
vi.mock("@/server/auth/runtime-config", () => ({
  authRuntimeConfig: {
    baseURL: "http://localhost:5660",
    secret: "test-secret",
    trustedOrigins: ["http://localhost:5660", "http://127.0.0.1:5660"],
  },
}));
vi.mock("@/server/db/client", () => ({ db: {}, sql: {} }));
vi.mock("@/server/security/rate-limiter", () => ({
  RateLimiter: class {
    consume = mocks.consume;
  },
}));

import { auth } from "@/server/auth/auth";

interface AuthOptions {
  readonly hooks: { readonly before: (context: unknown) => Promise<void> };
  readonly rateLimit: { readonly enabled: boolean };
}

const beforeHook = (auth as unknown as { options: AuthOptions }).options.hooks
  .before;

describe("登录限流 Hook", () => {
  it("关闭 Better Auth 仅按 IP 的内置限流，统一由组合标识限流执行", () => {
    expect(
      (auth as unknown as { options: AuthOptions }).options.rateLimit,
    ).toEqual({
      enabled: false,
    });
  });

  it("在用户名密码验证前按直连边界和用户名消耗窗口", async () => {
    await beforeHook({
      path: "/sign-in/username",
      body: { username: "Alice" },
      request: new Request("http://localhost/api/auth/sign-in/username"),
    });

    expect(mocks.consume).toHaveBeenCalledWith(
      "LOGIN",
      "direct-connection:alice",
      { limit: 10, windowSeconds: 600 },
    );
  });

  it("将持久限流错误转换为 Better Auth 的 429 错误", async () => {
    mocks.consume.mockRejectedValueOnce(
      new ApplicationError("RATE_LIMITED", "尝试次数过多，请稍后再试。", 429),
    );

    await expect(
      beforeHook({
        path: "/sign-in/email",
        body: { email: "Alice@Example.com" },
        request: new Request("http://localhost/api/auth/sign-in/email"),
      }),
    ).rejects.toEqual({
      status: "TOO_MANY_REQUESTS",
      body: { code: "RATE_LIMITED", message: "尝试次数过多，请稍后再试。" },
    });
    expect(mocks.consume).toHaveBeenCalledWith(
      "LOGIN",
      "direct-connection:alice@example.com",
      { limit: 10, windowSeconds: 600 },
    );
  });
});
