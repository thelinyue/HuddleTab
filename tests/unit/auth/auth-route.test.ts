import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST } from "@/app/api/auth/[...all]/route";

describe("Better Auth 路由边界", () => {
  it("拒绝绕过产品注册策略的原生邮箱注册入口", async () => {
    const response = await POST(
      new Request("http://localhost:5660/api/auth/sign-up/email", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
  });
});
