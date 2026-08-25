# HuddleTab Phase 2 Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver username-first Better Auth sessions, optional-email compatibility, registration policy, one-time setup bootstrap, and transaction-enforced System Admin safety.

**Architecture:** Let Better Auth own user credentials, accounts, sessions, and HttpOnly cookies through its Drizzle adapter and username plugin. Keep product profile/system policy in HuddleTab tables, adapt missing email to a hidden synthetic identity, and enforce setup/admin invariants in server services backed by PostgreSQL transactions.

**Tech Stack:** Better Auth, Better Auth username plugin, Drizzle ORM, PostgreSQL 18, Next.js Route Handlers, Zod, Vitest, Testcontainers.

---

## File responsibility map

```text
src/server/db/schema/auth.ts                    Better Auth user/session/account/verification tables
src/server/db/schema/system.ts                  profiles, roles, settings, bootstrap, rate-limit buckets
src/server/errors/application-error.ts          stable code + Chinese message + HTTP status
src/server/auth/username.ts                      username normalization/validation
src/server/auth/synthetic-email.ts               hidden synthetic email creation and classification
src/server/auth/auth.ts                          Better Auth Drizzle adapter and username plugin config
src/server/auth/session.ts                       server-side Session lookup helper
src/server/auth/registration-gate.ts             OPEN / INVITE_ONLY admission decision
src/server/services/registration-service.ts      username-first registration compatibility use case
src/server/services/setup-service.ts             token rotation and first-admin claim
src/server/services/system-admin-service.ts      LAST_ACTIVE_ADMIN transaction invariant
src/server/bootstrap/initialize-setup.ts          uninitialized-start token generation and one log emission
src/app/api/auth/[...all]/route.ts                Better Auth handler
src/app/api/auth/register/route.ts                product registration endpoint
src/app/api/setup/route.ts                        setup status and first-admin claim
tests/support/postgres.ts                         shared ephemeral PostgreSQL 18 harness
tests/unit/auth/**, tests/integration/auth/**     behavior and transaction tests
```

## Locked names and cross-phase contracts

- Better Auth `user`, `session`, `account`, and `verification` remain credential/session authority; no Access Token + Refresh Token subsystem is added.
- `userProfiles.usernameNormalized` is the product-level globally unique username; the Better Auth username plugin receives the same normalized value.
- `EmailKind = "SYNTHETIC" | "REAL"`; synthetic addresses match `u_<uuid-without-dashes>@local.invalid`, are never returned by profile DTOs, and never enter mail jobs.
- `RegistrationPolicy = "INVITE_ONLY" | "OPEN"`, default `INVITE_ONLY`.
- Phase 2 defines `InvitationRegistrationVerifier`; Phase 3 supplies the activity-invitation implementation. Until then, INVITE_ONLY registration rejects non-setup registration with `REGISTRATION_INVITE_REQUIRED`.
- `ApplicationError` is reused by Phase 3 and later plans.
- A login-capable System Admin means: profile not disabled, `system_admin` role present, and a Better Auth credential account with a non-null password.

### Task 1: Add authentication/system schema and shared integration harness

**Files:**

- Create: `src/server/db/schema/auth.ts`
- Create: `src/server/db/schema/system.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `tests/support/postgres.ts`
- Create: `tests/integration/auth/auth-schema.test.ts`
- Create: `drizzle/0001_auth_system.sql` through `npm run db:generate`

- [ ] **Step 1: Write the failing integration test**

```ts
// tests/integration/auth/auth-schema.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";

