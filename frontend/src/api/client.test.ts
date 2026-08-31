import { describe, expect, it, vi } from "vitest";
import { apiClient, AUTH_EXPIRED_EVENT } from "./client";

function unauthorizedResponse(code: "INVALID_CREDENTIALS" | "UNAUTHENTICATED", message: string) {
  return new Response(JSON.stringify({
    error: {
      code,
      details: {},
      fieldErrors: {},
      message,
      requestId: "request-1",
    },
  }), {
    headers: { "Content-Type": "application/json" },
    status: 401,
  });
}

describe("apiClient 401 处理", () => {
  it("普通受保护接口返回 401 时广播登录过期", async () => {
    const fetch = vi.fn().mockResolvedValue(
      unauthorizedResponse("UNAUTHENTICATED", "当前登录已失效，请重新登录。"),
    );
    const listener = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, listener, { once: true });

    await apiClient.GET("/api/activities", { baseUrl: "http://localhost", fetch });

    expect(listener).toHaveBeenCalledOnce();
  });

  it("修改密码的凭证校验 401 不清空当前登录页面", async () => {
    const fetch = vi.fn().mockResolvedValue(
      unauthorizedResponse("INVALID_CREDENTIALS", "用户名或密码错误。"),
    );
    const listener = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, listener, { once: true });

    await apiClient.PUT("/api/me/password", {
      baseUrl: "http://localhost",
      body: { currentPassword: "wrong-password", newPassword: "new-password" },
      fetch,
    });

    expect(listener).not.toHaveBeenCalled();
  });
});
