import { describe, expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";
import { registerInput } from "@/server/validation/auth";

const register = vi.fn();

vi.mock("@/server/services/registration-service", () => ({
  RegistrationService: class {
    register = register;
  },
}));

import { POST } from "@/app/api/auth/register/route";

describe("注册输入校验", () => {
  it("清理昵称和真实邮箱，但保留 username 交由统一规范化入口处理", () => {
    expect(
      registerInput.parse({
        username: "  ＡLICE＿０１  ",
        password: "valid-password-123",
        nickname: "  小艾  ",
        email: "  ALICE@EXAMPLE.TEST  ",
      }),
    ).toEqual({
      username: "  ＡLICE＿０１  ",
      password: "valid-password-123",
      nickname: "小艾",
      email: "alice@example.test",
    });
  });

  it.each([
    { username: "alice", password: "short", nickname: "小艾" },
    { username: "alice", password: "valid-password-123", nickname: " " },
    {
      username: "alice",
      password: "valid-password-123",
      nickname: "小艾",
      email: "not-an-email",
    },
  ])("拒绝不符合边界的注册输入: %o", (input) => {
    expect(registerInput.safeParse(input).success).toBe(false);
  });
});

describe("注册路由", () => {
  it("将无效输入转换成稳定的 422 JSON，不调用注册服务", async () => {
    const response = await POST(
      new Request("http://localhost:5660/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alice",
          password: "short",
          nickname: "小艾",
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "INVALID_REGISTER_INPUT",
        message: "注册信息格式不正确。",
      },
    });
    expect(register).not.toHaveBeenCalled();
  });

  it("将应用层邀请门禁错误保持为 403 JSON", async () => {
    register.mockRejectedValueOnce(
      new ApplicationError(
        "REGISTRATION_INVITE_REQUIRED",
        "当前系统仅允许受邀用户注册。",
        403,
      ),
    );

    const response = await POST(
      new Request("http://localhost:5660/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "alice",
          password: "valid-password-123",
          nickname: "小艾",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "REGISTRATION_INVITE_REQUIRED",
        message: "当前系统仅允许受邀用户注册。",
      },
    });
  });
});
