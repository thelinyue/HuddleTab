import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const activityStatus = pgEnum("activity_status", [
  "ACTIVE",
  "ENDED",
  "ARCHIVED",
]);
export const activityRole = pgEnum("activity_role", [
  "OWNER",
  "ADMIN",
  "MEMBER",
]);
export const memberStatus = pgEnum("member_status", ["ACTIVE", "LEFT"]);
export const memberType = pgEnum("member_type", ["USER", "GUEST"]);
export const inviteMode = pgEnum("invite_mode", [
  "DIRECT_JOIN",
  "REQUIRE_APPROVAL",
]);

/**
 * 活动由其首位成员拥有。ownerMemberId 的同活动循环外键仅在迁移 SQL 中声明，
 * 使其能以 deferred 事务原子创建活动与初始 Owner。
 */
export const activities = pgTable("activities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  location: text("location"),
  baseCurrency: text("base_currency").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  status: activityStatus("status").notNull().default("ACTIVE"),
  ownerMemberId: text("owner_member_id").notNull(),
  inviteMode: inviteMode("invite_mode").notNull().default("DIRECT_JOIN"),
  revision: bigint("revision", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
});

/**
 * ActivityMember 是活动内唯一的记账身份；userId 可为空以承载访客，
 * 因此不能以用户账户替代成员身份参与活动内关联。
 */
export const activityMembers = pgTable(
  "activity_members",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    displayName: text("display_name").notNull(),
    memberType: memberType("member_type").notNull(),
    role: activityRole("role").notNull(),
    status: memberStatus("status").notNull().default("ACTIVE"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("activity_members_activity_user_uq").on(
      table.activityId,
      table.userId,
    ),
    index("activity_members_activity_idx").on(table.activityId),
  ],
);

/** 活动邀请码只保存不可逆的哈希值，原始令牌不会落库。 */
export const activityInviteTokens = pgTable("activity_invite_tokens", {
  id: text("id").primaryKey(),
  activityId: text("activity_id")
    .notNull()
    .references(() => activities.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  createdByMemberId: text("created_by_member_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userActivityPreferences = pgTable(
  "user_activity_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id),
    lastCategory: text("last_category"),
    recentParticipantIds: jsonb("recent_participant_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    recentPayerIds: jsonb("recent_payer_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    recentCurrency: text("recent_currency"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_activity_preferences_user_activity_uq").on(
      table.userId,
      table.activityId,
    ),
  ],
);

export const activityAuditLogs = pgTable("activity_audit_logs", {
  id: text("id").primaryKey(),
  activityId: text("activity_id")
    .notNull()
    .references(() => activities.id),
  actorUserId: text("actor_user_id").references(() => users.id),
  actorMemberId: text("actor_member_id"),
  eventType: text("event_type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  recipientUserId: text("recipient_user_id")
    .notNull()
    .references(() => users.id),
  type: text("type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  payload: jsonb("payload")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
