import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
}));

vi.mock("@/server/auth/auth", () => ({ auth: { api: {} } }));
vi.mock("@/server/auth/runtime-config", () => ({
  authRuntimeConfig: { secret: "test-secret" },
}));
vi.mock("@/server/bootstrap/initialize-setup", () => ({
  createSetupService: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({ db: {}, sql: {} }));
vi.mock("@/server/security/client-ip", () => ({
  resolveClientIp: vi.fn().mockReturnValue("198.51.100.8"),
}));
vi.mock("@/server/security/rate-limiter", () => ({
  RateLimiter: class {
    consume = mocks.consume;
  },
}));
vi.mock("@/server/services/registration-service", () => ({
  RegistrationService: vi.fn(),
}));

import { POST as register } from "@/app/api/auth/register/route";
import { POST as setup } from "@/app/api/setup/route";

it("注册限流返回稳定的 429 错误响应", async () => {
  mocks.consume.mockRejectedValueOnce(
    new ApplicationError("RATE_LIMITED", "尝试次数过多，请稍后再试。", 429),
  );

  const response = await register(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: "alice",
        password: "password123",
        nickname: "Alice",
      }),
    }),
  );

  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({
    error: {
      code: "RATE_LIMITED",
      message: "尝试次数过多，请稍后再试。",
      fieldErrors: {},
      details: {},
    },
  });
});

it("初始化限流返回稳定的 429 错误响应", async () => {
  mocks.consume.mockRejectedValueOnce(
    new ApplicationError("RATE_LIMITED", "尝试次数过多，请稍后再试。", 429),
  );

  const response = await setup(
    new Request("http://localhost/api/setup", {
      method: "POST",
      body: JSON.stringify({
        setupToken: "a".repeat(20),
        username: "admin",
        password: "password123",
        nickname: "管理员",
      }),
    }),
  );

  expect(response.status).toBe(429);
  expect(await response.json()).toEqual({
    error: {
      code: "RATE_LIMITED",
      message: "尝试次数过多，请稍后再试。",
      fieldErrors: {},
      details: {},
    },
  });
});
