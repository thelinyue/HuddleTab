import "fake-indexeddb/auto";

import { afterEach, expect, test, vi } from "vitest";
import { deleteDB } from "idb";
import { AttachmentRepository } from "@/pwa/indexed-db/attachment-repository";
import { SyncCoordinator } from "@/pwa/sync-queue/sync-coordinator";

afterEach(async () => {
  await deleteDB("huddletab:u1");
});

test("幂等回放仍会标记已有账单并继续同步附件", async () => {
  const queue = {
    nextReady: vi
      .fn()
      .mockResolvedValueOnce({ id: "m1", activityId: "a1", payload: {} })
      .mockResolvedValue(null),
    markSyncing: vi.fn(),
    markRetryable: vi.fn(),
    markRejected: vi.fn(),
    markSynced: vi.fn(),
    setInfo: vi.fn(),
  };
  const upload = vi.fn().mockResolvedValue({ id: "server-attachment-1" });
  const attachments = new AttachmentRepository("u1", upload, () => 0);
  await attachments.add({
    id: "attachment-1",
    activityId: "a1",
    mutationId: "m1",
    clientAttachmentId: "client-attachment-1",
    fileName: "receipt.jpg",
    mimeType: "image/jpeg",
    blob: new Blob(["receipt"], { type: "image/jpeg" }),
  });
  const api = {
    createExpense: vi.fn().mockResolvedValue({
      idempotentReplay: true,
      expense: { id: "expense-1" },
    }),
  };

  await new SyncCoordinator(queue, api, () => 0, attachments).run();

  expect(queue.markSynced).toHaveBeenCalledWith("m1", "expense-1");
  expect(upload).toHaveBeenCalledWith(
    expect.objectContaining({ expenseId: "expense-1" }),
  );
  expect((await attachments.get("attachment-1"))?.status).toBe("SYNCED");
  expect(queue.markRetryable).not.toHaveBeenCalled();
});

test("附件上传失败只保留附件重试，账单不会重新进入队列", async () => {
  const upload = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce({ id: "server-attachment-1" });
  const repository = new AttachmentRepository("u1", upload, () => 0);
  await repository.add({
    id: "attachment-1",
    activityId: "a1",
    mutationId: "mutation-1",
    clientAttachmentId: "client-attachment-1",
    fileName: "receipt.jpg",
    mimeType: "image/jpeg",
    blob: new Blob(["receipt"], { type: "image/jpeg" }),
  });

  expect(await repository.syncFor("mutation-1", "expense-1")).toMatchObject({
    pendingCount: 1,
  });
  expect((await repository.get("attachment-1"))?.status).toBe("RETRYABLE");

  expect(
    await repository.syncFor("mutation-1", "expense-1", 1000),
  ).toMatchObject({
    pendingCount: 0,
  });
  expect((await repository.get("attachment-1"))?.status).toBe("SYNCED");
  expect(upload).toHaveBeenCalledTimes(2);
});

test("后续同步会重试已确认账单的待上传附件，而不重复创建账单", async () => {
  const queue = {
    nextReady: vi.fn().mockResolvedValue(null),
    markSyncing: vi.fn(),
    markRetryable: vi.fn(),
    markRejected: vi.fn(),
    markSynced: vi.fn(),
    setInfo: vi.fn(),
    listSyncedWithServerId: vi
      .fn()
      .mockResolvedValue([{ id: "mutation-1", serverExpenseId: "expense-1" }]),
  };
  const attachments = {
    syncFor: vi.fn().mockResolvedValue({ pendingCount: 0 }),
  };
  const api = { createExpense: vi.fn() };

  await new SyncCoordinator(queue, api, () => 1000, attachments).run();

  expect(api.createExpense).not.toHaveBeenCalled();
  expect(attachments.syncFor).toHaveBeenCalledWith("mutation-1", "expense-1");
});

test("手动重试会立即唤醒附件的退避窗口", async () => {
  const upload = vi
    .fn()
    .mockRejectedValueOnce({ kind: "network", message: "网络中断" })
    .mockResolvedValueOnce({ id: "server-attachment-1" });
  const repository = new AttachmentRepository("u1", upload, () => 0);
  await repository.add({
    id: "attachment-1",
    activityId: "a1",
    mutationId: "mutation-1",
    clientAttachmentId: "client-attachment-1",
    fileName: "receipt.jpg",
    mimeType: "image/jpeg",
    blob: new Blob(["receipt"], { type: "image/jpeg" }),
  });
  await repository.syncFor("mutation-1", "expense-1", 0);

  await repository.retryNow(0);
  await repository.syncFor("mutation-1", "expense-1", 0);

  expect(upload).toHaveBeenCalledTimes(2);
  expect((await repository.get("attachment-1"))?.status).toBe("SYNCED");
});

test("服务端拒绝的附件可以从已确认账单的本地队列移除", async () => {
  const repository = new AttachmentRepository(
    "u1",
    vi.fn().mockRejectedValue({ status: 422, message: "图片格式不支持" }),
    () => 0,
  );
  await repository.add({
    id: "attachment-1",
    activityId: "a1",
    mutationId: "mutation-1",
    clientAttachmentId: "client-attachment-1",
    fileName: "receipt.svg",
    mimeType: "image/svg+xml",
    blob: new Blob(["image"], { type: "image/svg+xml" }),
  });
  await repository.syncFor("mutation-1", "expense-1", 0);

  await expect(
    repository.removeRejectedForMutation("mutation-1"),
  ).resolves.toBe(1);
  await expect(repository.get("attachment-1")).resolves.toBeUndefined();
});
