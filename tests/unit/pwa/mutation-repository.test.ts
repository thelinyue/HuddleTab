import "fake-indexeddb/auto";

import { afterEach, expect, test } from "vitest";
import { deleteDB, openDB } from "idb";
import { MutationRepository } from "@/pwa/indexed-db/mutation-repository";
import type { HuddleTabDb } from "@/pwa/indexed-db/schema";

afterEach(async () => {
  await deleteDB("huddletab:u1");
});

test("只返回到期的待同步消费，并保留服务端拒绝原因", async () => {
  const repository = new MutationRepository("u1", () => 100);
  await repository.add({
    id: "ready",
    activityId: "a1",
    kind: "CREATE_EXPENSE",
    payload: {} as never,
  });
  await repository.add({
    id: "later",
    activityId: "a1",
    kind: "CREATE_EXPENSE",
    payload: {} as never,
    nextAttemptAt: 101,
  });

  expect((await repository.nextReady())?.id).toBe("ready");
  await repository.markRejected("ready", {
    code: "ACTIVITY_ENDED",
    message: "活动已经结束，这笔离线消费未同步。",
  });

  expect(await repository.nextReady()).toBeNull();
  expect(
    (await repository.listByActivity("a1")).find(({ id }) => id === "ready"),
  ).toMatchObject({
    id: "ready",
    status: "REJECTED",
    lastError: { code: "ACTIVITY_ENDED" },
  });
});

test("丢弃只删除本地 mutation 与附件，不请求服务端", async () => {
  const repository = new MutationRepository("u1", () => 0);
  await repository.add({
    id: "m1",
    activityId: "a1",
    kind: "CREATE_EXPENSE",
    payload: {} as never,
  });
  const db = await openDB<HuddleTabDb>("huddletab:u1");
  await db.add("pending_attachments", {
    id: "attachment-1",
    userId: "u1",
    activityId: "a1",
    mutationId: "m1",
    clientAttachmentId: "client-attachment-1",
    fileName: "receipt.jpg",
    mimeType: "image/jpeg",
    blob: new Blob(["receipt"]),
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: 0,
    createdAt: 0,
    updatedAt: 0,
  });
  db.close();

  await repository.discard("m1");

  expect(await repository.get("m1")).toBeUndefined();
  const reopened = await openDB<HuddleTabDb>("huddletab:u1");
  try {
    expect(
      await reopened.get("pending_attachments", "attachment-1"),
    ).toBeUndefined();
  } finally {
    reopened.close();
  }
});
