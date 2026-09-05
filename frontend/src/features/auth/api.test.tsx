import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { deleteDB } from "idb";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  PUT: vi.fn(),
}));
const csrf = vi.hoisted(() => ({
  clearCsrfToken: vi.fn(),
  mutationHeaders: vi.fn().mockResolvedValue({ "X-CSRF-Token": "csrf-token" }),
}));

vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => csrf);

import { databaseName } from "../../pwa/indexed-db/database";
import { MutationRepository } from "../../pwa/indexed-db/mutation-repository";
import { pendingMutationFixture } from "../../pwa/indexed-db/test-fixtures";
import { queryKeys } from "../../api/query-keys";
import { ApiRequestError } from "../../api/error";
import {
  useChangePasswordMutation,
  useJoinInvitationMutation,
  useJoinRequestQuery,
  useLogoutMutation,
  useSessionQuery,
  useUpdateAvatarPresetMutation,
} from "./api";

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

afterEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  csrf.mutationHeaders.mockResolvedValue({ "X-CSRF-Token": "csrf-token" });
  await deleteDB(databaseName("user-1"));
});

describe("离线 Session 回退", () => {
  it("网络错误时只回退当前标签页最近身份", async () => {
    sessionStorage.setItem("huddletab:offline-session", JSON.stringify({
      displayName: "测试用户", userId: "user-1", username: "tester",
    }));
    client.GET.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useSessionQuery(), { wrapper });

    await waitFor(() => expect(result.current.data).toMatchObject({ userId: "user-1" }));
    expect(client.GET).toHaveBeenCalledWith("/api/auth/session");
  });

  it("openapi-fetch 将离线请求包装为 status=0 时仍回退当前标签页身份", async () => {
    sessionStorage.setItem("huddletab:offline-session", JSON.stringify({
      displayName: "测试用户", userId: "user-1", username: "tester",
    }));
    client.GET.mockRejectedValue(new ApiRequestError(0));
    const { result } = renderHook(() => useSessionQuery(), { wrapper });

    await waitFor(() => expect(result.current.data).toMatchObject({ userId: "user-1" }));
  });

  it("服务端 401 清除离线身份而不回退旧用户", async () => {
    sessionStorage.setItem("huddletab:offline-session", JSON.stringify({
      displayName: "测试用户", userId: "user-1", username: "tester",
    }));
    client.GET.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    const { result } = renderHook(() => useSessionQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(sessionStorage.getItem("huddletab:offline-session")).toBeNull();
  });
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

describe("useUpdateAvatarPresetMutation", () => {
  it("使用 generated contract 保存头像并携带 CSRF token", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    queryClient.setQueryData(queryKeys.session, {
      avatarPreset: 2,
      displayName: "测试用户",
      isSystemAdmin: false,
      userId: "user-1",
      username: "tester",
    });
    client.PATCH.mockResolvedValue({
      data: { data: { avatarPreset: 6 } },
      response: new Response(null, { status: 200 }),
    });
    const avatarWrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateAvatarPresetMutation(), { wrapper: avatarWrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(6)).resolves.toBe(6);
    });

    expect(client.PATCH).toHaveBeenCalledWith("/api/me/avatar", {
      body: { avatarPreset: 6 },
      headers: { "X-CSRF-Token": "csrf-token" },
    });
    expect(queryClient.getQueryData(queryKeys.session)).toMatchObject({ avatarPreset: 6 });
    expect(JSON.parse(sessionStorage.getItem("huddletab:offline-session") ?? "null"))
      .toMatchObject({ avatarPreset: 6, userId: "user-1" });
  });
});

describe("useLogoutMutation", () => {
  it("退出登录只清理内存认证状态并保留 pending queue", async () => {
    const repository = new MutationRepository("user-1");
    await repository.put(pendingMutationFixture("logout-pending"));
    client.POST.mockResolvedValue({
      data: { data: { loggedOut: true } },
      response: new Response(null, { status: 200 }),
    });
    const { result } = renderHook(() => useLogoutMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(await repository.get("logout-pending")).toBeDefined();
  });
});

describe("join approval applicant adapter", () => {
  it.each(["BOUND", "ALREADY_BOUND"])(
    "%s 绑定结果会刷新当前活动列表",
    async (status) => {
      client.POST.mockResolvedValue({
        data: {
          data: {
            activityId: "activity-1",
            memberId: "guest-1",
            requestId: null,
            revision: "4",
            status,
          },
        },
        response: new Response(null, { status: 200 }),
      });
      const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const localWrapper = ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      const { result } = renderHook(
        () => useJoinInvitationMutation("user-1", "invite-token"),
        { wrapper: localWrapper },
      );

      await act(async () => {
        await expect(result.current.mutateAsync()).resolves.toMatchObject({ status });
      });
      expect(invalidate).toHaveBeenCalledOnce();
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.activitiesCurrent("user-1"),
      });
    },
  );

  it("Pending join 返回申请结果且不刷新活动工作台", async () => {
    client.POST.mockResolvedValue({
      data: {
        data: {
          activityId: "activity-1",
          memberId: null,
          requestId: "request-1",
          revision: "3",
          status: "PENDING_APPROVAL",
        },
      },
      response: new Response(null, { status: 200 }),
    });
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const localWrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useJoinInvitationMutation("user-1", "invite-token"),
      { wrapper: localWrapper },
    );

    await act(async () => {
      await expect(result.current.mutateAsync()).resolves.toMatchObject({
        requestId: "request-1",
        status: "PENDING_APPROVAL",
      });
    });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("申请人状态查询使用 user-scoped key 与 generated GET", async () => {
    client.GET.mockResolvedValue({
      data: { data: { requestId: "request-1", status: "PENDING" } },
      response: new Response(null, { status: 200 }),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const localWrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useJoinRequestQuery("user-1", "request-1"),
      { wrapper: localWrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState(
      Reflect.get(queryKeys, "joinRequest")("user-1", "request-1"),
    )).toBeDefined();
    expect(client.GET).toHaveBeenCalledWith("/api/join-requests/{join_request_id}", {
      params: { path: { join_request_id: "request-1" } },
    });
    expect(result.current.data).toMatchObject({ requestId: "request-1", status: "PENDING" });
  });
});
