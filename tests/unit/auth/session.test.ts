import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { requireSession } from "@/server/auth/session";

it("没有 Better Auth session 时返回 401", async () => {
  await expect(
    requireSession(new Headers(), {
      getSession: vi.fn().mockResolvedValue(null),
    }),
  ).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
    message: "登录状态已失效，请重新登录。",
    status: 401,
  });
});

it("保留 Better Auth 返回的完整 session 内容", async () => {
  const session = {
    session: { id: "session-1", userId: "user-1" },
    user: { id: "user-1", email: "member@example.com" },
  };

  await expect(
    requireSession(new Headers(), {
      getSession: vi.fn().mockResolvedValue(session),
    }),
  ).resolves.toBe(session);
});
