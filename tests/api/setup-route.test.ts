import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  consume: vi.fn(),
  normalizeUsername: vi.fn((value: string) => value.toLowerCase()),
}));

vi.mock("@/server/bootstrap/initialize-setup", () => ({
  createSetupService: () => ({ claim: mocks.claim }),
}));
vi.mock("@/server/auth/username", () => ({
  normalizeUsername: mocks.normalizeUsername,
}));
vi.mock("@/server/auth/runtime-config", () => ({
  authRuntimeConfig: { secret: "test-secret" },
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/security/client-ip", () => ({
  resolveClientIp: vi.fn().mockReturnValue("198.51.100.8"),
}));
vi.mock("@/server/security/rate-limiter", () => ({
  RateLimiter: class {
    consume = mocks.consume;
  },
}));

import { POST } from "@/app/api/setup/route";

it("首次管理员初始化不要求 Setup Token", async () => {
  mocks.consume.mockResolvedValueOnce(undefined);
  mocks.claim.mockResolvedValueOnce(undefined);

  const response = await POST(
    new Request("http://localhost/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Admin",
        password: "password123",
        nickname: "管理员",
      }),
    }),
  );

  expect(response.status).toBe(201);
  expect(mocks.consume).toHaveBeenCalledWith("SETUP", "198.51.100.8:admin", {
    limit: 5,
    windowSeconds: 600,
  });
  expect(mocks.claim).toHaveBeenCalledWith({
    username: "admin",
    password: "password123",
    nickname: "管理员",
  });
});
