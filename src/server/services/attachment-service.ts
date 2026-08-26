import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type postgres from "postgres";

import { processAttachmentImage } from "@/server/attachments/image-policy";
import { LocalAttachmentStore } from "@/server/attachments/local-attachment-store";
import { ApplicationError } from "@/server/errors/application-error";
import { authorizeActivityOperation } from "@/server/permissions/authorize-activity-operation";

type AttachmentStore = Pick<LocalAttachmentStore, "read" | "write" | "remove">;
type AttachmentRow = {
  readonly id: string;
  readonly safe_filename: string;
  readonly mime_type: string;
  readonly width: number;
  readonly height: number;
  readonly byte_size: number;
  readonly sha256: string;
  readonly created_at: Date | string;
};

/** 附件服务将权限、存储和元数据绑定为单一业务入口，HTTP 层不得直接访问 uploads。 */
export class AttachmentService {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly store: AttachmentStore = new LocalAttachmentStore(
      join(process.env.DATA_DIR ?? join(process.cwd(), "data"), "uploads"),
    ),
  ) {}

  async upload(input: {
    readonly session: { readonly user: { readonly id: string } } | null;
    readonly activityId: string;
    readonly expenseId: string;
    readonly clientAttachmentId: string;
    readonly declaredMime: string;
    readonly bytes: Buffer;
  }) {
    let writtenStorageKey: string | undefined;
    try {
      return await this.sql.begin(async (transaction) => {
        await authorizeActivityOperation(transaction, {
          session: input.session,
          activityId: input.activityId,
          operation: "ATTACHMENT_WRITE",
        });
        const [expense] =
          await transaction`select id from expenses where id = ${input.expenseId} and activity_id = ${input.activityId} and deleted_at is null for update`;
        if (!expense)
          throw new ApplicationError(
            "EXPENSE_NOT_FOUND",
            "消费不存在或你无权查看。",
            404,
          );
        const [existing] = await transaction<
          AttachmentRow[]
        >`select id, safe_filename, mime_type, width, height, byte_size, sha256, created_at from expense_attachments where expense_id = ${input.expenseId} and client_attachment_id = ${input.clientAttachmentId}`;
        if (existing)
          return {
            attachment: this.serialize(existing),
            idempotentReplay: true,
          };
        const [{ count }] = await transaction<
          { count: string }[]
        >`select count(*) from expense_attachments where expense_id = ${input.expenseId}`;
        if (Number(count) >= 3)
          throw new ApplicationError(
            "ATTACHMENT_LIMIT_REACHED",
            "每笔消费最多上传 3 张图片。",
            422,
          );
        const image = await processAttachmentImage(
          input.bytes,
          input.declaredMime,
        );
        const id = randomUUID();
        const storageKey = `${input.activityId}/${input.expenseId}/${id}.webp`;
        writtenStorageKey = storageKey;
        await this.store.write(storageKey, image.bytes);
        const [attachment] = await transaction<
          AttachmentRow[]
        >`insert into expense_attachments (id, expense_id, client_attachment_id, storage_key, safe_filename, mime_type, width, height, byte_size, sha256)
          values (${id}, ${input.expenseId}, ${input.clientAttachmentId}, ${storageKey}, ${`${id}.webp`}, ${image.mimeType}, ${image.width}, ${image.height}, ${image.byteSize}, ${image.sha256})
          returning id, safe_filename, mime_type, width, height, byte_size, sha256, created_at`;
        return {
          attachment: this.serialize(attachment!),
          idempotentReplay: false,
        };
      });
    } catch (error) {
      if (writtenStorageKey)
        await this.store.remove(writtenStorageKey).catch(() => undefined);
      throw error;
    }
  }

  async download(
    session: { readonly user: { readonly id: string } } | null,
    activityId: string,
    expenseId: string,
    attachmentId: string,
  ) {
    return this.sql.begin(async (transaction) => {
      await authorizeActivityOperation(transaction, {
        session,
        activityId,
        operation: "ATTACHMENT_READ",
      });
      const [attachment] =
        await transaction`select attachment.id, attachment.storage_key, attachment.safe_filename, attachment.mime_type
        from expense_attachments attachment join expenses expense on expense.id = attachment.expense_id
        where attachment.id = ${attachmentId} and attachment.expense_id = ${expenseId} and expense.activity_id = ${activityId} and expense.deleted_at is null`;
      if (!attachment)
        throw new ApplicationError(
          "ATTACHMENT_NOT_FOUND",
          "附件不存在或你无权查看。",
          404,
        );
      return {
        id: attachment.id,
        filename: attachment.safe_filename,
        mimeType: attachment.mime_type,
        bytes: await this.store.read(attachment.storage_key),
      };
    });
  }

  private serialize(row: AttachmentRow) {
    return {
      id: row.id,
      filename: row.safe_filename,
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
      byteSize: row.byte_size,
      sha256: row.sha256,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    };
  }
}
