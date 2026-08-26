import type { IDBPDatabase } from "idb";
import { openHuddleTabDb } from "@/pwa/indexed-db/database";
import type { HuddleTabDb } from "@/pwa/indexed-db/schema";
/** Snapshot 只作完整替换缓存；离线层不解释或增量修改其权威账务事实。 */
export class SnapshotRepository {
  private constructor(private readonly db: IDBPDatabase<HuddleTabDb>) {}
  static async open(userId: string) {
    return new SnapshotRepository(await openHuddleTabDb(userId));
  }
  async replace(record: HuddleTabDb["activity_snapshots"]["value"]) {
    await this.db.put("activity_snapshots", record);
  }
  async get(activityId: string) {
    return this.db.get("activity_snapshots", activityId);
  }
  async require(activityId: string) {
    const value = await this.get(activityId);
    if (!value) throw new Error("此活动尚未缓存，无法离线查看。");
    return value;
  }
  close() {
    this.db.close();
  }
}
