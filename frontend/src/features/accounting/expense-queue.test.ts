import "fake-indexeddb/auto";

import { deleteDB } from "idb";
import { afterEach, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../api/error";
import { databaseName } from "../../pwa/indexed-db/database";
import { AttachmentRepository } from "../../pwa/indexed-db/attachment-repository";
import { MutationRepository } from "../../pwa/indexed-db/mutation-repository";
import { expensePayload } from "../../pwa/indexed-db/test-fixtures";
import { ExpenseQueue } from "./expense-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await deleteDB(databaseName("user-1"));
});

it("按持久化顺序串行同步 Expense Create", async () => {
  const first = deferred<{ expenseId: string }>();
  const second = deferred<{ expenseId: string }>();
  const send = vi.fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const queue = new ExpenseQueue("user-1", { send, now: () => 100 });
  await queue.enqueue("activity-1", {
    ...expensePayload,
    clientMutationId: "mutation-1",
  });
  await queue.enqueue("activity-2", {
    ...expensePayload,
    clientMutationId: "mutation-2",
  });

  const flushing = queue.flush();
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send).toHaveBeenNthCalledWith(
    1,
    "activity-1",
    expect.objectContaining({ clientMutationId: "mutation-1" }),
  );

  first.resolve({ expenseId: "expense-1" });
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send).toHaveBeenNthCalledWith(
    2,
    "activity-2",
    expect.objectContaining({ clientMutationId: "mutation-2" }),
  );
  second.resolve({ expenseId: "expense-2" });
  await flushing;

  const repository = new MutationRepository("user-1");
  expect(await repository.get("mutation-1")).toMatchObject({
    status: "SYNCED",
    serverExpenseId: "expense-1",
  });
  expect(await repository.get("mutation-2")).toMatchObject({
    status: "SYNCED",
    serverExpenseId: "expense-2",
  });
});

it("响应丢失后使用相同 clientMutationId 重放并接受幂等结果", async () => {
  const send = vi.fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce({ expenseId: "expense-replayed" });
  const sleep = vi.fn().mockResolvedValue(undefined);
  const queue = new ExpenseQueue("user-1", {
    send,
    sleep,
    now: () => 200,
  });
  const payload = {
    ...expensePayload,
    clientMutationId: "mutation-response-loss",
  };
  await queue.enqueue("activity-1", payload);

  await queue.flush();

  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
  expect(send.mock.calls[1]).toEqual(["activity-1", payload]);
  expect(sleep).toHaveBeenCalledWith(1_000);
  expect(await new MutationRepository("user-1").get(payload.clientMutationId))
    .toMatchObject({
      attemptCount: 2,
      status: "SYNCED",
      serverExpenseId: "expense-replayed",
    });
});

it("持续 5xx 每次前台 flush 最多尝试三次并保留完整输入", async () => {
  const send = vi.fn().mockRejectedValue(new ApiRequestError(503));
  const sleep = vi.fn().mockResolvedValue(undefined);
  const queue = new ExpenseQueue("user-1", {
    send,
    sleep,
    now: () => 300,
  });
  const payload = {
    ...expensePayload,
    clientMutationId: "mutation-retry-limit",
  };
  await queue.enqueue("activity-1", payload);

  await queue.flush();

  expect(send).toHaveBeenCalledTimes(3);
  expect(sleep.mock.calls).toEqual([[1_000], [5_000]]);
  expect(await new MutationRepository("user-1").get(payload.clientMutationId))
    .toMatchObject({
      attemptCount: 3,
      payload,
      status: "RETRYABLE",
    });
});

it("业务 4xx 立即 REJECTED 并保留原始输入", async () => {
  const rejection = new ApiRequestError(422, {
    error: {
      code: "INVALID_EXPENSE",
      details: {},
      fieldErrors: {},
      message: "付款金额不正确。",
      requestId: "request-1",
    },
  });
  const send = vi.fn().mockRejectedValue(rejection);
  const sleep = vi.fn().mockResolvedValue(undefined);
  const queue = new ExpenseQueue("user-1", {
    send,
    sleep,
    now: () => 400,
  });
  const payload = {
    ...expensePayload,
    clientMutationId: "mutation-rejected",
  };
  await queue.enqueue("activity-1", payload);

  await queue.flush();

  expect(send).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
  expect(await new MutationRepository("user-1").get(payload.clientMutationId))
    .toMatchObject({
      attemptCount: 1,
      lastError: {
        code: "INVALID_EXPENSE",
        message: "付款金额不正确。",
      },
      payload,
      status: "REJECTED",
    });
});

