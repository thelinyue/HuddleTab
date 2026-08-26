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
  ): Promise<{ pendingCount: number }>;
};
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
    },
    private readonly api: {
      createExpense(
        activityId: string,
        payload: unknown,
      ): Promise<{ expense?: { id?: string } }>;
    },
    private readonly now: () => number = Date.now,
    private readonly attachments?: AttachmentSync,
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
          if (attachmentResult.pendingCount)
            await this.queue.setInfo?.(item.id, {
              code: "ATTACHMENTS_PENDING",
              message: "账单已同步，附件待同步。",
            });
        } catch {
          // 账单已得到服务端确认，附件本地异常也不能触发账单的第二次创建。
          await this.queue.setInfo?.(item.id, {
            code: "ATTACHMENTS_PENDING",
            message: "账单已同步，附件待同步。",
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
        (value.kind === "network" ||
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
}
