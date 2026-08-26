import { expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({ list: vi.fn(), markRead: vi.fn() }));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "alice" } }),
  sessionUserId: vi.fn().mockReturnValue("alice"),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/services/notification-service", () => ({
  NotificationService: class {
    list = mocks.list;
    markRead = mocks.markRead;
  },
}));

import { GET } from "@/app/api/notifications/route";
import { POST } from "@/app/api/notifications/[notificationId]/read/route";

it("通知列表只返回当前用户的条目和未读数", async () => {
  mocks.list.mockResolvedValueOnce({
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
  });

  const response = await GET(new Request("http://localhost/api/notifications"));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      items: [
        expect.objectContaining({
          id: "notification-1",
          activityId: "activity-1",
          readAt: null,
        }),
      ],
      unreadCount: 1,
    },
  });
  expect(mocks.list).toHaveBeenCalledWith("alice", 50);
});

it("不能将其他用户的通知标记为已读", async () => {
  mocks.markRead.mockRejectedValueOnce(
    new ApplicationError(
      "NOTIFICATION_NOT_FOUND",
      "通知不存在或你无权查看。",
      404,
    ),
  );

  const response = await POST(
    new Request("http://localhost/api/notifications/notification-1/read", {
      method: "POST",
    }),
    { params: Promise.resolve({ notificationId: "notification-1" }) },
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({
    error: { code: "NOTIFICATION_NOT_FOUND" },
  });
  expect(mocks.markRead).toHaveBeenCalledWith("alice", "notification-1");
});
