import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { activities, activityMembers } from "./activity";
import { users } from "./auth";

export const expenseCategory = pgEnum("expense_category", [
  "FOOD",
  "TRANSPORT",
  "LODGING",
  "TICKET",
  "SHOPPING",
  "ENTERTAINMENT",
  "OTHER",
]);
export const expenseSplitMode = pgEnum("expense_split_mode", [
  "EQUAL",
  "EXACT",
  "PERCENTAGE",
  "WEIGHT",
]);

/**
 * Expense 记录创建时不可变的金额、汇率和分摊快照。Ledger 只读取这些事实，
 * 绝不将计算后的余额写回可编辑列。
 */
export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    category: expenseCategory("category").notNull(),
    originalCurrency: text("original_currency").notNull(),
    originalAmountMinor: bigint("original_amount_minor", {
      mode: "bigint",
    }).notNull(),
    baseCurrency: text("base_currency").notNull(),
    baseAmountMinor: bigint("base_amount_minor", { mode: "bigint" }).notNull(),
    exchangeRate: numeric("exchange_rate").notNull(),
    exchangeRateSource: text("exchange_rate_source").notNull(),
    exchangeRateAt: timestamp("exchange_rate_at", {
      withTimezone: true,
    }).notNull(),
    splitMode: expenseSplitMode("split_mode").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    note: text("note"),
    createdByMemberId: text("created_by_member_id")
      .notNull()
      .references(() => activityMembers.id, { onDelete: "restrict" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    clientMutationId: text("client_mutation_id").notNull(),
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
    uniqueIndex("expenses_creator_mutation_uq").on(
      table.createdByUserId,
      table.clientMutationId,
    ),
    index("expenses_activity_occurred_idx").on(
      table.activityId,
      table.occurredAt,
    ),
    check("expenses_original_positive", sql`${table.originalAmountMinor} > 0`),
    check("expenses_base_positive", sql`${table.baseAmountMinor} > 0`),
    check("expenses_version_positive", sql`${table.version} >= 1`),
  ],
);

export const expensePayments = pgTable(
  "expense_payments",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    activityMemberId: text("activity_member_id")
      .notNull()
      .references(() => activityMembers.id, { onDelete: "restrict" }),
    originalAmountMinor: bigint("original_amount_minor", {
      mode: "bigint",
    }).notNull(),
    baseAmountMinor: bigint("base_amount_minor", { mode: "bigint" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.expenseId, table.activityMemberId] }),
    check(
      "expense_payment_original_positive",
      sql`${table.originalAmountMinor} > 0`,
    ),
    check(
      "expense_payment_base_nonnegative",
      sql`${table.baseAmountMinor} >= 0`,
    ),
  ],
);

export const expenseShares = pgTable(
  "expense_shares",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    activityMemberId: text("activity_member_id")
      .notNull()
      .references(() => activityMembers.id, { onDelete: "restrict" }),
    splitInputMinor: bigint("split_input_minor", { mode: "bigint" }),
    originalAmountMinor: bigint("original_amount_minor", {
      mode: "bigint",
    }).notNull(),
    baseAmountMinor: bigint("base_amount_minor", { mode: "bigint" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.expenseId, table.activityMemberId] }),
    check(
      "expense_share_original_nonnegative",
      sql`${table.originalAmountMinor} >= 0`,
    ),
    check("expense_share_base_nonnegative", sql`${table.baseAmountMinor} >= 0`),
  ],
);
