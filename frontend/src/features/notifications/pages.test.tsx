import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  decide: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  markRead: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  notifications: { items: [] as Array<Record<string, unknown>>, unreadCount: 1, timeZone: "Asia/Shanghai" },
}));

vi.mock("../auth/api", () => ({
  useSessionQuery: () => ({
    data: { displayName: "Alice", userId: "user-1", username: "alice" },
    isPending: false,
  }),
}));
vi.mock("./api", () => ({
  useDecideNotificationJoinRequestMutation: () => state.decide,
  useMarkNotificationReadMutation: () => state.markRead,
  useNotificationsQuery: () => ({
    data: state.notifications,
    isPending: false,
  }),
}));

import { NotificationsPage } from "./pages";

function notification(overrides: Record<string, unknown> = {}) {
  return {
    activityId: "activity-safe",
    createdAt: "2026-09-01T10:00:00Z",
    kind: "JOIN_APPROVAL_REQUESTED",
    notificationId: "notification-1",
    payload: { displayName: "Bob", status: "APPROVED", url: "/untrusted" },
    readAt: null,
    targetId: "activity-safe",
    targetType: "ACTIVITY",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  state.markRead.error = null;
  state.markRead.isPending = false;
  state.markRead.mutateAsync.mockReset();
  state.decide.error = null;
  state.decide.isPending = false;
  state.decide.mutateAsync.mockReset();
  state.notifications.items = [notification()];
  state.notifications.unreadCount = 1;
});

describe("NotificationsPage", () => {
  it("通知链接只使用受控 activityId，不信任 payload URL", () => {
    state.notifications.items = [notification()];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    expect(screen.getByRole("link", { name: /Bob 申请加入活动/ })).toHaveAttribute(
      "href",
      "/activities/activity-safe?panel=members",
    );
    expect(screen.queryByRole("link", { name: /Bob 申请加入活动/ })).not.toHaveAttribute(
      "href",
      "/untrusted",
    );
  });

  it("已读失败保留未读外观并显示错误", async () => {
    state.notifications.items = [notification()];
    state.markRead.mutateAsync.mockRejectedValue(new Error("通知更新失败"));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    const row = screen.getByTestId("notification-notification-1");

    fireEvent.click(screen.getByRole("button", { name: "标记通知为已读" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("通知更新失败");
    expect(row).toHaveAttribute("data-unread", "true");
  });

  it("按邀请、结算和系统筛选，并为结算构造受控深链", () => {
    state.notifications.items = [
      notification(),
      notification({ kind: "SETTLEMENT_RECEIVED", notificationId: "notification-2", payload: { amountMinor: "1200", currency: "CNY" }, targetId: "settlement-1" }),
      notification({ kind: "ACTIVITY_STATUS_CHANGED", notificationId: "notification-3", payload: { activityName: "旅行", status: "ENDED" } }),
    ];
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "结算" }));
    expect(screen.getByRole("link", { name: /收到一笔结算/ })).toHaveAttribute("href", "/activities/activity-safe?tab=settlement");
    expect(screen.queryByText(/Bob 申请加入活动/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "系统" }));
    expect(screen.getByText("活动状态已更新")).toBeInTheDocument();
  });

  it("加入申请可在通知内通过，失败时仍保留操作", async () => {
    state.notifications.items = [notification({ payload: { displayName: "Bob", requestId: "request-1" } })];
    state.decide.mutateAsync.mockRejectedValue(new Error("审批失败"));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("审批失败");
    expect(state.decide.mutateAsync).toHaveBeenCalledWith({ activityId: "activity-safe", requestId: "request-1", decision: "APPROVE" });
    expect(screen.getByRole("button", { name: "通过" })).toBeInTheDocument();
  });

  it("全部已读逐条执行，部分失败只报告失败数量", async () => {
    state.notifications.items = [notification(), notification({ notificationId: "notification-2" })];
    state.notifications.unreadCount = 2;
    state.markRead.mutateAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("失败"));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: /全部已读/ }));
    await waitFor(() => expect(state.markRead.mutateAsync).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent("1 条通知未能标记为已读");
  });
});
