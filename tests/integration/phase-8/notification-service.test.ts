import { afterAll, beforeAll, expect, it } from "vitest";

import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { NotificationService } from "@/server/services/notification-service";

let harness: PostgresHarness;
let service: NotificationService;

beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser("alice", "alice@example.com");
  await harness.seedCredentialUser("bob", "bob@example.com");
  service = new NotificationService(harness.sql);
});

afterAll(async () => {
  await harness?.stop();
});

it("通知写入与业务事务一起回滚", async () => {
  await expect(
    harness.sql.begin(async (transaction) => {
      await service.create(transaction, {
        recipientUserId: "alice",
        type: "ACTIVITY_STATUS_CHANGED",
        targetType: "ACTIVITY",
        targetId: "activity-1",
        payload: { status: "ENDED" },
      });
      throw new Error("模拟事务失败");
    }),
  ).rejects.toThrow("模拟事务失败");

  expect((await service.list("alice")).items).toHaveLength(0);
});

it("不能将其他用户的通知标记为已读", async () => {
  const notification = await harness.sql.begin((transaction) =>
    service.create(transaction, {
      recipientUserId: "alice",
      type: "ACTIVITY_STATUS_CHANGED",
      targetType: "ACTIVITY",
      targetId: "activity-1",
      payload: { status: "ENDED" },
    }),
  );

  await expect(service.markRead("bob", notification.id)).rejects.toMatchObject({
    code: "NOTIFICATION_NOT_FOUND",
    status: 404,
  });
  expect((await service.list("alice")).unreadCount).toBe(1);
});

it("通知接收者可以标记自己的通知为已读", async () => {
  const notification = await harness.sql.begin((transaction) =>
    service.create(transaction, {
      recipientUserId: "alice",
      type: "ACTIVITY_STATUS_CHANGED",
      targetType: "ACTIVITY",
      targetId: "activity-2",
      payload: { status: "ENDED" },
    }),
  );

  await service.markRead("alice", notification.id);

  const listed = await service.list("alice");
  expect(listed.unreadCount).toBe(1);
  expect(
    listed.items.find((item) => item.id === notification.id)?.readAt,
  ).toEqual(expect.any(String));
});
