import { openHuddleTabDb } from "@/pwa/indexed-db/database";
import type {
  MutationStatus,
  PendingAttachment,
} from "@/pwa/indexed-db/schema";

const RETRY_MS = [1000, 5000, 15000, 60000, 300000] as const;

type Failure = { code: string; message: string };
type AttachmentUploader = (input: {
  expenseId: string;
  attachment: PendingAttachment;
}) => Promise<{ id?: string }>;

/**
 * 离线附件的本地持久化仓储。
 *
 * 账单先由 clientMutationId 在服务端幂等创建；附件则以 clientAttachmentId 独立重试。
 * 因此附件失败只能改变自身状态，绝不能把已同步账单放回待创建队列。
 */
export class AttachmentRepository {
  constructor(
    private readonly userId: string,
    private readonly upload: AttachmentUploader,
    private readonly now: () => number = Date.now,
  ) {}

  async add(
    input: Omit<
      PendingAttachment,
      | "userId"
      | "status"
      | "attemptCount"
      | "nextAttemptAt"
      | "createdAt"
      | "updatedAt"
    >,
  ) {
    const now = this.now();
    const attachment: PendingAttachment = {
      ...input,
      userId: this.userId,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const db = await openHuddleTabDb(this.userId);
    try {
      await db.add("pending_attachments", attachment);
      return attachment;
    } finally {
      db.close();
    }
  }

  async get(id: string) {
    const db = await openHuddleTabDb(this.userId);
    try {
      return await db.get("pending_attachments", id);
    } finally {
      db.close();
    }
  }

  async syncFor(mutationId: string, expenseId: string, now = this.now()) {
    const attachments = await this.listByMutation(mutationId);
    for (const attachment of attachments) {
      if (!isReady(attachment.status, attachment.nextAttemptAt, now)) continue;
      await this.update(attachment.id, { status: "SYNCING", updatedAt: now });
      try {
        const result = await this.upload({ expenseId, attachment });
        await this.update(attachment.id, {
          status: "SYNCED",
          serverAttachmentId: result.id,
          updatedAt: now,
        });
      } catch (error) {
        await this.recordFailure(attachment, error, now);
      }
    }
    const remaining = await this.listByMutation(mutationId);
    return {
      pendingCount: remaining.filter(({ status }) => status !== "SYNCED")
        .length,
    };
  }

  private async listByMutation(mutationId: string) {
    const db = await openHuddleTabDb(this.userId);
    try {
      return await db.getAllFromIndex(
        "pending_attachments",
        "by-mutation",
        mutationId,
      );
    } finally {
      db.close();
    }
  }

  private async update(
    id: string,
    changes: Partial<PendingAttachment>,
  ): Promise<void> {
    const db = await openHuddleTabDb(this.userId);
    try {
      const attachment = await db.get("pending_attachments", id);
      if (attachment)
        await db.put("pending_attachments", { ...attachment, ...changes });
    } finally {
      db.close();
    }
  }

  private async recordFailure(
    attachment: PendingAttachment,
    error: unknown,
    now: number,
  ) {
    const value = error as {
      status?: number;
      code?: string;
      message?: string;
      kind?: string;
    };
    const failure: Failure = {
      code: value.code ?? "ATTACHMENT_SYNC_FAILED",
      message: value.message ?? "附件同步失败，请检查网络后重试。",
    };
    const retryable =
      (value.kind === "network" ||
        (value.status !== undefined && value.status >= 500)) &&
      attachment.attemptCount < RETRY_MS.length;
    await this.update(attachment.id, {
      status: retryable ? "RETRYABLE" : "REJECTED",
      attemptCount: attachment.attemptCount + 1,
      nextAttemptAt: retryable
        ? now + RETRY_MS[attachment.attemptCount]
        : Number.MAX_SAFE_INTEGER,
      lastError: failure,
      updatedAt: now,
    });
  }
}

function isReady(status: MutationStatus, nextAttemptAt: number, now: number) {
  return (
    (status === "PENDING" || status === "RETRYABLE") && nextAttemptAt <= now
  );
}
