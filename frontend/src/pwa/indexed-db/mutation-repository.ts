import { withUserDatabase } from "./database";
import type {
  PendingAttachment,
  PendingAttachmentDraft,
  PendingExpenseMutation,
} from "./schema";

type MutationInput = Omit<PendingExpenseMutation, "userId">;

function byCreationOrder(
  left: PendingExpenseMutation,
  right: PendingExpenseMutation,
) {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

/** Task 25 只持久化完整记录；状态转换、退避和同步顺序由 Task 26 负责。 */
export class MutationRepository {
  constructor(private readonly userId: string) {}

  async put(input: MutationInput) {
    const record: PendingExpenseMutation = { ...input, userId: this.userId };
    await withUserDatabase(this.userId, (database) =>
      database.put("pending_mutations", record),
    );
    return record;
  }

  /** Expense 与原始 Blob 必须同事务落库，避免离线时只留下半条业务队列。 */
  async enqueueWithAttachments(
    input: MutationInput,
    drafts: PendingAttachmentDraft[],
  ) {
    const mutation: PendingExpenseMutation = {
      ...input,
      userId: this.userId,
    };
    const attachments: PendingAttachment[] = drafts.map((draft) => ({
      ...draft,
      userId: this.userId,
      activityId: mutation.activityId,
      mutationId: mutation.id,
      status: "PENDING",
      attemptCount: 0,
      nextAttemptAt: mutation.createdAt,
      createdAt: mutation.createdAt,
      updatedAt: mutation.updatedAt,
    }));
    await withUserDatabase(this.userId, async (database) => {
      const transaction = database.transaction(
        ["pending_mutations", "pending_attachments"],
        "readwrite",
      );
      try {
        await transaction.objectStore("pending_mutations").add(mutation);
        for (const attachment of attachments) {
          await transaction.objectStore("pending_attachments").add(attachment);
        }
        await transaction.done;
      } catch (error) {
        // 请求错误会触发事务 abort；等待 done 拒绝，避免留下未处理 Promise。
        await transaction.done.catch(() => undefined);
        throw error;
      }
    });
    return { mutation, attachments };
  }

  /**
   * REJECTED 只允许在本地重新编辑；账单和待传图片必须同一事务替换，
   * 否则刷新窗口可能看到新账单配旧附件或反过来的半成品。
   */
  async reviseRejected(
    id: string,
    payload: PendingExpenseMutation["payload"],
    drafts: PendingAttachmentDraft[],
    now = Date.now(),
  ) {
    const current = await this.get(id);
    if (!current || current.status !== "REJECTED") {
      throw new Error("只有被服务器拒绝的本地账单可以修改。");
    }
    return withUserDatabase(this.userId, async (database) => {
      const transaction = database.transaction(
        ["pending_mutations", "pending_attachments"],
        "readwrite",
      );
      const mutationStore = transaction.objectStore("pending_mutations");
      const attachmentStore = transaction.objectStore("pending_attachments");
      const existing = await mutationStore.get(id);
      if (!existing || existing.status !== "REJECTED") {
        await transaction.done.catch(() => undefined);
        throw new Error("只有被服务器拒绝的本地账单可以修改。");
      }
      const oldAttachments = await attachmentStore.index("by-mutation").getAll(id);
      for (const attachment of oldAttachments) {
        await attachmentStore.delete(attachment.id);
      }
      const mutation: PendingExpenseMutation = {
        ...existing,
        payload,
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: now,
        lastError: undefined,
        serverExpenseId: undefined,
        updatedAt: now,
      };
      await mutationStore.put(mutation);
      const attachments: PendingAttachment[] = drafts.map((draft) => ({
        ...draft,
        userId: this.userId,
        activityId: mutation.activityId,
        mutationId: mutation.id,
        status: "PENDING",
        attemptCount: 0,
        nextAttemptAt: now,
        createdAt: mutation.createdAt,
        updatedAt: now,
      }));
      for (const attachment of attachments) {
        await attachmentStore.add(attachment);
      }
      await transaction.done;
      return { mutation, attachments };
    });
  }

  /** 丢弃只删除本地账单及其附件，不向服务器发送任何删除请求。 */
  async discard(id: string) {
    await withUserDatabase(this.userId, async (database) => {
      const transaction = database.transaction(
        ["pending_mutations", "pending_attachments"],
        "readwrite",
      );
      const mutationStore = transaction.objectStore("pending_mutations");
      const attachmentStore = transaction.objectStore("pending_attachments");
      const attachments = await attachmentStore.index("by-mutation").getAll(id);
      for (const attachment of attachments) {
        await attachmentStore.delete(attachment.id);
      }
      await mutationStore.delete(id);
      await transaction.done;
    });
  }

  get(id: string) {
    return withUserDatabase(this.userId, (database) =>
      database.get("pending_mutations", id),
    );
  }

  async listByActivity(activityId: string) {
    const records = await withUserDatabase(this.userId, (database) =>
      database.getAllFromIndex(
        "pending_mutations",
        "by-activity",
        activityId,
      ),
    );
    return records.sort(byCreationOrder);
  }

  async listAll() {
    const records = await withUserDatabase(this.userId, (database) =>
      database.getAll("pending_mutations"),
    );
    return records.sort(byCreationOrder);
  }
}
