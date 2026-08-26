import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * 恢复维护闸门是运行态协调数据，不属于任何备份的业务事实。它不引用用户或活动，确保完整
 * pg_restore 可以保留该单例而不阻塞其他表的清理和重建。
 */
export const maintenanceState = pgTable("maintenance_state", {
  id: text("id").primaryKey().default("singleton"),
  active: boolean("active").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
