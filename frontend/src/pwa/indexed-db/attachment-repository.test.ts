// @vitest-environment node
import "fake-indexeddb/auto";

import { deleteDB } from "idb";
import { afterEach, expect, it } from "vitest";

import { AttachmentRepository } from "./attachment-repository";
import { databaseName, openHuddleTabDb } from "./database";
import type { PendingAttachment, StoredPendingAttachment } from "./schema";

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

async function putRawAttachment(record: unknown) {
  const database = await openHuddleTabDb("user-1");
  await database.put(
    "pending_attachments",
    { ...(record as object), userId: "user-1" } as StoredPendingAttachment,
  );
  database.close();
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

it("新写入统一保存为 ArrayBuffer 并保留附件元数据", async () => {
  const repository = new AttachmentRepository("user-1");
  const lastModified = 1_720_000_000_000;
  await repository.put(attachment("array-buffer-write", {
    fileName: "receipt.png",
    mimeType: "image/png",
    lastModified,
    blob: new File(["array-buffer-bytes"], "receipt.png", {
      type: "image/png",
      lastModified,
    }),
  }));

  const database = await openHuddleTabDb("user-1");
  const raw = await database.get("pending_attachments", "array-buffer-write");
  database.close();
  expect(raw?.blob).toBeInstanceOf(ArrayBuffer);
  expect(raw?.fileName).toBe("receipt.png");
  expect(raw?.mimeType).toBe("image/png");
  expect(raw?.lastModified).toBe(lastModified);
  expect(raw?.blob.byteLength).toBe("array-buffer-bytes".length);
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

it("旧 File/Blob 记录标记为无法恢复，不继续上传", async () => {
  await putRawAttachment({
    ...attachment("legacy-file"),
    blob: new File(["legacy-file-bytes"], "legacy-file.png", {
      type: "image/png",
    }),
  });
  await putRawAttachment({
    ...attachment("legacy-blob"),
    blob: new Blob(["legacy-blob-bytes"], { type: "image/webp" }),
  });

  const records = await new AttachmentRepository("user-1")
    .listByMutation("mutation-1");
  expect(records).toHaveLength(2);
  expect(records.every(({ status, blob, lastError }) =>
    status === "REJECTED" && blob.size === 0 &&
    lastError?.code === "LOCAL_ATTACHMENT_CORRUPTED"
  )).toBe(true);
});

it("读取当前 ArrayBuffer 记录并恢复字节长度与 MIME", async () => {
  const bytes = new TextEncoder().encode("current-array-buffer");
  await putRawAttachment({
    ...attachment("current-array-buffer"),
    mimeType: "image/png",
    lastModified: 1_710_000_000_000,
    blob: bytes.buffer,
  });

  const [record] = await new AttachmentRepository("user-1")
    .listByMutation("mutation-1");
  expect(record.mimeType).toBe("image/png");
  expect(record.lastModified).toBe(1_710_000_000_000);
  expect(record.blob.size).toBe(bytes.byteLength);
  expect(await record.blob.arrayBuffer()).toEqual(bytes.buffer);
});

it("单条损坏附件标记为 REJECTED 且不阻塞同一队列的其他记录", async () => {
  await putRawAttachment({
    ...attachment("broken", { status: "PENDING" }),
    blob: { invalid: true },
  });
  await putRawAttachment({
    ...attachment("healthy"),
    blob: new TextEncoder().encode("healthy").buffer,
  });

  const records = await new AttachmentRepository("user-1")
    .listByMutation("mutation-1");
  const broken = records.find(({ id }) => id === "broken");
  const healthy = records.find(({ id }) => id === "healthy");
  expect(broken).toMatchObject({
    status: "REJECTED",
    lastError: {
      code: "LOCAL_ATTACHMENT_CORRUPTED",
    },
  });
  expect(broken?.blob.size).toBe(0);
  expect(healthy).toMatchObject({ id: "healthy", status: "PENDING" });

  const database = await openHuddleTabDb("user-1");
  const persisted = await database.get("pending_attachments", "broken");
  database.close();
  expect(persisted?.status).toBe("REJECTED");
  expect(persisted?.lastError?.code).toBe("LOCAL_ATTACHMENT_CORRUPTED");
});
