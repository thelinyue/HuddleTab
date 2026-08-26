import { openDB } from "idb";
import type { HuddleTabDb } from "@/pwa/indexed-db/schema";

/** 数据库名包含服务器 User ID，退出或换号时不可能读取到另一账号的离线快照和队列。 */
export async function openHuddleTabDb(userId: string) {
  return openDB<HuddleTabDb>(`huddletab:${userId}`, 1, {
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
}

/** 仅在新的前台同步轮次开始时恢复前次页面异常中断的状态，不能在普通读写时触发。 */
export async function recoverInterruptedSyncing(userId: string) {
  const db = await openHuddleTabDb(userId);
  try {
    const transaction = db.transaction(
      ["pending_mutations", "pending_attachments"],
      "readwrite",
    );
    for (const storeName of [
      "pending_mutations",
      "pending_attachments",
    ] as const) {
      const store = transaction.objectStore(storeName);
      for await (const cursor of store) {
        if (cursor.value.status === "SYNCING")
          await cursor.update({
            ...cursor.value,
            status: "RETRYABLE",
            updatedAt: Date.now(),
          });
      }
    }
    await transaction.done;
  } finally {
    db.close();
  }
}
