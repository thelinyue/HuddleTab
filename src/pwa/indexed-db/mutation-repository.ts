import { openHuddleTabDb } from "@/pwa/indexed-db/database";
import type { PendingExpenseMutation } from "@/pwa/indexed-db/schema";

type Failure = { code: string; message: string };

/**
 * 前台同步器使用的本地消费队列。
 *
 * 数据库按用户隔离；丢弃操作仅删除本地未同步输入及其附件，绝不调用服务端删除
 * 已存在的账务事实。
 */
export class MutationRepository {
  constructor(
    private readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  async add(
    input: Omit<
      PendingExpenseMutation,
      | "userId"
      | "status"
      | "attemptCount"
      | "nextAttemptAt"
      | "createdAt"
      | "updatedAt"
    > &
      Partial<Pick<PendingExpenseMutation, "nextAttemptAt">>,
  ) {
    const now = this.now();
    const mutation: PendingExpenseMutation = {
      ...input,
      userId: this.userId,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: input.nextAttemptAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    const db = await openHuddleTabDb(this.userId);
    try {
      await db.add("pending_mutations", mutation);
      return mutation;
    } finally {
      db.close();
    }
  }

  async get(id: string) {
    const db = await openHuddleTabDb(this.userId);
    try {
      return await db.get("pending_mutations", id);
    } finally {
      db.close();
    }
  }

  async listByActivity(activityId: string) {
    const db = await openHuddleTabDb(this.userId);
    try {
      const records = await db.getAllFromIndex(
        "pending_mutations",
        "by-activity",
        activityId,
      );
      return records.sort((left, right) => right.createdAt - left.createdAt);
    } finally {
      db.close();
    }
  }

  async nextReady() {
    const db = await openHuddleTabDb(this.userId);
    try {
      const now = this.now();
      const records = await db.getAll("pending_mutations");
      return (
        records
          .filter(
            (record) =>
              (record.status === "PENDING" || record.status === "RETRYABLE") &&
              record.nextAttemptAt <= now,
          )
          .sort(
            (left, right) =>
              left.nextAttemptAt - right.nextAttemptAt ||
              left.createdAt - right.createdAt,
          )[0] ?? null
      );
    } finally {
      db.close();
    }
  }

  async markSyncing(id: string) {
    await this.update(id, { status: "SYNCING" });
  }

  async markRetryable(id: string, nextAttemptAt: number, lastError: Failure) {
    const mutation = await this.get(id);
    if (!mutation) return;
    await this.update(id, {
      status: "RETRYABLE",
      attemptCount: mutation.attemptCount + 1,
      nextAttemptAt,
      lastError,
    });
  }

  async markRejected(id: string, lastError: Failure) {
    await this.update(id, {
      status: "REJECTED",
      nextAttemptAt: Number.MAX_SAFE_INTEGER,
      lastError,
    });
  }

  async markSynced(id: string, serverExpenseId?: string) {
    await this.update(id, {
      status: "SYNCED",
      serverExpenseId,
      lastError: undefined,
    });
  }

  async setInfo(id: string, syncInfo: Failure) {
    await this.update(id, { syncInfo });
  }

  async discard(id: string) {
    const db = await openHuddleTabDb(this.userId);
    try {
      const transaction = db.transaction(
        ["pending_mutations", "pending_attachments"],
        "readwrite",
      );
      const attachments = await transaction
        .objectStore("pending_attachments")
        .index("by-mutation")
        .getAllKeys(id);
      await transaction.objectStore("pending_mutations").delete(id);
      for (const attachmentId of attachments)
        await transaction
          .objectStore("pending_attachments")
          .delete(attachmentId);
      await transaction.done;
    } finally {
      db.close();
    }
  }

  private async update(
    id: string,
    changes: Partial<PendingExpenseMutation>,
  ): Promise<void> {
    const db = await openHuddleTabDb(this.userId);
    try {
      const mutation = await db.get("pending_mutations", id);
      if (mutation)
        await db.put("pending_mutations", {
          ...mutation,
          ...changes,
          updatedAt: this.now(),
        });
    } finally {
      db.close();
    }
  }
}
