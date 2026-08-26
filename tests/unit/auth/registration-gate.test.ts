import { describe, expect, it, vi } from "vitest";

import { assertRegistrationAllowed } from "@/server/auth/registration-gate";

describe("注册策略", () => {
  it("允许 OPEN，并在 INVITE_ONLY 时委托邀请码校验器", async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(true) };

    await expect(
      assertRegistrationAllowed("OPEN", undefined, verifier),
    ).resolves.toBeUndefined();
    await expect(
      assertRegistrationAllowed("INVITE_ONLY", "proof", verifier),
    ).resolves.toBeUndefined();
    expect(verifier.verify).toHaveBeenCalledWith("proof");
  });

  it("拒绝缺失或无效的邀请凭证", async () => {
    await expect(
      assertRegistrationAllowed("INVITE_ONLY", undefined, {
        verify: async () => false,
      }),
    ).rejects.toMatchObject({
      code: "REGISTRATION_INVITE_REQUIRED",
      status: 403,
      message: "当前系统仅允许受邀用户注册。",
    });
  });
});