describe("auth schema", () => {
  let harness: PostgresHarness;
  beforeAll(async () => {
    harness = await startPostgres();
  });
  afterAll(async () => {
    await harness.stop();
  });

  it("defaults registration to INVITE_ONLY and keeps username globally unique", async () => {
    const setting =
      await harness.sql`select registration_policy from system_settings where id = 'singleton'`;
    expect(setting[0].registration_policy).toBe("INVITE_ONLY");
    await harness.sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values ('u1', '甲', 'u_1@local.invalid', false, now(), now()),
             ('u2', '乙', 'u_2@local.invalid', false, now(), now())`;
    await harness.sql`insert into user_profiles (user_id, username_normalized, nickname, email_kind, created_at, updated_at)
      values ('u1', 'alice', '甲', 'SYNTHETIC', now(), now())`;
    await expect(harness.sql`insert into user_profiles (user_id, username_normalized, nickname, email_kind, created_at, updated_at)
      values ('u2', 'alice', '乙', 'SYNTHETIC', now(), now())`).rejects.toMatchObject(
      { code: "23505" },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/integration/auth/auth-schema.test.ts`

Expected: FAIL because `tests/support/postgres.ts` and the auth tables do not exist.

- [ ] **Step 3: Write the minimal schema and harness**

```ts
// src/server/db/schema/auth.ts
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  username: text("username").unique(),
  displayUsername: text("display_username"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accounts = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

```ts
// src/server/db/schema/system.ts
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
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

export const systemBootstrap = pgTable("system_bootstrap", {
  id: text("id").primaryKey().default("singleton"),
  setupTokenHash: text("setup_token_hash"),
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

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

export const seedSystemSingletons = sql`
  insert into system_settings (id) values ('singleton') on conflict do nothing;
  insert into system_bootstrap (id) values ('singleton') on conflict do nothing;
`;
```

```ts
// src/server/db/schema/index.ts
export * from "./auth";
export * from "./system";
```

```ts
// tests/support/postgres.ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";

export interface PostgresHarness {
  sql: ReturnType<typeof postgres>;
  stop(): Promise<void>;
}

export async function startPostgres(): Promise<PostgresHarness> {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const sql = postgres(container.getConnectionUri(), { max: 1 });
  await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
  return {
    sql,
    stop: async () => {
      await sql.end();
      await container.stop();
    },
  };
}
```

Run:

```bash
npm install postgres
npm run db:generate
```

Then append this exact seed SQL to the generated migration:

```sql
insert into system_settings (id) values ('singleton') on conflict do nothing;
insert into system_bootstrap (id) values ('singleton') on conflict do nothing;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- tests/integration/auth/auth-schema.test.ts`

Expected: PASS; duplicate normalized username fails with PostgreSQL `23505`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/server/db/schema tests/support/postgres.ts tests/integration/auth/auth-schema.test.ts drizzle
git commit -m "feat: add authentication system schema"
```

### Task 2: Configure Better Auth with username and Synthetic Email compatibility

**Files:**

- Create: `src/server/errors/application-error.ts`
- Create: `src/server/auth/username.ts`
- Create: `src/server/auth/synthetic-email.ts`
- Create: `src/server/auth/auth.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Create: `tests/unit/auth/compatibility.test.ts`

- [ ] **Step 1: Write the failing compatibility test**

```ts
// tests/unit/auth/compatibility.test.ts
import { describe, expect, it } from "vitest";
import { normalizeUsername } from "@/server/auth/username";
import {
  createSyntheticEmail,
  isSyntheticEmail,
} from "@/server/auth/synthetic-email";

describe("auth compatibility", () => {
  it("normalizes one canonical username for profile and Better Auth", () => {
    expect(normalizeUsername("  Alice_01  ")).toBe("alice_01");
    expect(() => normalizeUsername("a@b")).toThrow("用户名不能包含空白或 @");
  });

  it("creates an internal non-deliverable identity", () => {
    const email = createSyntheticEmail("018f1f67-5b1e-7f41-b0d1-3a013d9c9001");
    expect(email).toBe("u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid");
    expect(isSyntheticEmail(email)).toBe(true);
    expect(isSyntheticEmail("real@example.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/auth/compatibility.test.ts`

Expected: FAIL with missing `username` and `synthetic-email` modules.

- [ ] **Step 3: Write the minimal implementation and Better Auth config**

```ts
// src/server/errors/application-error.ts
export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
```

```ts
// src/server/auth/username.ts
import { ApplicationError } from "@/server/errors/application-error";

/** NFKC + lower-case 是全局唯一判断的唯一入口，显示昵称不参与唯一性。 */
export function normalizeUsername(input: string): string {
  const value = input.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (value.length < 3 || value.length > 32)
    throw new ApplicationError(
      "INVALID_USERNAME",
      "用户名长度必须为 3 到 32 个字符。",
      422,
    );
  if (/\s|@/.test(value))
    throw new ApplicationError(
      "INVALID_USERNAME",
      "用户名不能包含空白或 @。",
      422,
    );
  return value;
}
```

```ts
// src/server/auth/synthetic-email.ts
export type EmailKind = "SYNTHETIC" | "REAL";
const SYNTHETIC = /^u_[0-9a-f]{32}@local\.invalid$/;

/** 该地址仅满足认证存储兼容，不可投递、不可展示、不可触发邮件。 */
export function createSyntheticEmail(id: string): string {
  const compact = id.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact))
    throw new Error("生成内部邮箱时收到无效标识");
  return `u_${compact}@local.invalid`;
}
export function isSyntheticEmail(email: string): boolean {
  return SYNTHETIC.test(email);
}
```

```ts
// src/server/auth/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { db } from "@/server/db/client";
import * as schema from "@/server/db/schema";
import { normalizeUsername } from "./username";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true, requireEmailVerification: false },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 32,
      usernameValidator: (value) => {
        try {
          return normalizeUsername(value) === value;
        } catch {
          return false;
        }
      },
    }),
  ],
});
```

```ts
// src/app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";
export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/auth/compatibility.test.ts`

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/errors src/server/auth src/app/api/auth tests/unit/auth/compatibility.test.ts
git commit -m "feat: configure username-first Better Auth"
```

### Task 3: Enforce registration policy in the username-first registration service

**Files:**

- Create: `src/server/auth/registration-gate.ts`
- Create: `src/server/services/registration-service.ts`
- Create: `src/server/validation/auth.ts`
- Create: `src/app/api/auth/register/route.ts`
- Create: `tests/unit/auth/registration-gate.test.ts`
- Create: `tests/integration/auth/registration-service.test.ts`

- [ ] **Step 1: Write the failing policy test**

```ts
// tests/unit/auth/registration-gate.test.ts
import { describe, expect, it, vi } from "vitest";
import { assertRegistrationAllowed } from "@/server/auth/registration-gate";

describe("registration gate", () => {
  it("allows OPEN and delegates INVITE_ONLY to Phase 3 verifier", async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(true) };
    await expect(
      assertRegistrationAllowed("OPEN", undefined, verifier),
    ).resolves.toBeUndefined();
    await expect(
      assertRegistrationAllowed("INVITE_ONLY", "proof", verifier),
    ).resolves.toBeUndefined();
    expect(verifier.verify).toHaveBeenCalledWith("proof");
  });

  it("rejects missing invite proof with a stable Chinese error", async () => {
    await expect(
      assertRegistrationAllowed("INVITE_ONLY", undefined, {
        verify: async () => false,
      }),
    ).rejects.toMatchObject({
      code: "REGISTRATION_INVITE_REQUIRED",
      status: 403,
      message: "当前系统仅允许受邀用户注册。",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/auth/registration-gate.test.ts`

Expected: FAIL because `registration-gate` does not exist.

- [ ] **Step 3: Implement gate, service, schema, and route**

```ts
// src/server/auth/registration-gate.ts
import { ApplicationError } from "@/server/errors/application-error";
export type RegistrationPolicy = "INVITE_ONLY" | "OPEN";
export interface InvitationRegistrationVerifier {
  verify(proof: string): Promise<boolean>;
}

export async function assertRegistrationAllowed(
  policy: RegistrationPolicy,
  proof: string | undefined,
  verifier: InvitationRegistrationVerifier,
): Promise<void> {
  if (policy === "OPEN") return;
  if (!proof || !(await verifier.verify(proof))) {
    throw new ApplicationError(
      "REGISTRATION_INVITE_REQUIRED",
      "当前系统仅允许受邀用户注册。",
      403,
    );
  }
}
```

```ts
// src/server/validation/auth.ts
import { z } from "zod";
export const registerInput = z.object({
  username: z.string(),
  password: z.string().min(8).max(128),
  nickname: z.string().trim().min(1).max(40),
  email: z.string().email().optional(),
  inviteProof: z.string().min(1).optional(),
});
```

```ts
// src/server/services/registration-service.ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth/auth";
import {
  assertRegistrationAllowed,
  type InvitationRegistrationVerifier,
} from "@/server/auth/registration-gate";
import { createSyntheticEmail } from "@/server/auth/synthetic-email";
import { normalizeUsername } from "@/server/auth/username";
import { db } from "@/server/db/client";
import { systemSettings, userProfiles } from "@/server/db/schema";

export class RegistrationService {
  constructor(
    private readonly inviteVerifier: InvitationRegistrationVerifier,
  ) {}

  /**
   * 前端始终提交 username；只有本兼容层知道 Better Auth 的 emailAndPassword 入口。
   * Profile 写入失败时删除刚创建的认证用户，避免留下无法完成注册的孤儿账号。
   */
  async register(input: {
    username: string;
    password: string;
    nickname: string;
    email?: string;
    inviteProof?: string;
  }) {
    const [settings] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.id, "singleton"));
    await assertRegistrationAllowed(
      settings.registrationPolicy,
      input.inviteProof,
      this.inviteVerifier,
    );
    const normalized = normalizeUsername(input.username);
    const email =
      input.email?.trim().toLowerCase() ?? createSyntheticEmail(randomUUID());
    const created = await auth.api.signUpEmail({
      body: {
        email,
        password: input.password,
        name: input.nickname,
        username: normalized,
        displayUsername: input.username.trim(),
      },
    });
    try {
      await db.insert(userProfiles).values({
        userId: created.user.id,
        usernameNormalized: normalized,
        nickname: input.nickname,
        emailKind: input.email ? "REAL" : "SYNTHETIC",
      });
    } catch (error) {
      await auth.api
        .deleteUser({
          body: { callbackURL: "/" },
          headers: new Headers({
            "x-user-id-for-compensation": created.user.id,
          }),
        })
        .catch(() => undefined);
      throw error;
    }
    return {
      id: created.user.id,
      username: normalized,
      nickname: input.nickname,
    };
  }
}
```

```ts
// src/app/api/auth/register/route.ts
import { NextResponse } from "next/server";
import { registerInput } from "@/server/validation/auth";
import { RegistrationService } from "@/server/services/registration-service";

const rejectingVerifier = { verify: async () => false };
export async function POST(request: Request) {
  const input = registerInput.parse(await request.json());
  const data = await new RegistrationService(rejectingVerifier).register(input);
  return NextResponse.json({ data }, { status: 201 });
}
```

Create `tests/integration/auth/registration-service.test.ts`:

```ts
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { RegistrationService } from "@/server/services/registration-service";
import { auth } from "@/server/auth/auth";

let h: PostgresHarness;
beforeAll(async () => {
  h = await startPostgres();
  await h.sql`update system_settings set registration_policy=''OPEN'' where id=''singleton''`;
  vi.spyOn(auth.api, "signUpEmail").mockResolvedValue({
    user: { id: "new-user" },
  } as never);
  await h.seedCredentialUser(
    "new-user",
    "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid",
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await h.stop();
});

it("stores a synthetic profile but never returns its internal email", async () => {
  const result = await new RegistrationService({
    verify: async () => false,
  }).register({
    username: "Alice",
    password: "password-123",
    nickname: "小艾",
  });
  const [profile] =
    await h.sql`select email_kind from user_profiles where user_id=''new-user''`;
  expect(profile.email_kind).toBe("SYNTHETIC");
  expect(result).toEqual({
    id: "new-user",
    username: "alice",
    nickname: "小艾",
  });
  expect(result).not.toHaveProperty("email");
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm run test:unit -- tests/unit/auth/registration-gate.test.ts
npm run test:integration -- tests/integration/auth/registration-service.test.ts
```

Expected: PASS; INVITE_ONLY rejects without proof and OPEN writes a hidden synthetic identity profile.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/registration-gate.ts src/server/services/registration-service.ts src/server/validation/auth.ts src/app/api/auth/register tests/unit/auth/registration-gate.test.ts tests/integration/auth/registration-service.test.ts
git commit -m "feat: enforce username registration policy"
```

### Task 4: Rotate the Setup Token on every uninitialized container start

**Files:**

- Create: `src/server/services/setup-service.ts`
- Create: `src/server/bootstrap/initialize-setup.ts`
- Create: `src/server/bootstrap/container-start.ts`
- Create: `src/app/api/setup/route.ts`
- Modify: `package.json`
- Modify: `Dockerfile`
- Create: `tests/integration/auth/setup-service.test.ts`

- [ ] **Step 1: Write the failing setup test**

```ts
// tests/integration/auth/setup-service.test.ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { SetupService } from "@/server/services/setup-service";

describe("SetupService", () => {
  let harness: PostgresHarness;
  beforeAll(async () => {
    harness = await startPostgres();
  });
  afterAll(async () => {
    await harness.stop();
  });

  it("replaces the previous hash on restart and never stores plaintext", async () => {
    const service = new SetupService(harness.sql, vi.fn());
    const first = await service.rotateForUninitializedStartup();
    const second = await service.rotateForUninitializedStartup();
    const rows =
      await harness.sql`select setup_token_hash from system_bootstrap where id = 'singleton'`;
    expect(first).not.toBe(second);
    expect(rows[0].setup_token_hash).not.toContain(second);
    await expect(
      service.claim(first!, {
        username: "owner",
        password: "password-123",
        nickname: "Owner",
      }),
    ).rejects.toMatchObject({ code: "INVALID_SETUP_TOKEN" });
  });

  it("creates the first admin once and permanently closes setup", async () => {
    const createUser = vi.fn().mockResolvedValue({ userId: "admin-1" });
    const service = new SetupService(harness.sql, createUser);
    const token = await service.rotateForUninitializedStartup();
    await service.claim(token!, {
      username: "owner",
      password: "password-123",
      nickname: "Owner",
    });
    expect(await service.rotateForUninitializedStartup()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/integration/auth/setup-service.test.ts`

Expected: FAIL because `SetupService` does not exist.

- [ ] **Step 3: Implement token rotation, claim, and startup logging**

```ts
// src/server/services/setup-service.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";
import { ApplicationError } from "@/server/errors/application-error";

const digest = (token: string): Buffer =>
  createHash("sha256").update(token, "utf8").digest();
export interface SetupCredentialCreator {
  create(input: {
    username: string;
    password: string;
    nickname: string;
  }): Promise<{ userId: string }>;
  compensate(userId: string): Promise<void>;
}

export class SetupService {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly credentials: SetupCredentialCreator,
  ) {}

  /**
   * PostgreSQL 事务级 advisory lock 保证单 App 实例内不会并发生成两个有效 Token。
   * 未初始化重启会替换旧 Hash；明文只作为返回值交给容器启动器打印一次。
   */
  async rotateForUninitializedStartup(): Promise<string | null> {
    return this.sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('huddletab-setup'))`;
      const admins =
        await tx`select 1 from system_roles where role = 'system_admin' limit 1`;
      if (admins.length > 0) {
        await tx`update system_bootstrap set setup_token_hash = null, completed_at = coalesce(completed_at, now()) where id = 'singleton'`;
        return null;
      }
      const token = randomBytes(32).toString("base64url");
      await tx`update system_bootstrap set setup_token_hash = ${digest(token).toString("base64url")}, generated_at = now(), completed_at = null where id = 'singleton'`;
      return token;
    });
  }

  async claim(
    token: string,
    input: { username: string; password: string; nickname: string },
  ): Promise<void> {
    let createdUserId: string | undefined;
    try {
      await this.sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext('huddletab-setup'))`;
        const [row] =
          await tx`select setup_token_hash, completed_at from system_bootstrap where id = 'singleton' for update`;
        const supplied = digest(token);
        const stored = row?.setup_token_hash
          ? Buffer.from(row.setup_token_hash, "base64url")
          : Buffer.alloc(0);
        if (
          row?.completed_at ||
          stored.length !== supplied.length ||
          !timingSafeEqual(stored, supplied)
        ) {
          throw new ApplicationError(
            "INVALID_SETUP_TOKEN",
            "初始化口令无效或已失效。",
            403,
          );
        }
        const created = await this.credentials.create(input);
        createdUserId = created.userId;
        await tx`insert into system_roles (user_id, role, granted_at) values (${created.userId}, 'system_admin', now())`;
        await tx`update system_bootstrap set setup_token_hash = null, completed_at = now() where id = 'singleton'`;
      });
    } catch (error) {
      if (createdUserId) {
        await this.credentials
          .compensate(createdUserId)
          .catch((cleanupError) =>
            console.error(
              "首次初始化回滚失败，检测到未完成的凭证账号，请管理员检查后重试",
              cleanupError,
            ),
          );
      }
      throw error;
    }
  }
}
```

```ts
// src/server/bootstrap/initialize-setup.ts
import { sql } from "@/server/db/client";
import { createSetupCredentialUser } from "@/server/services/registration-service";
import { SetupService } from "@/server/services/setup-service";

export async function initializeSetup(): Promise<void> {
  const token = await new SetupService(
    sql,
    createSetupCredentialUser,
  ).rotateForUninitializedStartup();
  if (token) {
    console.warn(
      "伙记尚未初始化。Setup Token 仅在本次容器启动输出一次，请仅由部署管理员查看：%s",
      token,
    );
  }
}
```

```ts
// src/server/bootstrap/container-start.ts
import { spawn } from "node:child_process";
import { initializeSetup } from "./initialize-setup";

await initializeSetup();
const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "5660"],
  {
    stdio: "inherit",
    env: process.env,
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
```

```ts
// src/app/api/setup/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/server/db/client";
import { SetupService } from "@/server/services/setup-service";
import { createSetupCredentialUser } from "@/server/services/registration-service";
const setupInput = z.object({
  setupToken: z.string().min(20),
  username: z.string(),
  password: z.string().min(8),
  nickname: z.string().min(1),
});

export async function GET() {
  const [row] =
    await sql`select completed_at from system_bootstrap where id = 'singleton'`;
  return NextResponse.json({ data: { setupRequired: !row?.completed_at } });
}
export async function POST(request: Request) {
  const body = setupInput.parse(await request.json());
  await new SetupService(sql, createSetupCredentialUser).claim(
    body.setupToken,
    body,
  );
  return NextResponse.json({ data: { initialized: true } }, { status: 201 });
}
```

Reuse the single `sql` client exported by Phase 0 `src/server/db/client.ts`; do not create a second PostgreSQL connection module. Add `createSetupCredentialUser()` beside `RegistrationService`; it calls `auth.api.signUpEmail` with a synthetic email, writes `user_profiles`, and exposes `compensate(userId)` to remove a credential/profile created before the surrounding Setup transaction fails. This explicit compensation is required because the Better Auth API call is not falsely treated as part of the postgres.js transaction; tests inject a role-write failure and verify no orphan remains. It bypasses only registration policy—not username/password validation. Change `package.json` script to `"start:container": "tsx src/server/bootstrap/container-start.ts"` and Docker `CMD` to `npm run db:migrate && npm run start:container`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- tests/integration/auth/setup-service.test.ts`

Expected: PASS; the first token becomes invalid after rotation, successful claim clears the hash, later starts return `null`, and an injected role-write failure compensates the Better Auth credential/profile without marking setup complete.

- [ ] **Step 5: Commit**

```bash
git add src/server/bootstrap src/server/services/setup-service.ts src/server/services/registration-service.ts src/app/api/setup package.json package-lock.json Dockerfile tests/integration/auth/setup-service.test.ts
git commit -m "feat: add one-time setup bootstrap"
```

### Task 5: Enforce LAST_ACTIVE_ADMIN inside every destructive admin transaction

**Files:**

- Create: `src/server/services/system-admin-service.ts`
- Create: `tests/integration/auth/system-admin-invariant.test.ts`

- [ ] **Step 1: Write the failing invariant test**

```ts
// tests/integration/auth/system-admin-invariant.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { SystemAdminService } from "@/server/services/system-admin-service";

describe("LAST_ACTIVE_ADMIN", () => {
  let harness: PostgresHarness;
  beforeAll(async () => {
    harness = await startPostgres();
  });
  afterAll(async () => {
    await harness.stop();
  });

  it("rejects disabling the final login-capable admin", async () => {
    await harness.seedCredentialAdmin("admin-1");
    const service = new SystemAdminService(harness.sql);
    await expect(service.disableUser("admin-1")).rejects.toMatchObject({
      code: "LAST_ACTIVE_ADMIN",
      status: 409,
      message: "系统必须至少保留一个能够正常登录的系统管理员。",
    });
  });

  it("allows the operation after another login-capable admin exists", async () => {
    await harness.seedCredentialAdmin("admin-2");
    await expect(
      new SystemAdminService(harness.sql).disableUser("admin-1"),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/integration/auth/system-admin-invariant.test.ts`

Expected: FAIL because `SystemAdminService` does not exist.

- [ ] **Step 3: Implement the transaction invariant**

```ts
// src/server/services/system-admin-service.ts
import type postgres from "postgres";
import { ApplicationError } from "@/server/errors/application-error";

export class SystemAdminService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  private async assertAdminRemains(
    tx: postgres.TransactionSql,
    targetUserId: string,
  ): Promise<void> {
    await tx`select pg_advisory_xact_lock(hashtext('huddletab-system-admin-invariant'))`;
    const [row] = await tx`
      select count(distinct sr.user_id)::int as count
      from system_roles sr
      join user_profiles up on up.user_id = sr.user_id and up.disabled_at is null
      join account a on a.user_id = sr.user_id and a.provider_id = 'credential' and a.password is not null
      where sr.role = 'system_admin' and sr.user_id <> ${targetUserId}`;
    if (row.count < 1) {
      throw new ApplicationError(
        "LAST_ACTIVE_ADMIN",
        "系统必须至少保留一个能够正常登录的系统管理员。",
        409,
      );
    }
  }

  async disableUser(userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.assertAdminRemains(tx, userId);
      await tx`update user_profiles set disabled_at = now(), updated_at = now() where user_id = ${userId}`;
      await tx`delete from session where user_id = ${userId}`;
    });
  }

  async revokeSystemAdmin(userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.assertAdminRemains(tx, userId);
      await tx`delete from system_roles where user_id = ${userId} and role = 'system_admin'`;
      await tx`delete from session where user_id = ${userId}`;
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await this.assertAdminRemains(tx, userId);
      await tx`delete from "user" where id = ${userId}`;
    });
  }
}
```

Add this exact method to `PostgresHarness` and the object returned by `startPostgres()`:

```ts
async function seedCredentialAdmin(userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id,name,email,email_verified,created_at,updated_at) values (${userId},${userId},${`${userId}@example.com`},false,now(),now())`;
    await tx`insert into user_profiles (user_id,username_normalized,nickname,email_kind,created_at,updated_at) values (${userId},${userId},${userId},''REAL'',now(),now())`;
    await tx`insert into account (id,account_id,provider_id,user_id,password,created_at,updated_at) values (${`${userId}-credential`},${userId},''credential'',${userId},''test-password-hash'',now(),now())`;
    await tx`insert into system_roles (user_id,role,granted_at) values (${userId},''system_admin'',now())`;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- tests/integration/auth/system-admin-invariant.test.ts`

Expected: PASS; final admin operations return `409 LAST_ACTIVE_ADMIN`, and two-admin operation commits.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/system-admin-service.ts tests/support/postgres.ts tests/integration/auth/system-admin-invariant.test.ts
git commit -m "feat: protect the last active system admin"
```

### Task 6: Add server Session lookup and real-email migration

**Files:**

- Create: `src/server/auth/session.ts`
- Create: `src/server/services/profile-email-service.ts`
- Create: `tests/unit/auth/session.test.ts`
- Create: `tests/integration/auth/profile-email-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/auth/session.test.ts
import { expect, it, vi } from "vitest";
import { requireSession } from "@/server/auth/session";
it("returns 401 when Better Auth has no Session", async () => {
  await expect(
    requireSession(new Headers(), {
      getSession: vi.fn().mockResolvedValue(null),
    }),
  ).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
    status: 401,
    message: "登录状态已失效，请重新登录。",
  });
});
```

```ts
// tests/integration/auth/profile-email-service.test.ts
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ProfileEmailService } from "@/server/services/profile-email-service";
let harness: PostgresHarness;
beforeAll(async () => {
  harness = await startPostgres();
  await harness.seedCredentialUser(
    "user-1",
    "u_018f1f675b1e7f41b0d13a013d9c9001@local.invalid",
  );
});
afterAll(async () => {
  await harness.stop();
});
it("migrates synthetic identity to a real unverified email without exposing the old value", async () => {
  await new ProfileEmailService(harness.sql).bindRealEmail(
    "user-1",
    "Alice@Example.com",
  );
  const [row] =
    await harness.sql`select u.email, u.email_verified, p.email_kind from "user" u join user_profiles p on p.user_id = u.id where u.id = 'user-1'`;
  expect(row).toEqual({
    email: "alice@example.com",
    email_verified: false,
    email_kind: "REAL",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/unit/auth/session.test.ts && npm run test:integration -- tests/integration/auth/profile-email-service.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/server/auth/session.ts
import { auth } from "./auth";
import { ApplicationError } from "@/server/errors/application-error";
export interface SessionReader {
  getSession(input: { headers: Headers }): Promise<unknown>;
}
export async function requireSession(
  headers: Headers,
  reader: SessionReader = auth.api,
): Promise<NonNullable<Awaited<ReturnType<SessionReader["getSession"]>>>> {
  const session = await reader.getSession({ headers });
  if (!session)
    throw new ApplicationError(
      "UNAUTHENTICATED",
      "登录状态已失效，请重新登录。",
      401,
    );
  return session as NonNullable<typeof session>;
}
```

```ts
// src/server/services/profile-email-service.ts
import type postgres from "postgres";
import { ApplicationError } from "@/server/errors/application-error";
export class ProfileEmailService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}
  async bindRealEmail(userId: string, input: string): Promise<void> {
    const email = input.trim().toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.endsWith("@local.invalid")
    ) {
      throw new ApplicationError(
        "INVALID_REAL_EMAIL",
        "请输入可接收邮件的真实邮箱地址。",
        422,
      );
    }
    await this.sql.begin(async (tx) => {
      await tx`update "user" set email = ${email}, email_verified = false, updated_at = now() where id = ${userId}`;
      await tx`update user_profiles set email_kind = 'REAL', updated_at = now() where user_id = ${userId}`;
    });
  }
}
```

Add this exact method to `PostgresHarness` and the returned harness object:

```ts
async function seedCredentialUser(
  userId: string,
  email: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id,name,email,email_verified,created_at,updated_at) values (${userId},${userId},${email},false,now(),now()) on conflict (id) do nothing`;
    await tx`insert into user_profiles (user_id,username_normalized,nickname,email_kind,created_at,updated_at) values (${userId},${userId},${userId},${email.endsWith("@local.invalid") ? "SYNTHETIC" : "REAL"},now(),now()) on conflict (user_id) do nothing`;
    await tx`insert into account (id,account_id,provider_id,user_id,password,created_at,updated_at) values (${`${userId}-credential`},${userId},''credential'',${userId},''test-password-hash'',now(),now()) on conflict (id) do nothing`;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- tests/unit/auth/session.test.ts && npm run test:integration -- tests/integration/auth/profile-email-service.test.ts`

Expected: PASS; missing Session is `401 UNAUTHENTICATED`, and email/profile kind change in one transaction.

- [ ] **Step 5: Commit**

```bash
git add src/server/auth/session.ts src/server/services/profile-email-service.ts tests/support/postgres.ts tests/unit/auth/session.test.ts tests/integration/auth/profile-email-service.test.ts
git commit -m "feat: add session and real email compatibility"
```

### Task 7: Expose the authenticated “Me” boundary without leaking Synthetic Email

**Files:**

- Create: `src/server/services/me-service.ts`
- Create: `src/app/api/me/profile/route.ts`
- Create: `src/app/api/me/email/route.ts`
- Create: `src/app/api/me/password/route.ts`
- Create: `src/app/api/me/sessions/route.ts`
- Create: `src/app/api/me/theme/route.ts`
- Test: `tests/api/me-routes.test.ts`

- [ ] **Step 1: Write failing account-boundary tests**

```ts
it("returns profile and sessions without exposing Synthetic Email", async () => {
  const response = await api.get("/api/me/profile", syntheticUserSession);
  expect(response.status).toBe(200);
  expect(response.json.data).toMatchObject({
    username: "alice",
    nickname: "Alice",
    emailBound: false,
    themePreference: "SYSTEM",
  });
  expect(JSON.stringify(response.json)).not.toContain("@local.invalid");
});

it("revokes one selected session without revoking the current session", async () => {
  const target = await api.seedSecondSession(syntheticUserSession.user.id);
  await expect(
    api.delete(`/api/me/sessions?sessionId=${target.id}`, syntheticUserSession),
  ).resolves.toMatchObject({ status: 204 });
});
```

- [ ] **Step 2: Run tests and verify the routes are absent**

Run: `npm run test:unit -- tests/api/me-routes.test.ts`

Expected: FAIL because `/api/me/*` Route Handlers and `MeService` do not exist.

- [ ] **Step 3: Implement the thin account service and Better Auth delegates**

```ts
export class MeService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async getProfile(userId: string) {
    const [row] = await this
      .sql`select username_normalized,nickname,email_kind,theme_preference from user_profiles where user_id=${userId}`;
    if (!row)
      throw new ApplicationError("PROFILE_NOT_FOUND", "用户资料不存在。", 404);
    return {
      username: row.username_normalized,
      nickname: row.nickname,
      emailBound: row.email_kind === "REAL",
      themePreference: row.theme_preference,
    };
  }

  async updateTheme(
    userId: string,
    theme: "SYSTEM" | "LIGHT" | "DARK",
  ): Promise<void> {
    await this
      .sql`update user_profiles set theme_preference=${theme},updated_at=now() where user_id=${userId}`;
  }

  async updateNickname(userId: string, nickname: string): Promise<void> {
    await this
      .sql`update user_profiles set nickname=${nickname},updated_at=now() where user_id=${userId}`;
  }
}
```

Every route begins with `requireSession()`. Profile/theme use `MeService`; real-email binding uses the existing `ProfileEmailService`; password change and session list/revoke delegate to Better Auth APIs so credential hashing and HttpOnly Session semantics remain owned by Better Auth. Session deletion must scope `sessionId` to the current user. Responses expose `emailBound` and real email only when `email_kind = REAL`; they never return Synthetic Email. Password inputs use correct current/new-password validation and are never logged.

- [ ] **Step 4: Run account API tests**

Run: `npm run test:unit -- tests/api/me-routes.test.ts && npm run test:integration -- tests/integration/auth/profile-email-service.test.ts`

Expected: PASS for nickname, theme, real-email binding, password change, session list/revoke and Synthetic Email redaction.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/me-service.ts src/app/api/me tests/api/me-routes.test.ts
git commit -m "feat: add authenticated account management api"
```

### Task 8: Enforce PostgreSQL-backed multi-identifier rate limits with an explicit proxy boundary

**Files:**

- Create: `src/server/security/client-address.ts`
- Create: `src/server/security/rate-limiter.ts`
- Modify: `src/server/auth/auth.ts`
- Modify: `src/app/api/setup/route.ts`
- Modify: `src/app/api/auth/register/route.ts`
- Modify: `compose.yaml`
- Modify: `.env.example`
- Test: `tests/unit/security/client-address.test.ts`
- Test: `tests/integration/auth/rate-limiter.test.ts`
- Test: existing Setup / registration / login route tests

**Security contract:** `TRUST_PROXY=false` is the default. In that mode application code must ignore `Forwarded`, `X-Forwarded-For` and `X-Real-IP`; it must not invent a client IP. `TRUST_PROXY=true` is the deployer's explicit assertion that an operator-controlled reverse proxy strips client-supplied `X-Real-IP`, replaces it from the true connection, and the app port cannot be accessed directly by untrusted clients. V1 reads **only** `X-Real-IP` when that exact flag is enabled; duplicate values, malformed values and missing values do not yield an IP key. `TRUST_PROXY` has no HTTPS coupling.

Authentication limits always consume a stable business identifier before verification: normalized username for login/registration, Setup Token for Setup, Invite Token for the future `INVITATION` scope. When a trusted IP is available, the route additionally consumes its IP bucket; each identifier is HMAC-hashed inside `RateLimiter`, so raw IPs, usernames and tokens never enter the rate-limit table or logs. Any exhausted bucket returns `429 RATE_LIMITED`.

- [x] **Step 1: Write failing address-boundary and persistent-window tests**

Coverage must establish the explicit address boundary and fixed-window behavior before implementation:

- `getClientAddress(request)` ignores `Forwarded`, `X-Forwarded-For`, and `X-Real-IP` unless the environment value is exactly `TRUST_PROXY=true`.
- With that exact opt-in, it reads only one valid `X-Real-IP`; a missing, malformed, empty, comma-merged, or duplicate value returns no address bucket.
- PostgreSQL persistence stores only HMAC-SHA256 bucket keys and rejects the sixth attempt for one stable identifier.
- Concurrent consumers allow exactly five attempts, expired buckets are removed, and a rejected companion bucket rolls the complete `consumeAll()` transaction back.

- [x] **Step 2: Verify the initial tests fail for the intended missing behavior**

Run: `npx vitest run tests/unit/security/client-address.test.ts tests/integration/auth/rate-limiter.test.ts --maxWorkers=1`

Expected before implementation: failure because the address-boundary and persistent limiter behavior does not exist.

- [x] **Step 3: Implement the explicit proxy boundary and persistent HMAC limiter**

`getClientAddress(request)` uses `process.env.TRUST_PROXY === "true"` as the only enable value and reads only `X-Real-IP`. It does not attempt to parse a proxy chain or trust multiple address headers.

`RateLimiter` uses the fixed `RATE_LIMIT_ATTEMPT_LIMIT = 5` and `RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000` policy. `consumeAll(buckets)` de-duplicates scope/identifier pairs with a NUL separator, derives hex HMAC-SHA256 keys from the auth secret, deletes expired rows, and conditionally upserts every bucket in one transaction. If any bucket is exhausted, it throws `429 RATE_LIMITED` and rolls the request's whole transaction back. Raw IPs, usernames, Setup Tokens, passwords, and synthetic emails must not enter the rate-limit table or logs.

`SECURE_COOKIES` remains an optional exact `true` / `false` override. When it is absent or Compose provides `""`, Better Auth derives the secure-cookie setting from `BETTER_AUTH_URL` (`https:` true; `http:` false). Whitespace values remain invalid configuration. Do not add a proxy container, TLS certificate handling, or automatic forwarded-header detection.

- [x] **Step 4: Integrate before credential or complete-schema verification and verify routes**

- Registration consumes normalized `REGISTER_USERNAME` after valid JSON parsing and before complete registration-schema validation; it adds `REGISTER_IP` only when `getClientAddress()` returns an address.
- Setup consumes `SETUP_TOKEN` once the raw token field has its valid string shape and length, before complete Setup validation; it adds `SETUP_IP` only when available.
- Better Auth login consumes normalized `LOGIN_USERNAME` before password verification and adds `LOGIN_IP` only when available.
- The Better Auth-native `sign-up/email` path, including all trailing-slash variants, remains disabled and cannot initialize the auth runtime.
- Route tests prove stable identifiers stay rate-limited with `TRUST_PROXY=false`; trusted `X-Real-IP` creates the additional bucket with `TRUST_PROXY=true`; spoofed `Forwarded` / `X-Forwarded-For`, malformed and duplicate `X-Real-IP` cannot create an IP bucket.

Run: `npx vitest run tests/unit/security/client-address.test.ts tests/integration/auth/rate-limiter.test.ts tests/unit/auth/catch-all-registration.test.ts tests/unit/auth/registration-route.test.ts --maxWorkers=1`

Expected: PASS with `429 RATE_LIMITED`, safe proxy behavior, and no raw identifier persistence.

- [x] **Step 5: Run full Task 8 gates and commit**

Run: `npm run test:unit && npm run test:integration && npm run lint && npm run typecheck && npm run build`

Expected: PASS. If `npm run format:check` only flags the existing external untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml`, record that limitation without editing either file.

```bash
git add src/server/security src/server/auth/auth.ts 'src/app/api/auth/[...all]/route.ts' src/app/api/auth/register/route.ts src/app/api/setup/route.ts compose.yaml .env.example tests/unit/security tests/integration/auth/rate-limiter.test.ts tests/unit/auth
git commit -m "feat: add persistent authentication rate limits"
```

### Task 9: Run the Phase 2 gate

**Files:**

- Test: `tests/unit/auth/**`
- Test: `tests/integration/auth/**`

- [ ] **Step 1: Run focused authentication tests**

```bash
npm run test:unit -- tests/unit/auth
npm run test:integration -- tests/integration/auth
```

Expected: all Auth, Setup, and System Admin tests pass.

- [ ] **Step 2: Run static and build checks**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 3: Verify secrets and synthetic email are not logged or returned**

```powershell
$bad = Select-String -Path 'src/**/*.ts','src/**/*.tsx' -Pattern 'console\.(log|info|warn).*password|console\.(log|info|warn).*setupTokenHash|email:\s*createSyntheticEmail'
if ($bad) { $bad; exit 1 }
```

Expected: no output. The only Setup plaintext log is the deliberate one-time line in `initialize-setup.ts`.

- [ ] **Step 4: Verify stable invariant codes exist**

Run: `Select-String -Path 'src/server/**/*.ts' -Pattern 'LAST_ACTIVE_ADMIN|INVALID_SETUP_TOKEN|UNAUTHENTICATED'`

Expected: all three codes are found in service-layer source.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: complete authentication verification"
```