it("退避期间 Session 切换后不使用新用户身份重放旧队列", async () => {
  let currentUser = true;
  const send = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  const queue = new ExpenseQueue("user-1", {
    canSend: () => currentUser,
    send,
    sleep: async () => {
      currentUser = false;
    },
    now: () => 500,
  });
  await queue.enqueue("activity-1", {
    ...expensePayload,
    clientMutationId: "mutation-session-switch",
  });

  await queue.flush();

  expect(send).toHaveBeenCalledTimes(1);
  expect(await new MutationRepository("user-1").get("mutation-session-switch"))
    .toMatchObject({ status: "RETRYABLE", attemptCount: 1 });
});

it("Expense 先同步成功，附件网络失败只重试附件", async () => {
  const send = vi.fn().mockResolvedValue({ expenseId: "expense-1" });
  const sendAttachment = vi.fn().mockRejectedValue(
    new TypeError("Failed to fetch"),
  );
  const queue = new ExpenseQueue("user-1", {
    send,
    sendAttachment,
    sleep: vi.fn().mockResolvedValue(undefined),
    now: () => 600,
  });
  const file = new File([new Uint8Array([1])], "receipt.png", {
    type: "image/png",
  });
  await queue.enqueue("activity-1", {
    ...expensePayload,
    clientMutationId: "mutation-with-attachment",
  }, [file]);

  await queue.flush();

  expect(send).toHaveBeenCalledTimes(1);
  expect(await new MutationRepository("user-1").get(
    "mutation-with-attachment",
  )).toMatchObject({ status: "SYNCED", serverExpenseId: "expense-1" });
  expect((await new AttachmentRepository("user-1").listByMutation(
    "mutation-with-attachment",
  ))[0]).toMatchObject({ status: "RETRYABLE", attemptCount: 3 });

  sendAttachment.mockResolvedValue({ id: "server-attachment-1" });
  await queue.flush();

  expect(send).toHaveBeenCalledTimes(1);
  expect(sendAttachment).toHaveBeenCalledTimes(4);
  expect((await new AttachmentRepository("user-1").listByMutation(
    "mutation-with-attachment",
  ))[0]).toMatchObject({
    status: "SYNCED",
    serverAttachmentId: "server-attachment-1",
  });
});

it("附件业务 4xx 保留 Blob 并显示明确拒绝状态", async () => {
  const sendAttachment = vi.fn().mockRejectedValue(
    new ApiRequestError(422),
  );
  const queue = new ExpenseQueue("user-1", {
    send: vi.fn().mockResolvedValue({ expenseId: "expense-2" }),
    sendAttachment,
    now: () => 700,
  });
  await queue.enqueue("activity-1", {
    ...expensePayload,
    clientMutationId: "mutation-rejected-attachment",
  }, [new File(["image"], "receipt.webp", { type: "image/webp" })]);

  await queue.flush();

  const [attachment] = await new AttachmentRepository("user-1")
    .listByMutation("mutation-rejected-attachment");
  expect(attachment).toMatchObject({
    status: "REJECTED",
    lastError: { message: "附件被服务器拒绝。" },
  });
  expect(attachment.blob).toBeDefined();
  expect(sendAttachment).toHaveBeenCalledTimes(1);
});

it("两个附件按本地创建顺序串行上传", async () => {
  const first = deferred<{ id: string }>();
  const second = deferred<{ id: string }>();
  const sendAttachment = vi.fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const queue = new ExpenseQueue("user-1", {
    send: vi.fn().mockResolvedValue({ expenseId: "expense-3" }),
    sendAttachment,
    now: () => 800,
  });
  await queue.enqueue("activity-1", {
    ...expensePayload,
    clientMutationId: "mutation-two-attachments",
  }, [
    new File(["a"], "a.png", { type: "image/png" }),
    new File(["b"], "b.png", { type: "image/png" }),
  ]);

  const flushing = queue.flush();
  await vi.waitFor(() => expect(sendAttachment).toHaveBeenCalledTimes(1));
  first.resolve({ id: "server-a" });
  await vi.waitFor(() => expect(sendAttachment).toHaveBeenCalledTimes(2));
  second.resolve({ id: "server-b" });
  await flushing;

  const attachments = await new AttachmentRepository("user-1")
    .listByMutation("mutation-two-attachments");
  expect(attachments.map(({ status, serverAttachmentId }) => [
    status,
    serverAttachmentId,
  ])).toEqual([
    ["SYNCED", "server-a"],
    ["SYNCED", "server-b"],
  ]);
});
