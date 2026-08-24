import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const emailKind = pgEnum("email_kind", ["SYNTHETIC", "REAL"]);
export const registrationPolicy = pgEnum("registration_policy", [
  "INVITE_ONLY",
  "OPEN",
]);
export const systemRole = pgEnum("system_role", ["system_admin"]);
export const themePreference = pgEnum("theme_preference", [
  "SYSTEM",
  "LIGHT",
  "DARK",
]);

/**
 * 业务侧用户资料与认证用户一一对应。
 * username_normalized 的数据库唯一索引是用户名大小写归一化策略最终的并发安全边界。
 */
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    usernameNormalized: text("username_normalized").notNull(),
    nickname: text("nickname").notNull(),
    emailKind: emailKind("email_kind").notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    themePreference: themePreference("theme_preference")
      .notNull()
      .default("SYSTEM"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_profiles_username_uq").on(table.usernameNormalized),
  ],
);

/** 系统权限独立于认证账户，复合主键确保一个用户不会重复获授同一系统角色。 */
export const systemRoles = pgTable(
  "system_roles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: systemRole("role").notNull(),
    grantedByUserId: text("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

/**
 * 全局设置固定使用 singleton 主键，保证部署和并发启动时只有一条权威设置记录。
 * 首次迁移的幂等 seed 由 seedSystemSingletons 和迁移末尾 SQL 共同表达。
 */
export const systemSettings = pgTable("system_settings", {
  id: text("id").primaryKey().default("singleton"),
  registrationPolicy: registrationPolicy("registration_policy")
    .notNull()
    .default("INVITE_ONLY"),
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

/** 系统初始化凭据和完成状态与可变系统设置分离，便于设置流程单独演进。 */
export const systemBootstrap = pgTable("system_bootstrap", {
  id: text("id").primaryKey().default("singleton"),
  setupTokenHash: text("setup_token_hash"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * 限流桶以窗口开始时间区分同一 key 的不同窗口，过期索引用于后台高效回收。
 */
export const securityRateLimitBuckets = pgTable(
  "security_rate_limit_buckets",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bucketKey, table.windowStartedAt] }),
    index("rate_limit_expiry_idx").on(table.expiresAt),
  ],
);

/** 供应用启动或测试复用的幂等 singleton 初始化 SQL。 */
export const seedSystemSingletons = sql`
  insert into system_settings (id) values ('singleton') on conflict do nothing;
  insert into system_bootstrap (id) values ('singleton') on conflict do nothing;
`;
