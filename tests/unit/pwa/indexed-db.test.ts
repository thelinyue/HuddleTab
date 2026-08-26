import "fake-indexeddb/auto";

import { afterEach, expect, test } from "vitest";
import { deleteDB } from "idb";

import { openHuddleTabDb } from "@/pwa/indexed-db/database";

afterEach(async () => {
  await Promise.all([deleteDB("huddletab:u1"), deleteDB("huddletab:u2")]);
});

test("不同登录用户使用隔离数据库，遗留 SYNCING 恢复为 RETRYABLE", async () => {
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
  first.close();
  const reopened = await openHuddleTabDb("u1");
  expect((await reopened.get("pending_mutations", "m1"))?.status).toBe(
    "RETRYABLE",
  );
  const second = await openHuddleTabDb("u2");
  expect(second.objectStoreNames.contains("pending_mutations")).toBe(true);
  reopened.close();
  second.close();
});
