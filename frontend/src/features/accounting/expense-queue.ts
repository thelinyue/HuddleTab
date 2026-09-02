import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { ApiRequestError, unwrap } from "../../api/error";
import { AttachmentRepository } from "../../pwa/indexed-db/attachment-repository";
import { MutationRepository } from "../../pwa/indexed-db/mutation-repository";
import type {
  ExpenseCreateInput,
  PendingAttachment,
  PendingExpenseMutation,
} from "../../pwa/indexed-db/schema";

type SendExpense = (
  activityId: string,
  input: ExpenseCreateInput,
) => Promise<{ expenseId: string }>;

type SendAttachment = (
  activityId: string,
  expenseId: string,
  attachment: PendingAttachment,
) => Promise<{ id: string }>;

type ExpenseQueueOptions = {
  canSend?: () => boolean;
  send?: SendExpense;
  sendAttachment?: SendAttachment;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

const retryDelays = [1_000, 5_000] as const;

export const EXPENSE_QUEUE_CHANGED_EVENT = "huddletab:expense-queue-changed";

export type ExpenseQueueChangedDetail = {
  userId: string;
  activityId: string;
  status: PendingExpenseMutation["status"];
  kind: "EXPENSE" | "ATTACHMENT";
};

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function queueError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "NETWORK_ERROR",
    message: "网络连接不可用，账单将在稍后重试。",
  };
}

function attachmentQueueError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return { code: error.code, message: "附件被服务器拒绝。" };
  }
  return {
    code: "NETWORK_ERROR",
    message: "网络连接不可用，附件将在稍后重试。",
  };
}

function isRetryable(error: unknown) {
  return !(error instanceof ApiRequestError) ||
    error.status >= 500 ||
    [401, 429].includes(error.status);
}

async function sendExpense(
  activityId: string,
  input: ExpenseCreateInput,
) {
  const data = unwrap(
    await apiClient.POST("/api/activities/{activity_id}/expenses", {
      params: { path: { activity_id: activityId } },
      body: input,
      headers: await mutationHeaders(),
    }),
  ).data;
  return { expenseId: data.expense.expenseId };
}

/** 附件只通过生成客户端发送 multipart；页面组件不直接接触 fetch。 */
export async function uploadExpenseAttachment(
  activityId: string,
  expenseId: string,
  attachment: PendingAttachment,
) {
  const formData = new FormData();
  formData.set("file", attachment.blob, attachment.fileName);
  formData.set("clientAttachmentId", attachment.clientAttachmentId);
  const headers = await mutationHeaders();
  return unwrap(
    await apiClient.POST(
      "/api/activities/{activity_id}/expenses/{expense_id}/attachments",
      {
        params: {
          header: { "x-csrf-token": headers["X-CSRF-Token"] },
          path: { activity_id: activityId, expense_id: expenseId },
        },
        body: {
          file: attachment.fileName,
          clientAttachmentId: attachment.clientAttachmentId,
        },
        bodySerializer: () => formData,
      },
    ),
  ).data;
}

const queues = new Map<string, ExpenseQueue>();
let activeUserId: string | undefined;

export function activateExpenseQueueUser(userId: string) {
  activeUserId = userId;
  return () => {
    if (activeUserId === userId) activeUserId = undefined;
  };
}

export function expenseQueueFor(userId: string) {
  let queue = queues.get(userId);
  if (!queue) {
    queue = new ExpenseQueue(userId, {
      canSend: () => activeUserId === userId,
    });
    queues.set(userId, queue);
  }
  return queue;
}

/** Expense Create 使用独立串行队列，避免把本地 mutation 误做成通用后台任务框架。 */
export class ExpenseQueue {
  private readonly repository: MutationRepository;
  private readonly attachments: AttachmentRepository;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private inFlight?: Promise<void>;

  constructor(
    private readonly userId: string,
    private readonly options: ExpenseQueueOptions = {},
  ) {
    this.repository = new MutationRepository(userId);
    this.attachments = new AttachmentRepository(userId);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
  }

