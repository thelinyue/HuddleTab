import "fake-indexeddb/auto";

import { deleteDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearLocalData,
  databaseName,
  withUserDatabase,
} from "./database";

const users = ["user-1", "user-2"];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(users.map((userId) => deleteDB(databaseName(userId))));
});

describe("HuddleTab IndexedDB", () => {
  it("fresh database 只创建 Task 25 的两个 store 和活动索引", async () => {
    await withUserDatabase("user-1", async (database) => {
      expect(database.version).toBe(1);
      expect([...database.objectStoreNames]).toEqual([
        "activity_snapshots",
        "pending_mutations",
      ]);
      const transaction = database.transaction("pending_mutations", "readonly");
      expect([...transaction.store.indexNames]).toEqual(["by-activity"]);
      await transaction.done;
    });
  });

  it("不同 user_id 使用不同数据库且显式清理不影响另一用户", async () => {
    await withUserDatabase("user-1", (database) =>
      database.put("activity_snapshots", {
        userId: "user-1",
        activityId: "activity-1",
        etag: 'W/"1"',
        snapshot: { revision: "1" } as never,
        fetchedAt: 1,
      }),
    );
    await withUserDatabase("user-2", (database) =>
      database.put("activity_snapshots", {
        userId: "user-2",
        activityId: "activity-1",
        etag: 'W/"2"',
        snapshot: { revision: "2" } as never,
        fetchedAt: 2,
      }),
    );

    await clearLocalData("user-1");

    await withUserDatabase("user-1", async (database) => {
      expect(
        await database.get("activity_snapshots", "activity-1"),
      ).toBeUndefined();
    });
    await withUserDatabase("user-2", async (database) => {
      expect(
        await database.get("activity_snapshots", "activity-1"),
      ).toMatchObject({
        userId: "user-2",
        etag: 'W/"2"',
      });
    });
  });

  it("IndexedDB 不可用时返回中文错误并保留 cause", async () => {
    const unavailable = new Error("indexeddb unavailable");
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw unavailable;
    });

    await expect(
      withUserDatabase("user-1", async () => undefined),
    ).rejects.toMatchObject({
      message: "无法访问此设备上的伙记本地数据。",
      cause: unavailable,
    });
  });
});
