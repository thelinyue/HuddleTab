import { deleteDB, openDB, type IDBPDatabase } from "idb";

import type { HuddleTabDb } from "./schema";

const databaseVersion = 1;

export function databaseName(userId: string) {
  return `huddletab:${userId}`;
}

async function openDatabase(userId: string) {
  return openDB<HuddleTabDb>(databaseName(userId), databaseVersion, {
    upgrade(upgradeDatabase) {
      upgradeDatabase.createObjectStore("activity_snapshots", {
        keyPath: "activityId",
      });
      const mutations = upgradeDatabase.createObjectStore(
        "pending_mutations",
        { keyPath: "id" },
      );
      mutations.createIndex("by-activity", "activityId");
      const attachments = upgradeDatabase.createObjectStore(
        "pending_attachments",
        { keyPath: "id" },
      );
      attachments.createIndex("by-mutation", "mutationId");
    },
  });
}

/** 更新提示只读当前用户数据库，连接失败必须以中文说明而不能静默放行。 */
export async function openHuddleTabDb(userId: string) {
  try {
    return await openDatabase(userId);
  } catch (cause) {
    throw new Error("无法访问此设备上的伙记本地数据。", { cause });
  }
}

/** 每次操作关闭连接，确保用户显式清理本地数据时不会被本标签页阻塞。 */
export async function withUserDatabase<T>(
  userId: string,
  operation: (database: IDBPDatabase<HuddleTabDb>) => Promise<T>,
): Promise<T> {
  try {
    const database = await openDatabase(userId);
    try {
      return await operation(database);
    } finally {
      database.close();
    }
  } catch (cause) {
    throw new Error("无法访问此设备上的伙记本地数据。", { cause });
  }
}

export async function clearLocalData(userId: string): Promise<void> {
  try {
    await deleteDB(databaseName(userId));
  } catch (cause) {
    throw new Error("无法清除此设备上的伙记本地数据。", { cause });
  }
}
