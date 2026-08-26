const RETRY_MS = [1000, 5000, 15000, 60000, 300000] as const;
type Item = {
  id: string;
  activityId: string;
  payload: unknown;
  attemptCount?: number;
};
type Failure = { code: string; message: string };
type AttachmentSync = {
  syncFor(
    mutationId: string,
    expenseId: string,
  ): Promise<{ pendingCount: number; rejectedCount?: number }>;
};
type SnapshotRefresh = { refresh(activityId: string): Promise<void> };
/** 前台唯一同步 worker；网络故障有限重试，权限/状态/校验拒绝保留本地输入。 */
export class SyncCoordinator {
  private running: Promise<void> | null = null;
  constructor(
    private readonly queue: {
      nextReady(): Promise<Item | null>;
      markSyncing(id: string): Promise<void> | void;
      markRetryable(
        id: string,
        at: number,
        failure: Failure,
      ): Promise<void> | void;
      markRejected(id: string, failure: Failure): Promise<void> | void;
      markSynced(id: string, serverId?: string): Promise<void> | void;
      setInfo?(id: string, info: Failure): Promise<void> | void;
      clearInfo?(id: string): Promise<void> | void;
      listSyncedWithServerId?(): Promise<
        readonly { id: string; serverExpenseId: string }[]
      >;
    },
    private readonly api: {
      createExpense(
        activityId: string,
        payload: unknown,
      ): Promise<{ expense?: { id?: string } }>;
    },
    private readonly now: () => number = Date.now,
    private readonly attachments?: AttachmentSync,
    private readonly snapshots?: SnapshotRefresh,
  ) {}
  run() {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async drain() {
    for (
      let item = await this.queue.nextReady();
      item;
      item = await this.queue.nextReady()
    )
      await this.syncOne(item);
    await this.retrySyncedAttachments();
  }
  private async syncOne(item: Item) {
    await this.queue.markSyncing(item.id);
    try {
      const result = await this.api.createExpense(
        item.activityId,
        item.payload,
      );
      await this.queue.markSynced(item.id, result.expense?.id);
      if (result.expense?.id && this.attachments) {
        try {
          const attachmentResult = await this.attachments.syncFor(
            item.id,
            result.expense.id,
          );
          if (attachmentResult.rejectedCount)
            await this.queue.setInfo?.(item.id, {
              code: "ATTACHMENTS_REJECTED",
              message: "有附件被服务器拒绝，请移除后继续。",
            });
          else if (attachmentResult.pendingCount)
            await this.queue.setInfo?.(item.id, {
              code: "ATTACHMENTS_PENDING",
              message: "账单已同步，附件待同步。",
            });
          else await this.queue.clearInfo?.(item.id);
        } catch {
          // 账单已得到服务端确认，附件本地异常也不能触发账单的第二次创建。
          await this.queue.setInfo?.(item.id, {
            code: "ATTACHMENTS_PENDING",
            message: "账单已同步，附件待同步。",
          });
        }
      }
      if (this.snapshots) {
        try {
          await this.snapshots.refresh(item.activityId);
        } catch {
          // 快照刷新不影响已被幂等确认的账单，后续联网时仍可重新拉取权威数据。
          await this.queue.setInfo?.(item.id, {
            code: "SNAPSHOT_REFRESH_PENDING",
            message: "账单已同步，活动数据待刷新。",
          });
        }
      }
    } catch (error) {
      const value = error as {
        status?: number;
        code?: string;
        message?: string;
        kind?: string;
      };
      const failure = {
        code: value.code ?? "SYNC_FAILED",
        message: value.message ?? "同步失败，请检查后重试。",
      };
      if (
        (error instanceof TypeError ||
          value.kind === "network" ||
          (value.status !== undefined && value.status >= 500)) &&
        (item.attemptCount ?? 0) < RETRY_MS.length
      )
        await this.queue.markRetryable(
          item.id,
          this.now() + RETRY_MS[item.attemptCount ?? 0],
          failure,
        );
      else await this.queue.markRejected(item.id, failure);
    }
  }

  /** 已确认的账单不应因附件失败重新创建；后续同步只重试其持久化附件队列。 */
  private async retrySyncedAttachments() {
    if (!this.attachments || !this.queue.listSyncedWithServerId) return;
    for (const mutation of await this.queue.listSyncedWithServerId()) {
      const result = await this.attachments.syncFor(
        mutation.id,
        mutation.serverExpenseId,
      );
      if (result.rejectedCount)
        await this.queue.setInfo?.(mutation.id, {
          code: "ATTACHMENTS_REJECTED",
          message: "有附件被服务器拒绝，请移除后继续。",
        });
      else if (result.pendingCount)
        await this.queue.setInfo?.(mutation.id, {
          code: "ATTACHMENTS_PENDING",
          message: "账单已同步，附件待同步。",
        });
      else await this.queue.clearInfo?.(mutation.id);
    }
  }
}
