import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

export const backupStatus = pgEnum("backup_status", [
  "READY",
  "RESTORING",
  "FAILED",
]);

/**
 * 备份记录只保存归档的受控本地路径与校验元数据，绝不把归档二进制写入数据库。
 * 归档文件本身始终位于 DATA_DIR/backups，由 BackupService 做路径边界校验。
 */
export const backupRecords = pgTable(
  "backup_records",
  {
    id: text("id").primaryKey(),
    status: backupStatus("status").notNull().default("READY"),
    storagePath: text("storage_path").notNull(),
    filename: text("filename").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    checksum: text("checksum").notNull(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("backup_records_created_at_idx").on(table.createdAt)],
);
