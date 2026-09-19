import { withUserDatabase } from "./database";
import type { PendingAttachment, StoredPendingAttachment } from "./schema";

type AttachmentInput = Omit<PendingAttachment, "userId">;

const CORRUPTED_ATTACHMENT_ERROR = {
  code: "LOCAL_ATTACHMENT_CORRUPTED",
  message: "本地附件无法恢复，请重新选择或移除该附件。",
} as const;

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}

function isBlob(value: unknown): value is Blob {
  return value !== null && typeof value === "object" &&
    typeof (value as Blob).arrayBuffer === "function" &&
    typeof (value as Blob).size === "number";
}

function byCreationOrder(
  left: PendingAttachment,
  right: PendingAttachment,
) {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

async function toStoredAttachment(
  record: PendingAttachment,
): Promise<StoredPendingAttachment> {
  const source = record.blob as unknown;
  const inferredLastModified = record.lastModified ?? readLastModified(source);
  let blob: ArrayBuffer;
  if (isBlob(source)) {
    blob = await source.arrayBuffer();
  } else if (isArrayBuffer(source)) {
    blob = source;
  } else {
    throw new Error(CORRUPTED_ATTACHMENT_ERROR.message);
  }
  return {
    ...record,
    ...(inferredLastModified === undefined
      ? {}
      : { lastModified: inferredLastModified }),
    blob,
  };
}

function readLastModified(value: unknown) {
  if (!isBlob(value) || !("lastModified" in value)) return undefined;
  const lastModified = (value as Blob & { lastModified?: unknown }).lastModified;
  return typeof lastModified === "number" && Number.isFinite(lastModified)
    ? lastModified
    : undefined;
}

function restoreBlob(record: StoredPendingAttachment) {
  const source = record.blob as unknown;
  if (isBlob(source)) {
    return { blob: source, lastModified: readLastModified(source) };
  }
  if (isArrayBuffer(source)) {
    return {
      blob: new Blob([source], { type: record.mimeType }),
      lastModified: undefined,
    };
  }
  throw new Error(CORRUPTED_ATTACHMENT_ERROR.message);
}

/** 读取时兼容旧版 File/Blob 与当前 ArrayBuffer；不做全库批量重写。 */
function fromStoredAttachment(record: StoredPendingAttachment): PendingAttachment {
  const restored = restoreBlob(record);
  const lastModified = record.lastModified ?? restored.lastModified;
  return {
    ...record,
    ...(lastModified === undefined ? {} : { lastModified }),
    blob: restored.blob,
  };
}

function rejectedAttachment(record: StoredPendingAttachment): PendingAttachment {
  const mimeType = typeof record.mimeType === "string"
    ? record.mimeType
    : "application/octet-stream";
  return {
    ...record,
    status: "REJECTED",
    lastError: record.lastError ?? CORRUPTED_ATTACHMENT_ERROR,
    blob: new Blob([], { type: mimeType }),
  };
}

async function markCorrupted(record: StoredPendingAttachment) {
  const rejected = {
    ...record,
    status: "REJECTED" as const,
    lastError: CORRUPTED_ATTACHMENT_ERROR,
    updatedAt: Date.now(),
  };
  try {
    await withUserDatabase(record.userId, (database) =>
      database.put(
        "pending_attachments",
        rejected as unknown as StoredPendingAttachment,
      ),
    );
  } catch {
    // 读取已成功但标记失败时仍返回内存中的 REJECTED 占位记录，
    // 不让一条损坏附件阻塞其他离线账单；下一次打开仍会再次提示。
  }
  return rejectedAttachment(rejected as StoredPendingAttachment);
}

async function restoreRecords(records: StoredPendingAttachment[]) {
  const restored: PendingAttachment[] = [];
  for (const record of records) {
    try {
      restored.push(fromStoredAttachment(record));
    } catch {
      restored.push(await markCorrupted(record));
    }
  }
  return restored;
}

export {
  fromStoredAttachment,
  toStoredAttachment,
};

/** 附件字节始终留在当前用户数据库；本 repository 不触发网络或 Service Worker。 */
export class AttachmentRepository {
  constructor(private readonly userId: string) {}

  async put(input: AttachmentInput | PendingAttachment) {
    const record: PendingAttachment = { ...input, userId: this.userId };
    const stored = await toStoredAttachment(record);
    await withUserDatabase(this.userId, (database) =>
      database.put("pending_attachments", stored),
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
    return (await restoreRecords(records)).sort(byCreationOrder);
  }

  async listByActivity(activityId: string) {
    const records = await withUserDatabase(this.userId, (database) =>
      database.getAll("pending_attachments"),
    );
    return (await restoreRecords(records))
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
