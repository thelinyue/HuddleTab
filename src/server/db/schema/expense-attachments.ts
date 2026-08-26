import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { expenses } from "./expenses";

/**
 * ExpenseAttachment 只保存经过服务端重编码后的私有文件元数据，绝不保存公开 URL。
 * clientAttachmentId 与 Expense 共同组成离线附件重试幂等键；storageKey 仅供受控
 * 本地存储层使用，任何 HTTP 响应都不得泄露它。
 */
export const expenseAttachments = pgTable(
  "expense_attachments",
  {
    id: uuid("id").primaryKey(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    clientAttachmentId: uuid("client_attachment_id").notNull(),
    storageKey: text("storage_key").notNull(),
    safeFilename: text("safe_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    // 上传上限为 10MB，integer 足够表达并能避免浏览器与 Node 的 bigint 序列化分歧。
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("expense_attachments_expense_client_uq").on(
      table.expenseId,
      table.clientAttachmentId,
    ),
    uniqueIndex("expense_attachments_storage_key_uq").on(table.storageKey),
  ],
);
