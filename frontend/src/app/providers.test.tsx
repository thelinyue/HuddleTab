import { useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { clearCsrfToken, csrfToken } from "../api/csrf";
import { queryKeys } from "../api/query-keys";
import { AppProviders } from "./providers";
import { ApplicationRouter } from "./router";

vi.mock("./pwa-update", () => ({ PwaUpdatePrompt: () => null }));
vi.mock("../features/activities/pages", async () => {
  const { Outlet } = await import("react-router-dom");
  return {
    ActivitiesPage: () => <h1>活动</h1>,
    ActivityWorkspace: () => <Outlet />,
    MePage: () => <h1>我的</h1>,
    NotificationsPage: () => <h1>通知</h1>,
  };
});

const session = {
  userId: "user-1",
  username: "tester",
  displayName: "测试用户",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function unauthorizedResponse(message = "当前登录已失效，请重新登录。"): Response {
  return jsonResponse({
    error: {
      code: "UNAUTHENTICATED",
      details: {},
      fieldErrors: {},
      message,
      requestId: "request-1",
    },
  }, 401);
}

let mountedQueryClient: ReturnType<typeof useQueryClient> | undefined;

function QueryClientCapture() {
  const queryClient = useQueryClient();
  const seeded = useRef(false);

  if (!seeded.current) {
    seeded.current = true;
    mountedQueryClient = queryClient;
    queryClient.setQueryData(queryKeys.session, session);
    queryClient.setQueryData(["protected-cache"], "cached");
  }
  return null;
}

afterEach(() => {
  cleanup();
  clearCsrfToken();
  mountedQueryClient = undefined;
  vi.restoreAllMocks();
});

describe("AppProviders 全局 401", () => {
  it("受保护请求失效后同步清理挂载 Session、其他缓存和 CSRF", async () => {
    render(
      <AppProviders>
        <MemoryRouter initialEntries={["/activities"]}>
          <QueryClientCapture />
          <ApplicationRouter />
        </MemoryRouter>
      </AppProviders>,
    );

    expect(await screen.findByRole("heading", { name: "活动" })).toBeInTheDocument();
    expect(mountedQueryClient?.getQueryData(queryKeys.session)).toEqual(session);
    expect(mountedQueryClient?.getQueryData(["protected-cache"])).toBe("cached");
    const firstCsrfRequest = vi.spyOn(apiClient, "GET").mockResolvedValue({
      data: { data: { token: "csrf-token-1" } },
      response: jsonResponse({ data: { token: "csrf-token-1" } }),
    });
    await csrfToken();
    expect(firstCsrfRequest).toHaveBeenCalledOnce();
    firstCsrfRequest.mockRestore();

    await act(async () => {
      await apiClient.GET("/api/activities", {
        baseUrl: "http://localhost",
        fetch: vi.fn().mockResolvedValue(unauthorizedResponse()),
      });
    });

    expect(await screen.findByRole("heading", { name: "登录伙记" })).toBeInTheDocument();
    expect(mountedQueryClient?.getQueryData(queryKeys.session)).toBeNull();
    expect(mountedQueryClient?.getQueryData(["protected-cache"])).toBeUndefined();
    const renewedCsrfRequest = vi.spyOn(apiClient, "GET").mockResolvedValue({
      data: { data: { token: "csrf-token-2" } },
      response: jsonResponse({ data: { token: "csrf-token-2" } }),
    });
    await csrfToken();
    expect(renewedCsrfRequest).toHaveBeenCalledOnce();
  });

  it("改密凭证 401 保留登录状态和用户已输入的表单", async () => {
    render(
      <AppProviders>
        <MemoryRouter initialEntries={["/me/password"]}>
          <QueryClientCapture />
          <ApplicationRouter />
        </MemoryRouter>
      </AppProviders>,
    );

    expect(await screen.findByRole("heading", { name: "修改密码" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "wrong-password" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password" } });

    await act(async () => {
      await apiClient.PUT("/api/me/password", {
        baseUrl: "http://localhost",
        body: { currentPassword: "wrong-password", newPassword: "new-password" },
        fetch: vi.fn().mockResolvedValue(unauthorizedResponse("当前密码错误")),
      });
    });

    expect(screen.getByRole("heading", { name: "修改密码" })).toBeInTheDocument();
    expect(mountedQueryClient?.getQueryData(queryKeys.session)).toEqual(session);
    expect(screen.getByLabelText("当前密码")).toHaveValue("wrong-password");
    expect(screen.getByLabelText("新密码")).toHaveValue("new-password");
  });
});
