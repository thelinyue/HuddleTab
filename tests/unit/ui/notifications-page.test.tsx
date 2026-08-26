// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import {
  notificationHref,
  NotificationsPage,
} from "@/features/notifications/components/notifications-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("通知页读取服务端 items 契约并展示未读通知", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              id: "notification-1",
              type: "ACTIVITY_STATUS_CHANGED",
              targetType: "ACTIVITY",
              targetId: "activity-1",
              activityId: "activity-1",
              payload: { status: "ENDED" },
              readAt: null,
              createdAt: "2026-08-26T00:00:00.000Z",
            },
          ],
          unreadCount: 1,
        },
      }),
    }),
  );

  render(<NotificationsPage />);

  const notification = await screen.findByRole("link", {
    name: "活动状态已更新",
  });
  expect(notification).toHaveAttribute("href", "/activities/activity-1");
  expect(screen.getByText("未读")).toBeVisible();

  notification.addEventListener("click", (event) => event.preventDefault());
  await userEvent.setup().click(notification);
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/notifications/notification-1/read",
    { method: "POST" },
  );
  expect(await screen.findByText("已读")).toBeVisible();
});

test("通知链接仅由受控目标类型和服务端资源 ID 构建", () => {
  const base = {
    id: "notification-1",
    type: "ACTIVITY_STATUS_CHANGED",
    targetId: "resource-1",
    activityId: "activity-1",
    payload: {},
    readAt: null,
    createdAt: "2026-08-26T00:00:00.000Z",
  };

  expect(notificationHref({ ...base, targetType: "ACTIVITY" })).toBe(
    "/activities/activity-1",
  );
  expect(notificationHref({ ...base, targetType: "EXPENSE" })).toBe(
    "/activities/activity-1/expenses/resource-1",
  );
  expect(notificationHref({ ...base, targetType: "SETTLEMENT" })).toBe(
    "/activities/activity-1/settlements",
  );
  expect(notificationHref({ ...base, targetType: "UNKNOWN" })).toBeNull();
});
