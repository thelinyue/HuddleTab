import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  PUT: vi.fn(),
}));
const csrf = vi.hoisted(() => ({
  clearCsrfToken: vi.fn(),
  mutationHeaders: vi.fn().mockResolvedValue({ "X-CSRF-Token": "csrf-token" }),
}));

vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => csrf);

import { useChangePasswordMutation } from "./api";

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
  csrf.mutationHeaders.mockResolvedValue({ "X-CSRF-Token": "csrf-token" });
});

describe("useChangePasswordMutation", () => {
  it("使用 generated contract 修改密码并丢弃绑定旧 Session 的 CSRF token", async () => {
    client.PUT.mockResolvedValue({
      data: { data: { changed: true } },
      response: new Response(null, { status: 200 }),
    });
    const { result } = renderHook(() => useChangePasswordMutation(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({
        currentPassword: "old-password",
        newPassword: "new-password",
      })).resolves.toEqual({ changed: true });
    });

    expect(client.PUT).toHaveBeenCalledWith("/api/me/password", {
      body: {
        currentPassword: "old-password",
        newPassword: "new-password",
      },
      headers: { "X-CSRF-Token": "csrf-token" },
    });
    expect(csrf.clearCsrfToken).toHaveBeenCalledOnce();
  });

  it("修改失败时保留当前 CSRF token 并向页面返回服务端错误", async () => {
    client.PUT.mockResolvedValue({
      error: {
        error: {
          code: "INVALID_CREDENTIALS",
          details: {},
          fieldErrors: {},
          message: "当前密码错误",
          requestId: "request-1",
        },
      },
      response: new Response(null, { status: 401 }),
    });
    const { result } = renderHook(() => useChangePasswordMutation(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({
        currentPassword: "wrong-password",
        newPassword: "new-password",
      })).rejects.toThrow("当前密码错误");
    });

    expect(csrf.clearCsrfToken).not.toHaveBeenCalled();
  });
});
