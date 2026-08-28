import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

/** 产品档案保存用户名与展示偏好；认证邮箱只通过 Compatibility Layer 访问。 */
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    usernameNormalized: text("username_normalized").notNull(),
    nickname: text("nickname").notNull(),
    emailKind: emailKind("email_kind").notNull(),
    avatarPreset: integer("avatar_preset"),
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
    check(
      "user_profiles_avatar_preset_check",
      sql`${table.avatarPreset} between 1 and 6`,
    ),
  ],
);

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

export const systemSettings = pgTable("system_settings", {
  id: text("id").primaryKey().default("singleton"),
  registrationPolicy: registrationPolicy("registration_policy")
    .notNull()
    .default("INVITE_ONLY"),
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  smtpEnabled: boolean("smtp_enabled").notNull().default(false),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUsername: text("smtp_username"),
  smtpPasswordEncrypted: text("smtp_password_encrypted"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

export const systemBootstrap = pgTable("system_bootstrap", {
  id: text("id").primaryKey().default("singleton"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/** 安全限流只保存服务端派生后的桶键，避免持久化密码或明文 Token。 */
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
