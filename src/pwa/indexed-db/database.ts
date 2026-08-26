import { openDB } from "idb";
import type { HuddleTabDb } from "@/pwa/indexed-db/schema";

/** 数据库名包含服务器 User ID，退出或换号时不可能读取到另一账号的离线快照和队列。 */
export async function openHuddleTabDb(userId: string) {
  const db = await openDB<HuddleTabDb>(`huddletab:${userId}`, 1, {
    upgrade(database) {
      database.createObjectStore("activity_snapshots", {
        keyPath: "activityId",
      });
      database.createObjectStore("activity_preferences", { keyPath: "key" });
      const mutations = database.createObjectStore("pending_mutations", {
        keyPath: "id",
      });
      mutations.createIndex("by-status-next", ["status", "nextAttemptAt"]);
      mutations.createIndex("by-activity", "activityId");
      const attachments = database.createObjectStore("pending_attachments", {
        keyPath: "id",
      });
      attachments.createIndex("by-mutation", "mutationId");
      attachments.createIndex("by-status-next", ["status", "nextAttemptAt"]);
    },
  });
  const transaction = db.transaction("pending_mutations", "readwrite");
  for await (const cursor of transaction.store) {
    if (cursor.value.status === "SYNCING")
      await cursor.update({
        ...cursor.value,
        status: "RETRYABLE",
        updatedAt: Date.now(),
      });
  }
  await transaction.done;
  return db;
}
