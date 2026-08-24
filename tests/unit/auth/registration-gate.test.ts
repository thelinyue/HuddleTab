import { describe, expect, it, vi } from "vitest";

import { assertRegistrationAllowed } from "@/server/auth/registration-gate";

describe("注册门禁", () => {
  it("OPEN 直接放行，INVITE_ONLY 交给邀请验证器", async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(true) };

    await expect(
      assertRegistrationAllowed("OPEN", undefined, verifier),
    ).resolves.toBeUndefined();
    expect(verifier.verify).not.toHaveBeenCalled();

    await expect(
      assertRegistrationAllowed("INVITE_ONLY", "invite-proof", verifier),
    ).resolves.toBeUndefined();
    expect(verifier.verify).toHaveBeenCalledWith("invite-proof");
  });

  it.each([undefined, "invalid-proof"])(
    "INVITE_ONLY 拒绝缺失或无效邀请码证明: %s",
    async (inviteProof) => {
      await expect(
        assertRegistrationAllowed("INVITE_ONLY", inviteProof, {
          verify: async () => false,
        }),
      ).rejects.toMatchObject({
        code: "REGISTRATION_INVITE_REQUIRED",
        status: 403,
        message: "当前系统仅允许受邀用户注册。",
      });
    },
  );
});
