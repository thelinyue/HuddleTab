// @vitest-environment node
import "fake-indexeddb/auto";

import { deleteDB } from "idb";
import { afterEach, expect, it } from "vitest";

import { databaseName } from "./database";
import { MutationRepository } from "./mutation-repository";
import { AttachmentRepository } from "./attachment-repository";
import { pendingMutationFixture } from "./test-fixtures";

afterEach(() =>
  Promise.all([
    deleteDB(databaseName("user-1")),
    deleteDB(databaseName("user-2")),
  ]),
);

it("repository 注入当前 userId 并完整保存 Expense Create 输入", async () => {
  const repository = new MutationRepository("user-1");
  const input = pendingMutationFixture("mutation-1");

  const saved = await repository.put(input);

  expect(saved).toEqual({ ...input, userId: "user-1" });
  expect(await repository.get("mutation-1")).toEqual(saved);
});

it("不同 userId 的 queue 不可互读", async () => {
  const first = new MutationRepository("user-1");
  const second = new MutationRepository("user-2");
  await first.put(pendingMutationFixture("same-id"));

  expect(await second.get("same-id")).toBeUndefined();
});

it("按 activityId 隔离并使用 createdAt、id 提供确定顺序", async () => {
  const repository = new MutationRepository("user-1");
  await repository.put(
    pendingMutationFixture("b", { createdAt: 20 }),
  );
  await repository.put(
    pendingMutationFixture("c", {
      activityId: "activity-2",
      createdAt: 1,
    }),
  );
  await repository.put(
    pendingMutationFixture("a", { createdAt: 20 }),
  );

  expect(
    (await repository.listByActivity("activity-1")).map(({ id }) => id),
  ).toEqual(["a", "b"]);
});

it("全队列跨 activity 仍按 createdAt、id 提供确定顺序", async () => {
  const repository = new MutationRepository("user-1");
  await repository.put(
    pendingMutationFixture("b", { activityId: "activity-2", createdAt: 20 }),
  );
  await repository.put(
    pendingMutationFixture("c", { status: "REJECTED", createdAt: 30 }),
  );
  await repository.put(pendingMutationFixture("a", { createdAt: 20 }));

  expect((await repository.listAll()).map(({ id, status }) => [id, status]))
    .toEqual([
      ["a", "PENDING"],
      ["b", "PENDING"],
      ["c", "REJECTED"],
    ]);
});

it("Expense 与附件 Blob 在同一事务原子入队", async () => {
  const mutations = new MutationRepository("user-1");
  const attachments = new AttachmentRepository("user-1");
  const mutation = pendingMutationFixture("mutation-with-files");

  const result = await mutations.enqueueWithAttachments(mutation, [
    {
      id: "attachment-1",
      clientAttachmentId: "client-1",
      fileName: "one.png",
      mimeType: "image/png",
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    },
    {
      id: "attachment-2",
      clientAttachmentId: "client-2",
      fileName: "two.webp",
      mimeType: "image/webp",
      blob: new Blob([new Uint8Array([4, 5])], { type: "image/webp" }),
    },
  ]);

  expect(result.attachments.map(({ mutationId, mimeType, blob }) =>
    [mutationId, mimeType, blob.size])).toEqual([
    [mutation.id, "image/png", 3],
    [mutation.id, "image/webp", 2],
  ]);
  expect(await mutations.get(mutation.id)).toEqual(result.mutation);
  expect((await attachments.listByMutation(mutation.id)).map(({ id }) => id))
    .toEqual(["attachment-1", "attachment-2"]);
});

it("附件写入失败会回滚同事务中的 Expense mutation", async () => {
  const mutations = new MutationRepository("user-1");
  const attachments = new AttachmentRepository("user-1");
  const mutation = pendingMutationFixture("atomic-rollback");
  const duplicate = {
    id: "duplicate",
    clientAttachmentId: "client-duplicate",
    fileName: "receipt.png",
    mimeType: "image/png",
    blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
  };

  await expect(
    mutations.enqueueWithAttachments(mutation, [duplicate, duplicate]),
  ).rejects.toThrow("无法访问此设备上的伙记本地数据。");
  expect(await mutations.get(mutation.id)).toBeUndefined();
  expect(await attachments.listByMutation(mutation.id)).toEqual([]);
});

it("REJECTED mutation 可在同一事务中替换完整输入并重置附件状态", async () => {
  const mutations = new MutationRepository("user-1");
  const attachments = new AttachmentRepository("user-1");
  const mutation = pendingMutationFixture("rejected-edit", {
    status: "REJECTED",
    attemptCount: 3,
    lastError: { code: "INVALID_EXPENSE", message: "付款金额不正确。" },
    serverExpenseId: undefined,
  });
  await mutations.enqueueWithAttachments(mutation, [{
    id: "old-attachment",
    clientAttachmentId: "old-client",
    fileName: "old.png",
    mimeType: "image/png",
    blob: new Blob(["old"], { type: "image/png" }),
  }]);
  await mutations.put({
    ...mutation,
    status: "REJECTED",
    attemptCount: 3,
    lastError: { code: "INVALID_EXPENSE", message: "付款金额不正确。" },
  });

  const payload = { ...mutation.payload, title: "修正后的午餐" };
  const result = await mutations.reviseRejected("rejected-edit", payload, [{
    id: "new-attachment",
    clientAttachmentId: "new-client",
    fileName: "new.webp",
    mimeType: "image/webp",
    blob: new Blob(["new"], { type: "image/webp" }),
  }], 900);

  expect(result.mutation).toMatchObject({
    id: "rejected-edit",
    payload,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: 900,
    lastError: undefined,
    serverExpenseId: undefined,
  });
  expect(result.mutation.createdAt).toBe(mutation.createdAt);
  expect(await mutations.get("rejected-edit")).toEqual(result.mutation);
  expect(await attachments.listByMutation("rejected-edit")).toMatchObject([
    { id: "new-attachment", clientAttachmentId: "new-client", status: "PENDING", attemptCount: 0 },
  ]);
});

it("只有 REJECTED mutation 可以修正，且丢弃会原子删除附件", async () => {
  const mutations = new MutationRepository("user-1");
  const attachments = new AttachmentRepository("user-1");
  await mutations.enqueueWithAttachments(
    pendingMutationFixture("discard-me", { status: "REJECTED" }),
    [{
      id: "discard-attachment",
      clientAttachmentId: "discard-client",
      fileName: "discard.png",
      mimeType: "image/png",
      blob: new Blob(["discard"], { type: "image/png" }),
    }],
  );
  await expect(mutations.reviseRejected(
    "discard-me",
    pendingMutationFixture("other").payload,
    [],
    1,
  )).resolves.toBeDefined();
  await expect(mutations.reviseRejected(
    "discard-me",
    pendingMutationFixture("other").payload,
    [],
    1,
  )).rejects.toThrow("只有被服务器拒绝的本地账单可以修改。");
  await mutations.discard("discard-me");
  expect(await mutations.get("discard-me")).toBeUndefined();
  expect(await attachments.listByMutation("discard-me")).toEqual([]);
});
