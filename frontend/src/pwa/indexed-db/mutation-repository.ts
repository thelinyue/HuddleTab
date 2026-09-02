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
