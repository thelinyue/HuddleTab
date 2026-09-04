import {
  fetchActivitySnapshot,
  type CachedActivitySnapshot,
} from "../../features/activities/snapshot-api";
import { withUserDatabase } from "./database";
import type { ActivitySnapshotRecord } from "./schema";

/** Snapshot 只做完整替换；本地层不解释或增量修改不同 revision 的账务事实。 */
export class SnapshotRepository {
  constructor(
    private readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  get(activityId: string) {
    return withUserDatabase(this.userId, (database) =>
      database.get("activity_snapshots", activityId),
    );
  }

  async require(activityId: string) {
    const record = await this.get(activityId);
    if (!record) throw new Error("此活动尚未缓存，无法离线查看。");
    return record;
  }

  async replace(activityId: string, value: CachedActivitySnapshot) {
    const record: ActivitySnapshotRecord = {
      userId: this.userId,
      activityId,
      etag: value.etag,
      snapshot: value.snapshot,
      fetchedAt: this.now(),
    };
    await withUserDatabase(this.userId, (database) =>
      database.put("activity_snapshots", record),
    );
    return record;
  }

  async refresh(activityId: string) {
    const current = await this.get(activityId);
    const result = await fetchActivitySnapshot(
      activityId,
      current
        ? { etag: current.etag, snapshot: current.snapshot }
        : undefined,
    );
    return result.status === "not-modified" && current
      ? current
      : this.replace(activityId, result.value);
  }
}
