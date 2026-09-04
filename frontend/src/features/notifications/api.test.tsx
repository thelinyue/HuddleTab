import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
const csrf = vi.hoisted(() => ({
  mutationHeaders: vi.fn().mockResolvedValue({ "X-CSRF-Token": "csrf-token" }),
}));

vi.mock("../../api/client", () => ({ apiClient: client }));
vi.mock("../../api/csrf", () => csrf);

import { queryKeys } from "../../api/query-keys";
import { useDecideNotificationJoinRequestMutation, useMarkNotificationReadMutation, useNotificationsQuery } from "./api";

const unread = {
  activityId: "activity-1",
  createdAt: "2026-09-01T10:00:00Z",
  kind: "JOIN_APPROVAL_RESOLVED",
  notificationId: "notification-1",
  payload: { requestId: "request-1", status: "APPROVED" },
  readAt: null,
  targetId: "activity-1",
  targetType: "ACTIVITY",
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => {
  vi.clearAllMocks();
  csrf.mutationHeaders.mockResolvedValue({ "X-CSRF-Token": "csrf-token" });
});

describe("notification adapter", () => {
  it("列表使用当前用户 key 与 generated GET", async () => {
    client.GET.mockResolvedValue({
      data: { data: { items: [unread], timeZone: "Asia/Shanghai", unreadCount: 1 } },
      response: new Response(null, { status: 200 }),
    });
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useNotificationsQuery("user-1"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(Reflect.get(queryKeys, "notifications")("user-1")))
      .toEqual({ items: [unread], timeZone: "Asia/Shanghai", unreadCount: 1 });
    expect(client.GET).toHaveBeenCalledWith("/api/notifications");
  });

  it("mark-read 只更新当前用户的通知缓存", async () => {
    const read = { ...unread, readAt: "2026-09-01T10:01:00Z" };
    client.POST.mockResolvedValue({
      data: { data: read },
      response: new Response(null, { status: 200 }),
    });
    const { queryClient, wrapper } = setup();
    const other = { items: [unread], timeZone: "Asia/Shanghai", unreadCount: 1 };
    queryClient.setQueryData(Reflect.get(queryKeys, "notifications")("user-1"), other);
    queryClient.setQueryData(Reflect.get(queryKeys, "notifications")("user-2"), other);
    const { result } = renderHook(() => useMarkNotificationReadMutation("user-1"), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync("notification-1");
    });

    expect(client.POST).toHaveBeenCalledWith(
      "/api/notifications/{notification_id}/read",
      {
        params: {
          header: { "x-csrf-token": "csrf-token" },
          path: { notification_id: "notification-1" },
        },
      },
    );
    expect(queryClient.getQueryData(Reflect.get(queryKeys, "notifications")("user-1")))
      .toEqual({ items: [read], timeZone: "Asia/Shanghai", unreadCount: 0 });
    expect(queryClient.getQueryData(Reflect.get(queryKeys, "notifications")("user-2")))
      .toEqual(other);
  });

  it("内联审批提交受控路径并刷新通知和活动读模型", async () => {
    client.POST.mockResolvedValue({
      data: { data: { requestId: "request-1", status: "APPROVED" } },
      response: new Response(null, { status: 200 }),
    });
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDecideNotificationJoinRequestMutation("user-1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ activityId: "activity-1", requestId: "request-1", decision: "APPROVE" });
    });

    expect(client.POST).toHaveBeenCalledWith(
      "/api/activities/{activity_id}/join-requests/{join_request_id}",
      {
        body: { decision: "APPROVE" },
        params: {
          header: { "x-csrf-token": "csrf-token" },
          path: { activity_id: "activity-1", join_request_id: "request-1" },
        },
      },
    );
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual([
      queryKeys.notifications("user-1"),
      queryKeys.members("user-1", "activity-1"),
      queryKeys.activityDetail("user-1", "activity-1"),
      queryKeys.activitySnapshot("user-1", "activity-1"),
      queryKeys.joinRequests("user-1", "activity-1"),
    ]);
  });
});
