import { expect, it, vi } from "vitest";

import { requireSession } from "@/server/auth/session";

it("Better Auth 没有有效 Session 时返回 401", async () => {
  await expect(
    requireSession(new Headers(), {
      getSession: vi.fn().mockResolvedValue(null),
    }),
  ).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
    status: 401,
    message: "登录状态已失效，请重新登录。",
  });
});
