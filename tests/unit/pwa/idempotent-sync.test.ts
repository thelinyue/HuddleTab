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

  expect(await repository.syncFor("mutation-1", "expense-1")).toEqual({
    pendingCount: 1,
  });
  expect((await repository.get("attachment-1"))?.status).toBe("RETRYABLE");

  expect(await repository.syncFor("mutation-1", "expense-1", 1000)).toEqual({
    pendingCount: 0,
  });
  expect((await repository.get("attachment-1"))?.status).toBe("SYNCED");
  expect(upload).toHaveBeenCalledTimes(2);
});
