// @vitest-environment node
import "fake-indexeddb/auto";

import { deleteDB } from "idb";
import { afterEach, expect, it } from "vitest";

import { AttachmentRepository } from "./attachment-repository";
import { databaseName } from "./database";
import type { PendingAttachment } from "./schema";

afterEach(() =>
  Promise.all([
    deleteDB(databaseName("user-1")),
    deleteDB(databaseName("user-2")),
  ]),
);

function attachment(
  id: string,
  overrides: Partial<PendingAttachment> = {},
): Omit<PendingAttachment, "userId"> {
  return {
    id,
    activityId: "activity-1",
    mutationId: "mutation-1",
    clientAttachmentId: `client-${id}`,
    fileName: `${id}.png`,
    mimeType: "image/png",
    blob: new Blob([id], { type: "image/png" }),
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

it("附件按 mutation 的 createdAt、id 排序且保持 Blob", async () => {
  const repository = new AttachmentRepository("user-1");
  await repository.put(attachment("b", { createdAt: 20 }));
  await repository.put(attachment("a", { createdAt: 20 }));

  const records = await repository.listByMutation("mutation-1");
  expect(records.map(({ id, blob }) => [id, blob.size])).toEqual([
    ["a", 1],
    ["b", 1],
  ]);
});

it("附件按 activity 过滤，另一用户数据库不可读取", async () => {
  const first = new AttachmentRepository("user-1");
  const second = new AttachmentRepository("user-2");
  await first.put(attachment("first"));
  await first.put(attachment("other", { activityId: "activity-2" }));

  expect((await first.listByActivity("activity-1")).map(({ id }) => id))
    .toEqual(["first"]);
  expect(await second.listByMutation("mutation-1")).toEqual([]);
});

it("只丢弃指定 mutation 下被拒绝的本地 Blob", async () => {
  const repository = new AttachmentRepository("user-1");
  await repository.put(attachment("pending"));
  await repository.put(attachment("rejected", { status: "REJECTED" }));
  await repository.put(attachment("other", {
    mutationId: "mutation-2",
    status: "REJECTED",
  }));

  await repository.removeRejectedForMutation("mutation-1");

  expect((await repository.listByMutation("mutation-1")).map(({ id }) => id))
    .toEqual(["pending"]);
  expect((await repository.listByMutation("mutation-2")).map(({ id }) => id))
    .toEqual(["other"]);
});
