// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import {
  notificationHref,
  NotificationsPage,
} from "@/features/notifications/components/notifications-page";
import { NOTIFICATION_UNREAD_COUNT_EVENT } from "@/lib/notification-unread-count";

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

test("通知按现有业务类型在本地筛选，且没有受控目标时不生成链接", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              id: "invite-1",
              type: "ACTIVITY_INVITATION",
              targetType: "ACTIVITY",
              targetId: "activity-1",
              activityId: "activity-1",
              payload: {},
              readAt: null,
              createdAt: "2026-08-26T00:00:00.000Z",
            },
            {
              id: "settlement-1",
              type: "SETTLEMENT_RECEIVED",
              targetType: "SETTLEMENT",
              targetId: "settlement-1",
              activityId: "activity-1",
              payload: {},
              readAt: null,
              createdAt: "2026-08-25T00:00:00.000Z",
            },
            {
              id: "system-1",
              type: "ACTIVITY_STATUS_CHANGED",
              targetType: "UNKNOWN",
              targetId: "untrusted-id",
              activityId: "activity-1",
              payload: {},
              readAt: null,
              createdAt: "2026-08-24T00:00:00.000Z",
            },
          ],
          unreadCount: 3,
        },
      }),
    }),
  );

  render(<NotificationsPage />);

  await screen.findByText("收到活动邀请");
  await userEvent.setup().click(screen.getByRole("button", { name: "邀请" }));

  expect(screen.getByText("收到活动邀请")).toBeVisible();
  expect(screen.queryByText("收到一笔结算")).not.toBeInTheDocument();
  expect(screen.queryByText("活动状态已更新")).not.toBeInTheDocument();

  await userEvent.setup().click(screen.getByRole("button", { name: "系统" }));
  const systemNotification = screen.getByText("活动状态已更新");
  expect(systemNotification.closest("a")).toBeNull();
  expect(systemNotification.parentElement?.querySelector("svg")).not.toBeNull();
});

test("全部已读仅提交未读通知，并保留请求失败的未读状态", async () => {
  const unreadCounts: number[] = [];
  const recordUnreadCount = (event: Event) => {
    unreadCounts.push((event as CustomEvent<number>).detail);
  };
  window.addEventListener(NOTIFICATION_UNREAD_COUNT_EVENT, recordUnreadCount);
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    if (input === "/api/notifications") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: "unread-success",
                type: "ACTIVITY_INVITATION",
                targetType: "ACTIVITY",
                targetId: "activity-1",
                activityId: "activity-1",
                payload: {},
                readAt: null,
                createdAt: "2026-08-26T00:00:00.000Z",
              },
              {
                id: "unread-failed",
                type: "SETTLEMENT_RECEIVED",
                targetType: "SETTLEMENT",
                targetId: "settlement-1",
                activityId: "activity-1",
                payload: {},
                readAt: null,
                createdAt: "2026-08-25T00:00:00.000Z",
              },
              {
                id: "already-read",
                type: "ACTIVITY_STATUS_CHANGED",
                targetType: "ACTIVITY",
                targetId: "activity-1",
                activityId: "activity-1",
                payload: {},
                readAt: "2026-08-24T00:00:00.000Z",
                createdAt: "2026-08-24T00:00:00.000Z",
              },
            ],
            unreadCount: 2,
          },
        }),
      });
    }
    return Promise.resolve({
      ok: input !== "/api/notifications/unread-failed/read",
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<NotificationsPage />);

  await screen.findByText("收到活动邀请");
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "全部已读" }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/notifications/unread-success/read",
    { method: "POST" },
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/notifications/unread-failed/read",
    { method: "POST" },
  );
  expect(fetchMock).not.toHaveBeenCalledWith(
    "/api/notifications/already-read/read",
    { method: "POST" },
  );
  expect(await screen.findAllByText("未读")).toHaveLength(1);
  expect(unreadCounts).toContain(1);
  window.removeEventListener(NOTIFICATION_UNREAD_COUNT_EVENT, recordUnreadCount);
});
