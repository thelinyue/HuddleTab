import { withUserDatabase } from "./database";
import type { PendingAttachment } from "./schema";

type AttachmentInput = Omit<PendingAttachment, "userId">;

function byCreationOrder(
  left: PendingAttachment,
  right: PendingAttachment,
) {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

/** Blob 始终留在当前用户数据库；本 repository 不触发网络或 Service Worker。 */
export class AttachmentRepository {
  constructor(private readonly userId: string) {}

  async put(input: AttachmentInput | PendingAttachment) {
    const record: PendingAttachment = { ...input, userId: this.userId };
    await withUserDatabase(this.userId, (database) =>
      database.put("pending_attachments", record),
    );
    return record;
  }

  async listByMutation(mutationId: string) {
    const records = await withUserDatabase(this.userId, (database) =>
      database.getAllFromIndex(
        "pending_attachments",
        "by-mutation",
        mutationId,
      ),
    );
    return records.sort(byCreationOrder);
  }

  async listByActivity(activityId: string) {
    const records = await withUserDatabase(this.userId, (database) =>
      database.getAll("pending_attachments"),
    );
    return records
      .filter((record) => record.activityId === activityId)
      .sort(byCreationOrder);
  }

  async removeRejectedForMutation(mutationId: string) {
    await withUserDatabase(this.userId, async (database) => {
      const transaction = database.transaction(
        "pending_attachments",
        "readwrite",
      );
      const records = await transaction.store.index("by-mutation").getAll(
        mutationId,
      );
      for (const record of records) {
        if (record.status === "REJECTED") {
          await transaction.store.delete(record.id);
        }
      }
      await transaction.done;
    });
  }
}
