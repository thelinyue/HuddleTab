import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  markRead: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
}));

vi.mock("../auth/api", () => ({
  useSessionQuery: () => ({
    data: { displayName: "Alice", userId: "user-1", username: "alice" },
    isPending: false,
  }),
}));
vi.mock("./api", () => ({
  useMarkNotificationReadMutation: () => state.markRead,
  useNotificationsQuery: () => ({
    data: {
      items: [{
        activityId: "activity-safe",
        createdAt: "2026-09-01T10:00:00Z",
        kind: "JOIN_APPROVAL_REQUESTED",
        notificationId: "notification-1",
        payload: { displayName: "Bob", url: "/untrusted" },
        readAt: null,
        targetId: "activity-safe",
        targetType: "ACTIVITY",
      }],
      unreadCount: 1,
    },
    isPending: false,
  }),
}));

import { NotificationsPage } from "./pages";

afterEach(() => {
  cleanup();
  state.markRead.error = null;
  state.markRead.isPending = false;
  state.markRead.mutateAsync.mockReset();
});

describe("NotificationsPage", () => {
  it("通知链接只使用受控 activityId，不信任 payload URL", () => {
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
    state.markRead.mutateAsync.mockRejectedValue(new Error("通知更新失败"));
    render(<MemoryRouter><NotificationsPage /></MemoryRouter>);
    const row = screen.getByTestId("notification-notification-1");

    fireEvent.click(screen.getByRole("button", { name: "标记通知为已读" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("通知更新失败");
    expect(row).toHaveAttribute("data-unread", "true");
  });
});