  async enqueue(
    activityId: string,
    payload: ExpenseCreateInput,
    files: readonly File[] = [],
  ) {
    const existing = await this.repository.get(payload.clientMutationId);
    if (existing) return existing;
    const timestamp = this.now();
    const mutation = {
      id: payload.clientMutationId,
      activityId,
      kind: "CREATE_EXPENSE",
      payload,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as const;
    if (files.length === 0) return this.save(mutation);

    const saved = await this.repository.enqueueWithAttachments(
      mutation,
      files.map((file) => ({
        id: crypto.randomUUID(),
        clientAttachmentId: crypto.randomUUID(),
        fileName: file.name,
        mimeType: file.type,
        blob: file,
      })),
    );
    this.dispatch(saved.mutation.activityId, saved.mutation.status, "EXPENSE");
    return saved.mutation;
  }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.flushSerially().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async flushSerially() {
    let records = await this.repository.listAll();
    for (const record of records) {
      if (!["PENDING", "SYNCING", "RETRYABLE"].includes(record.status)) {
        continue;
      }
      const shouldContinue = await this.sync(record);
      if (!shouldContinue) return;
    }

    records = await this.repository.listAll();
    for (const mutation of records) {
      if (mutation.status !== "SYNCED" || !mutation.serverExpenseId) continue;
      const attachments = await this.attachments.listByMutation(mutation.id);
      for (const attachment of attachments) {
        if (!["PENDING", "SYNCING", "RETRYABLE"].includes(
          attachment.status,
        )) continue;
        const shouldContinue = await this.syncAttachment(
          mutation,
          attachment,
        );
        if (!shouldContinue) return;
      }
    }
  }

  private async save(
    record: Omit<PendingExpenseMutation, "userId"> | PendingExpenseMutation,
  ) {
    const saved = await this.repository.put(record);
    this.dispatch(saved.activityId, saved.status, "EXPENSE");
    return saved;
  }

  private async saveAttachment(record: PendingAttachment) {
    const saved = await this.attachments.put(record);
    this.dispatch(saved.activityId, saved.status, "ATTACHMENT");
    return saved;
  }

  private dispatch(
    activityId: string,
    status: PendingExpenseMutation["status"],
    kind: ExpenseQueueChangedDetail["kind"],
  ) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<ExpenseQueueChangedDetail>(
      EXPENSE_QUEUE_CHANGED_EVENT,
      { detail: { userId: this.userId, activityId, status, kind } },
    ));
  }

  private async sync(record: PendingExpenseMutation) {
    let current = record;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.options.canSend && !this.options.canSend()) return false;
      const syncing = await this.save({
        ...current,
        status: "SYNCING",
        attemptCount: current.attemptCount + 1,
        lastError: undefined,
        updatedAt: this.now(),
      });
      try {
        const result = await (this.options.send ?? sendExpense)(
          syncing.activityId,
          syncing.payload,
        );
        await this.save({
          ...syncing,
          status: "SYNCED",
          nextAttemptAt: 0,
          lastError: undefined,
          serverExpenseId: result.expenseId,
          updatedAt: this.now(),
        });
        return true;
      } catch (error) {
        if (!isRetryable(error)) {
          await this.save({
            ...syncing,
            status: "REJECTED",
            lastError: queueError(error),
            updatedAt: this.now(),
          });
          return true;
        }

        const delay = retryDelays[attempt];
        current = await this.save({
          ...syncing,
          status: "RETRYABLE",
          lastError: queueError(error),
          nextAttemptAt: this.now() + (delay ?? 0),
          updatedAt: this.now(),
        });
        // Session 已失效时等待重新登录，重复请求只会制造额外 401。
        if (error instanceof ApiRequestError && error.status === 401) {
          return false;
        }
        if (delay === undefined) return false;
        await this.sleep(delay);
      }
    }
    return false;
  }

  private async syncAttachment(
    mutation: PendingExpenseMutation,
    record: PendingAttachment,
  ) {
    let current = record;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.options.canSend && !this.options.canSend()) return false;
      const syncing = await this.saveAttachment({
        ...current,
        status: "SYNCING",
        attemptCount: current.attemptCount + 1,
        lastError: undefined,
        updatedAt: this.now(),
      });
      try {
        const result = await (
          this.options.sendAttachment ?? uploadExpenseAttachment
        )(mutation.activityId, mutation.serverExpenseId!, syncing);
        await this.saveAttachment({
          ...syncing,
          status: "SYNCED",
          nextAttemptAt: 0,
          lastError: undefined,
          serverAttachmentId: result.id,
          updatedAt: this.now(),
        });
        return true;
      } catch (error) {
        if (!isRetryable(error)) {
          await this.saveAttachment({
            ...syncing,
            status: "REJECTED",
            lastError: attachmentQueueError(error),
            updatedAt: this.now(),
          });
          return true;
        }

        const delay = retryDelays[attempt];
        current = await this.saveAttachment({
          ...syncing,
          status: "RETRYABLE",
          lastError: attachmentQueueError(error),
          nextAttemptAt: this.now() + (delay ?? 0),
          updatedAt: this.now(),
        });
        if (error instanceof ApiRequestError && error.status === 401) {
          return false;
        }
        if (delay === undefined) return false;
        await this.sleep(delay);
      }
    }
    return false;
  }
}
