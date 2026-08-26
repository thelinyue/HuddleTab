import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { activities, activityMembers } from "./activity";

/**
 * Settlement 只保存现实中已发生的转账事实，不保存余额或推荐方案。收付款成员均
 * 通过迁移中的同活动复合外键约束，避免跨活动的账务身份被写入。
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    payerMemberId: text("payer_member_id")
      .notNull()
      .references(() => activityMembers.id, { onDelete: "restrict" }),
    receiverMemberId: text("receiver_member_id")
      .notNull()
      .references(() => activityMembers.id, { onDelete: "restrict" }),
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    note: text("note"),
    createdByMemberId: text("created_by_member_id")
      .notNull()
      .references(() => activityMembers.id, { onDelete: "restrict" }),
    version: bigint("version", { mode: "number" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByMemberId: text("deleted_by_member_id").references(
      () => activityMembers.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    index("settlements_activity_occurred_idx").on(
      table.activityId,
      table.occurredAt,
    ),
    check("settlements_amount_positive", sql`${table.amountMinor} > 0`),
    check(
      "settlements_distinct_members",
      sql`${table.payerMemberId} <> ${table.receiverMemberId}`,
    ),
    check("settlements_version_positive", sql`${table.version} >= 1`),
  ],
);
