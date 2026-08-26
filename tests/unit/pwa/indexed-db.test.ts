import "fake-indexeddb/auto";

import { afterEach, expect, test } from "vitest";
import { deleteDB } from "idb";

import {
  openHuddleTabDb,
  recoverInterruptedSyncing,
} from "@/pwa/indexed-db/database";

afterEach(async () => {
  await Promise.all([deleteDB("huddletab:u1"), deleteDB("huddletab:u2")]);
});

test("不同登录用户使用隔离数据库，且只在显式恢复时重置遗留 SYNCING 任务", async () => {
  const first = await openHuddleTabDb("u1");
  await first.put("pending_mutations", {
    id: "m1",
    userId: "u1",
    activityId: "a1",
    kind: "CREATE_EXPENSE",
    payload: {} as never,
    status: "SYNCING",
    attemptCount: 1,
    nextAttemptAt: 0,
    createdAt: 1,
    updatedAt: 1,
  });
  await first.put("pending_attachments", {
    id: "attachment-1",
    userId: "u1",
    activityId: "a1",
    mutationId: "m1",
    clientAttachmentId: "client-attachment-1",
    fileName: "receipt.jpg",
    mimeType: "image/jpeg",
    blob: new Blob(["receipt"]),
    status: "SYNCING",
    attemptCount: 1,
    nextAttemptAt: 0,
    createdAt: 1,
    updatedAt: 1,
  });
  first.close();
  const reopened = await openHuddleTabDb("u1");
  const second = await openHuddleTabDb("u2");
  try {
    expect((await reopened.get("pending_mutations", "m1"))?.status).toBe(
      "SYNCING",
    );
    expect(
      (await reopened.get("pending_attachments", "attachment-1"))?.status,
    ).toBe("SYNCING");
    expect(second.objectStoreNames.contains("pending_mutations")).toBe(true);
  } finally {
    reopened.close();
    second.close();
  }
  await recoverInterruptedSyncing("u1");
  const recovered = await openHuddleTabDb("u1");
  try {
    expect((await recovered.get("pending_mutations", "m1"))?.status).toBe(
      "RETRYABLE",
    );
    expect(
      (await recovered.get("pending_attachments", "attachment-1"))?.status,
    ).toBe("RETRYABLE");
  } finally {
    recovered.close();
  }
});
