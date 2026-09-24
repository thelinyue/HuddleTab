import { ApiRequestError } from "../../api/error";
import {
  fetchActivitySnapshot,
  type CachedActivitySnapshot,
} from "../../features/activities/snapshot-api";
import { withUserDatabase } from "./database";
import type { ActivitySnapshotRecord } from "./schema";

// 同一设备的查询与删除会使用不同 repository 实例，需共同取消正在读取的旧快照。
const pendingRefreshes = new Set<{ userId: string; activityId: string; controller: AbortController }>();

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

  async replace(activityId: string, value: CachedActivitySnapshot, signal?: AbortSignal) {
    const record: ActivitySnapshotRecord = {
      userId: this.userId,
      activityId,
      etag: value.etag,
      snapshot: value.snapshot,
      fetchedAt: this.now(),
    };
    await withUserDatabase(this.userId, async (database) => {
      signal?.throwIfAborted();
      await database.put("activity_snapshots", record);
    });
    return record;
  }

  /** 永久删除或失去访问权后移除旧快照；未同步草稿和图片保留原文，停止自动重试。 */
  async forgetUnavailable(activityId: string) {
    for (const pending of pendingRefreshes) {
      if (pending.userId === this.userId && pending.activityId === activityId) {
        pending.controller.abort(new ApiRequestError(404));
      }
    }
    await withUserDatabase(this.userId, async (database) => {
      const transaction = database.transaction(["activity_snapshots", "pending_mutations", "pending_attachments"], "readwrite");
      await transaction.objectStore("activity_snapshots").delete(activityId);
      const mutations = transaction.objectStore("pending_mutations");
      const attachments = transaction.objectStore("pending_attachments");
      const lastError = { code: "ACTIVITY_UNAVAILABLE", message: "活动已删除或无法访问，此草稿无法同步，内容仍保留在本设备。" };
      for (const mutation of await mutations.index("by-activity").getAll(activityId)) {
        if (mutation.status !== "SYNCED") {
          await mutations.put({ ...mutation, status: "REJECTED", lastError, updatedAt: Date.now() });
        }
        for (const attachment of await attachments.index("by-mutation").getAll(mutation.id)) {
          if (attachment.status !== "SYNCED") {
            await attachments.put({ ...attachment, status: "REJECTED", lastError, updatedAt: Date.now() });
          }
        }
      }
      await transaction.done;
    });
  }

  async refresh(activityId: string) {
    const pending = { userId: this.userId, activityId, controller: new AbortController() };
    pendingRefreshes.add(pending);
    try {
      const current = await this.get(activityId);
      pending.controller.signal.throwIfAborted();
      const result = await fetchActivitySnapshot(
        activityId,
        current ? { etag: current.etag, snapshot: current.snapshot } : undefined,
      );
      pending.controller.signal.throwIfAborted();
      return result.status === "not-modified" && current
        ? current
        : await this.replace(activityId, result.value, pending.controller.signal);
    } catch (error) {
      if (pending.controller.signal.aborted) throw pending.controller.signal.reason;
      if (error instanceof ApiRequestError && [403, 404].includes(error.status)) {
        await this.forgetUnavailable(activityId).catch((cleanupError: unknown) => {
          console.error("活动无法访问，本地快照清理失败。", cleanupError);
        });
      }
      throw error;
    } finally {
      pendingRefreshes.delete(pending);
    }
  }
}
