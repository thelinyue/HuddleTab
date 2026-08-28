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

test("通知页按参考稿展示五项筛选、未读优先分组和真实通知摘要", async () => {
  vi.spyOn(Date, "now").mockReturnValue(
    new Date("2026-08-28T04:00:00.000Z").getTime(),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          items: [
            {
              id: "join-request-1",
              type: "JOIN_APPROVAL_REQUESTED",
              targetType: "ACTIVITY",
              targetId: "activity-1",
              activityId: "activity-1",
              payload: { requestId: "request-1", displayName: "小王" },
              readAt: null,
              createdAt: "2026-08-28T02:30:00.000Z",
            },
            {
              id: "settlement-1",
              type: "SETTLEMENT_RECEIVED",
              targetType: "SETTLEMENT",
              targetId: "settlement-1",
              activityId: "activity-1",
              payload: { amountMinor: "6800", currency: "CNY" },
              readAt: "2026-08-28T01:00:00.000Z",
              createdAt: "2026-08-28T00:45:00.000Z",
            },
            {
              id: "deleted-1",
              type: "PARTICIPATING_EXPENSE_DELETED",
              targetType: "ACTIVITY",
              targetId: "activity-1",
              activityId: "activity-1",
              payload: { title: "便利店购物" },
              readAt: "2026-08-27T11:00:00.000Z",
              createdAt: "2026-08-27T10:30:00.000Z",
            },
          ],
          unreadCount: 1,
        },
      }),
    }),
  );

  render(<NotificationsPage timeZone="Asia/Shanghai" />);

  expect(await screen.findByRole("heading", { name: "通知" })).toBeVisible();
  const filters = screen.getByRole("group", { name: "通知筛选" });
  expect(filters).toBeVisible();
  for (const label of ["全部", "未读", "邀请", "结算", "系统"]) {
    expect(screen.getByRole("button", { name: label })).toBeVisible();
  }
  expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent),
  ).toEqual(["未读", "今天", "昨天"]);
  expect(screen.getByText("10:30")).toBeVisible();
  expect(screen.getByText("¥68.00")).toBeVisible();
  expect(screen.queryAllByRole("img")).toHaveLength(0);
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

  render(<NotificationsPage timeZone="Asia/Shanghai" />);

  const notification = await screen.findByRole("link", {
    name: "活动状态已更新",
  });
  expect(notification).toHaveAttribute("href", "/activities/activity-1");
  expect(screen.getByLabelText("未读标记")).toBeVisible();

  notification.addEventListener("click", (event) => event.preventDefault());
  await userEvent.setup().click(notification);
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/notifications/notification-1/read",
    { method: "POST" },
  );
  expect(screen.queryByLabelText("未读标记")).not.toBeInTheDocument();
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

  render(<NotificationsPage timeZone="Asia/Shanghai" />);

  await screen.findByText("收到活动邀请");
  await userEvent.setup().click(screen.getByRole("button", { name: "邀请" }));

  expect(screen.getByText("收到活动邀请")).toBeVisible();
  expect(screen.queryByText("收到一笔结算")).not.toBeInTheDocument();
  expect(screen.queryByText("活动状态已更新")).not.toBeInTheDocument();

  await userEvent.setup().click(screen.getByRole("button", { name: "系统" }));
  const systemNotification = screen.getByText("活动状态已更新");
  expect(systemNotification.closest("a")).toBeNull();
  expect(
    systemNotification.closest("[data-notification-row]")?.querySelector("svg"),
  ).not.toBeNull();
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

  render(<NotificationsPage timeZone="Asia/Shanghai" />);

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
  expect(await screen.findAllByLabelText("未读标记")).toHaveLength(1);
  expect(unreadCounts).toContain(1);
  window.removeEventListener(
    NOTIFICATION_UNREAD_COUNT_EVENT,
    recordUnreadCount,
  );
});

test("管理员可以在加入申请通知中通过或拒绝成员", async () => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    if (input === "/api/notifications") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: "join-request-notification",
                type: "JOIN_APPROVAL_REQUESTED",
                targetType: "ACTIVITY",
                targetId: "activity-1",
                activityId: "activity-1",
                payload: {
                  requestId: "request-1",
                  displayName: "小王",
                },
                readAt: null,
                createdAt: "2026-08-26T00:00:00.000Z",
              },
            ],
            unreadCount: 1,
          },
        }),
      });
    }
    return Promise.resolve({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<NotificationsPage timeZone="Asia/Shanghai" />);

  expect(await screen.findByText("小王申请加入活动")).toBeVisible();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "通过小王的申请" }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/api/activities/activity-1/invitations/join-requests/request-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "APPROVE" }),
    },
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "已通过小王的加入申请。",
  );
});
