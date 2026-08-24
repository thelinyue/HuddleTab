# HuddleTab Phase 3 Activity and Member Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver activities, stable ActivityMember accounting identities, invitations, lifecycle transitions, LEFT rules, and transaction-safe Owner invariants.

**Architecture:** Persist every participant as an ActivityMember and reference users only as optional identity bindings. Route every activity write through one fixed permission evaluator, use PostgreSQL constraints for same-activity ownership/one Owner, and keep ownership, audit, notification, and revision changes in one transaction.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL 18, Next.js Route Handlers, Zod, Vitest, Testcontainers.

---

## File responsibility map

```text
src/server/db/schema/activity.ts                 activity/member/invitation/audit/notification tables
src/server/permissions/authorize-activity-operation.ts    fixed seven-stage authorization order
src/server/services/activity-service.ts          create/list activity and initial Owner identity
src/server/services/member-service.ts            Guest, bind, role, remove, leave, LEFT transitions
src/server/services/ownership-service.ts         OWNER_TRANSFER_REQUIRED and atomic transfer
src/server/services/invitation-service.ts        hashed link token, account invite, approval/join
src/server/services/activity-lifecycle-service.ts end/reopen/archive/unarchive/delete/restore
src/server/validation/activity.ts                request schemas
src/app/api/activities/**                        thin Route Handlers calling services
tests/unit/permissions/**                        decision-order matrix
tests/integration/activity/**                    constraints and transaction behavior
```

## Locked interfaces and cross-phase contracts

- `ActivityMember` is the only accounting identity; `userId` is optional and binding never changes `memberId`.
- Permission order is exactly Session → membership exists → Activity lifecycle → member status → role → resource ownership → operation.
- `ActivityStatus = "ACTIVE" | "ENDED" | "ARCHIVED"`; `deletedAt !== null` produces effective `DELETED` while preserving the previous stored status for restore.
- `ActivityRole = "OWNER" | "ADMIN" | "MEMBER"`; every undeleted Activity has exactly one effective Owner.
- Phase 3 defines `AccountingIdentityUsageReader.hasFacts(memberId)`. Phase 4/5 replace its initial always-false implementation when Expense/Settlement tables exist; this avoids importing future schemas now.
- Transfer updates both member roles in one SQL `CASE` statement. PostgreSQL partial unique indexes cannot be deferred; one statement preserves the required logical “new Owner then old Owner” outcome without an intermediate uniqueness violation.

### Task 1: Add activity/member schema and database invariants

**Files:**

- Create: `src/server/db/schema/activity.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `tests/integration/activity/activity-schema.test.ts`
- Create: `drizzle/0002_activity_member.sql` through `npm run db:generate`

- [ ] **Step 1: Write the failing database test**

```ts
// tests/integration/activity/activity-schema.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
let h: PostgresHarness;
beforeAll(async () => {
  h = await startPostgres();
  await h.seedCredentialUser("owner-user", "owner@example.com");
});
afterAll(async () => {
  await h.stop();
});

describe("activity owner invariants", () => {
  it("allows a circular Activity + initial Owner only in one deferred transaction", async () => {
    await h.sql.begin(async (tx) => {
      await tx`insert into activities (id,name,base_currency,start_date,status,owner_member_id,invite_mode,revision,created_at,updated_at)
        values ('act-1','大阪','CNY','2026-08-23','ACTIVE','member-owner','DIRECT_JOIN',0,now(),now())`;
      await tx`insert into activity_members (id,activity_id,user_id,display_name,member_type,role,status,joined_at)
        values ('member-owner','act-1','owner-user','Owner','USER','OWNER','ACTIVE',now())`;
    });
    const rows =
      await h.sql`select owner_member_id from activities where id='act-1'`;
    expect(rows[0].owner_member_id).toBe("member-owner");
  });

  it("rejects a second Owner and a cross-activity owner reference", async () => {
    await expect(h.sql`insert into activity_members (id,activity_id,display_name,member_type,role,status,joined_at)
      values ('owner-2','act-1','二号','GUEST','OWNER','ACTIVE',now())`).rejects.toMatchObject(
      { code: "23505" },
    );
    await expect(
      h.sql.begin(async (tx) => {
        await tx`insert into activities (id,name,base_currency,start_date,status,owner_member_id,invite_mode,revision,created_at,updated_at)
        values ('act-2','上海','CNY','2026-08-23','ACTIVE','member-owner','DIRECT_JOIN',0,now(),now())`;
      }),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/integration/activity/activity-schema.test.ts`

Expected: FAIL because activity tables do not exist.

- [ ] **Step 3: Write the minimal schema and generated-migration supplement**

```ts
// src/server/db/schema/activity.ts
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
  revision: bigint("revision", { mode: "bigint" }).notNull().default(0n),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  purgeAfter: timestamp("purge_after", { withTimezone: true }),
});

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
  (t) => [
    uniqueIndex("activity_members_user_uq").on(t.activityId, t.userId),
    index("activity_members_activity_idx").on(t.activityId),
  ],
);

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
    recentParticipantIds: jsonb("recent_participant_ids").notNull().default([]),
    recentPayerIds: jsonb("recent_payer_ids").notNull().default([]),
    recentCurrency: text("recent_currency"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("user_activity_preferences_uq").on(t.userId, t.activityId),
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
  metadata: jsonb("metadata").notNull().default({}),
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
  payload: jsonb("payload").notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

Append to generated `drizzle/0002_activity_member.sql`:

```sql
alter table activity_members add constraint activity_members_type_ck
  check ((member_type='USER' and user_id is not null) or (member_type='GUEST' and user_id is null));
alter table activity_members add constraint activity_members_id_activity_uq unique (id, activity_id);
alter table activities add constraint activities_owner_same_activity_fk
  foreign key (owner_member_id, id) references activity_members(id, activity_id)
  deferrable initially deferred;
create unique index activity_members_one_owner_uq on activity_members(activity_id) where role='OWNER';
```

Export the new schema from `src/server/db/schema/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- tests/integration/activity/activity-schema.test.ts`

Expected: PASS; valid deferred creation commits, duplicate/cross-activity ownership fails.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/activity.ts src/server/db/schema/index.ts drizzle/0002_activity_member.sql tests/integration/activity/activity-schema.test.ts
git commit -m "feat: add activity member invariants"
```

### Task 2: Encode the fixed permission decision order

**Files:**

- Create: `src/server/permissions/authorize-activity-operation.ts`
- Create: `tests/unit/permissions/authorize-activity-operation.test.ts`

- [ ] **Step 1: Write the failing matrix test**

```ts
// tests/unit/permissions/authorize-activity-operation.test.ts
import { describe, expect, it } from "vitest";
import { evaluateActivityOperation } from "@/server/permissions/authorize-activity-operation";
const base = {
  hasSession: true,
  membershipExists: true,
  lifecycle: "ACTIVE",
  memberStatus: "ACTIVE",
  role: "MEMBER",
  ownsResource: true,
} as const;
describe("activity permission order", () => {
  it("checks Session, membership, lifecycle, state, role, ownership, then operation", () => {
    expect(() =>
      evaluateActivityOperation(
        { ...base, hasSession: false },
        "EXPENSE_CREATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "UNAUTHENTICATED" }));
    expect(() =>
      evaluateActivityOperation(
        { ...base, membershipExists: false },
        "EXPENSE_CREATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "ACTIVITY_NOT_FOUND" }));
    expect(() =>
      evaluateActivityOperation(
        { ...base, lifecycle: "ARCHIVED" },
        "EXPENSE_CREATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "ACTIVITY_READ_ONLY" }));
    expect(() =>
      evaluateActivityOperation(
        { ...base, memberStatus: "LEFT" },
        "EXPENSE_CREATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "LEFT_MEMBER_READ_ONLY" }));
  });

  it("lets LEFT members settle only when payer and creator are self", () => {
    const left = {
      ...base,
      lifecycle: "ENDED",
      memberStatus: "LEFT",
      payerIsSelf: true,
      createdBySelf: true,
    } as const;
    expect(() =>
      evaluateActivityOperation(left, "SETTLEMENT_CREATE"),
    ).not.toThrow();
    expect(() =>
      evaluateActivityOperation(
        { ...left, payerIsSelf: false },
        "SETTLEMENT_CREATE",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "SETTLEMENT_PAYER_MUST_BE_SELF" }),
    );
    expect(() =>
      evaluateActivityOperation(
        { ...left, createdBySelf: false },
        "SETTLEMENT_UPDATE",
      ),
    ).toThrowError(expect.objectContaining({ code: "RESOURCE_NOT_OWNED" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/permissions/authorize-activity-operation.test.ts`

Expected: FAIL with missing permission module.

- [ ] **Step 3: Write the minimal evaluator**

```ts
// src/server/permissions/authorize-activity-operation.ts
import type postgres from "postgres";
import { ApplicationError } from "@/server/errors/application-error";
export type ActivityOperation =
  | "READ"
  | "LEDGER_READ"
  | "EXPENSE_CREATE"
  | "EXPENSE_UPDATE"
  | "EXPENSE_DELETE"
  | "SETTLEMENT_CREATE"
  | "SETTLEMENT_UPDATE"
  | "SETTLEMENT_DELETE"
  | "ATTACHMENT_READ"
  | "ATTACHMENT_WRITE"
  | "MEMBER_MANAGE"
  | "OWNER_TRANSFER";
export interface ActivityPermissionContext {
  hasSession: boolean;
  membershipExists: boolean;
  lifecycle: "ACTIVE" | "ENDED" | "ARCHIVED" | "DELETED";
  memberStatus: "ACTIVE" | "LEFT";
  role: "OWNER" | "ADMIN" | "MEMBER";
  ownsResource: boolean;
  payerIsSelf?: boolean;
  createdBySelf?: boolean;
}

/** 固定顺序是安全边界；后续 API 只能构造上下文并调用，不能自行重排检查。 */
export function evaluateActivityOperation(
  c: ActivityPermissionContext,
  op: ActivityOperation,
): void {
  if (!c.hasSession)
    throw new ApplicationError(
      "UNAUTHENTICATED",
      "登录状态已失效，请重新登录。",
      401,
    );
  if (!c.membershipExists)
    throw new ApplicationError(
      "ACTIVITY_NOT_FOUND",
      "活动不存在或你无权查看。",
      404,
    );
  if (
    c.lifecycle === "DELETED" ||
    (c.lifecycle === "ARCHIVED" &&
      !["READ", "LEDGER_READ", "ATTACHMENT_READ"].includes(op))
  )
    throw new ApplicationError(
      "ACTIVITY_READ_ONLY",
      "当前活动状态不允许此操作。",
      409,
    );
  if (
    c.lifecycle === "ENDED" &&
    ![
      "READ",
      "LEDGER_READ",
      "ATTACHMENT_READ",
      "SETTLEMENT_CREATE",
      "SETTLEMENT_UPDATE",
      "SETTLEMENT_DELETE",
    ].includes(op)
  )
    throw new ApplicationError(
      "ACTIVITY_READ_ONLY",
      "活动已结束，仅可继续处理实际结算。",
      409,
    );
  if (
    c.memberStatus === "LEFT" &&
    ![
      "READ",
      "LEDGER_READ",
      "ATTACHMENT_READ",
      "SETTLEMENT_CREATE",
      "SETTLEMENT_UPDATE",
      "SETTLEMENT_DELETE",
    ].includes(op)
  )
    throw new ApplicationError(
      "LEFT_MEMBER_READ_ONLY",
      "你已退出活动，历史消费仅可查看。",
      403,
    );
  if (op === "MEMBER_MANAGE" && c.role === "MEMBER")
    throw new ApplicationError("ROLE_FORBIDDEN", "当前角色不能管理成员。", 403);
  if (op === "OWNER_TRANSFER" && c.role !== "OWNER")
    throw new ApplicationError(
      "ROLE_FORBIDDEN",
      "只有活动 Owner 可以转让所有权。",
      403,
    );
  if (
    [
      "EXPENSE_UPDATE",
      "EXPENSE_DELETE",
      "SETTLEMENT_UPDATE",
      "SETTLEMENT_DELETE",
    ].includes(op) &&
    c.role === "MEMBER" &&
    !c.ownsResource
  )
    throw new ApplicationError(
      "RESOURCE_NOT_OWNED",
      "你只能修改自己创建的记录。",
      403,
    );
  if (
    op.startsWith("SETTLEMENT") &&
    (c.memberStatus === "LEFT" || c.role === "MEMBER") &&
    !c.payerIsSelf
  )
    throw new ApplicationError(
      "SETTLEMENT_PAYER_MUST_BE_SELF",
      "你只能记录付款人为自己的结算。",
      403,
    );
  if (
    ["SETTLEMENT_UPDATE", "SETTLEMENT_DELETE"].includes(op) &&
    c.memberStatus === "LEFT" &&
    !c.createdBySelf
  )
    throw new ApplicationError(
      "RESOURCE_NOT_OWNED",
      "你不能修改其他成员创建的结算。",
      403,
    );
}

export interface ActivityAuthorizationInput {
  session: { user: { id: string } } | null;
  activityId: string;
  operation: ActivityOperation;
  resourceOwnerMemberId?: string;
  settlementPayerMemberId?: string;
}

export interface ActivityAuthorization {
  userId: string;
  activity: {
    id: string;
    status: "ACTIVE" | "ENDED" | "ARCHIVED";
    deletedAt: Date | null;
    baseCurrency: string;
    revision: bigint;
  };
  member: {
    id: string;
    role: "OWNER" | "ADMIN" | "MEMBER";
    status: "ACTIVE" | "LEFT";
  };
}

/** 查询身份与活动事实后，唯一地调用固定顺序 evaluator；Route/Service 不得自行跳过其中任何层。 */
export async function authorizeActivityOperation(
  tx: postgres.TransactionSql,
  input: ActivityAuthorizationInput,
): Promise<ActivityAuthorization> {
  if (!input.session)
    evaluateActivityOperation(
      { hasSession: false } as ActivityPermissionContext,
      input.operation,
    );
  const [activity] =
    await tx`select id,status,deleted_at,base_currency,revision from activities where id=${input.activityId}`;
  const [member] =
    await tx`select id,role,status from activity_members where activity_id=${input.activityId} and user_id=${input.session!.user.id}`;
  const lifecycle = !activity
    ? "DELETED"
    : activity.deleted_at
      ? "DELETED"
      : activity.status;
  evaluateActivityOperation(
    {
      hasSession: true,
      membershipExists: Boolean(activity && member),
      lifecycle,
      memberStatus: member?.status ?? "LEFT",
      role: member?.role ?? "MEMBER",
      ownsResource:
        !input.resourceOwnerMemberId ||
        input.resourceOwnerMemberId === member?.id,
      payerIsSelf:
        !input.settlementPayerMemberId ||
        input.settlementPayerMemberId === member?.id,
      createdBySelf:
        !input.resourceOwnerMemberId ||
        input.resourceOwnerMemberId === member?.id,
    },
    input.operation,
  );
  return {
    userId: input.session!.user.id,
    activity: activity!,
    member: member!,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/permissions/authorize-activity-operation.test.ts`

Expected: PASS with both decision-order tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/permissions/authorize-activity-operation.ts tests/unit/permissions/authorize-activity-operation.test.ts
git commit -m "feat: enforce activity permission order"
```

### Task 3: Create activities and preserve ActivityMember identity

**Files:**

- Create: `src/server/services/activity-service.ts`
- Create: `src/server/services/member-service.ts`
- Create: `tests/integration/activity/member-service.test.ts`

- [ ] **Step 1: Write the failing service test**

```ts
// tests/integration/activity/member-service.test.ts
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityService } from "@/server/services/activity-service";
import { MemberService } from "@/server/services/member-service";
let h: PostgresHarness;
beforeAll(async () => {
  h = await startPostgres();
  await h.seedCredentialUser("user-1", "owner@example.com");
  await h.seedCredentialUser("user-2", "member@example.com");
});
afterAll(async () => {
  await h.stop();
});
it("creates the Owner atomically and binds a Guest without changing member id", async () => {
  const activity = await new ActivityService(h.sql).create({
    name: "大阪",
    baseCurrency: "CNY",
    startDate: "2026-08-23",
    ownerUserId: "user-1",
    ownerDisplayName: "Owner",
  });
  const guest = await new MemberService(h.sql, {
    hasFacts: async () => false,
  }).addGuest(activity.id, "小王");
  await new MemberService(h.sql, { hasFacts: async () => false }).bindGuest(
    guest.id,
    "user-2",
  );
  const [row] =
    await h.sql`select id,user_id,member_type from activity_members where id=${guest.id}`;
  expect(row).toEqual({ id: guest.id, user_id: "user-2", member_type: "USER" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/integration/activity/member-service.test.ts`

Expected: FAIL because both services are missing.

- [ ] **Step 3: Write the minimal services**

```ts
// src/server/services/activity-service.ts
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
export class ActivityService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}
  async create(input: {
    name: string;
    baseCurrency: string;
    startDate: string;
    ownerUserId: string;
    ownerDisplayName: string;
  }) {
    const activityId = randomUUID();
    const ownerMemberId = randomUUID();
    await this.sql.begin(async (tx) => {
      await tx`insert into activities (id,name,base_currency,start_date,status,owner_member_id,invite_mode,revision,created_at,updated_at)
        values (${activityId},${input.name},${input.baseCurrency},${input.startDate},'ACTIVE',${ownerMemberId},'DIRECT_JOIN',0,now(),now())`;
      await tx`insert into activity_members (id,activity_id,user_id,display_name,member_type,role,status,joined_at)
        values (${ownerMemberId},${activityId},${input.ownerUserId},${input.ownerDisplayName},'USER','OWNER','ACTIVE',now())`;
      await tx`insert into activity_audit_logs (id,activity_id,actor_member_id,action,payload_json)
        values (${randomUUID()},${activityId},${ownerMemberId},'ACTIVITY_CREATED','{}')`;
    });
    return { id: activityId, ownerMemberId };
  }
}
```

```ts
// src/server/services/member-service.ts
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { ApplicationError } from "@/server/errors/application-error";
export interface AccountingIdentityUsageReader {
  hasFacts(memberId: string): Promise<boolean>;
}
/** 所有成员写入都在单一事务中执行：authorizeActivityOperation → 锁成员/活动 → 写事实 → Audit/Notification → Revision++ → Commit。 */
export class MemberService {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly usage: AccountingIdentityUsageReader,
  ) {}
  // 每个公开方法都必须接收 actor Session，并通过 authorizeActivityOperation(tx, { operation: "MEMBER_MANAGE" })；禁止裸 ID 无授权写入。
  async addGuest(activityId: string, displayName: string) {
    const id = randomUUID();
    await this
      .sql`insert into activity_members (id,activity_id,display_name,member_type,role,status,joined_at) values (${id},${activityId},${displayName},'GUEST','MEMBER','ACTIVE',now())`;
    return { id };
  }
  async bindGuest(memberId: string, userId: string): Promise<void> {
    await this
      .sql`update activity_members set user_id=${userId}, member_type='USER' where id=${memberId} and member_type='GUEST'`;
  }
  async leave(memberId: string): Promise<void> {
    const [member] = await this
      .sql`select role from activity_members where id=${memberId} for update`;
    if (member?.role === "OWNER")
      throw new ApplicationError(
        "OWNER_TRANSFER_REQUIRED",
        "请先转让活动所有权，再退出活动。",
        409,
      );
    await this
      .sql`update activity_members set status='LEFT', left_at=now() where id=${memberId}`;
  }
  async remove(memberId: string): Promise<void> {
    const [member] = await this
      .sql`select role from activity_members where id=${memberId} for update`;
    if (member?.role === "OWNER")
      throw new ApplicationError(
        "OWNER_TRANSFER_REQUIRED",
        "请先转让活动所有权，再移除 Owner。",
        409,
      );
    if (await this.usage.hasFacts(memberId))
      await this
        .sql`update activity_members set status='LEFT', left_at=now() where id=${memberId}`;
    else await this.sql`delete from activity_members where id=${memberId}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- tests/integration/activity/member-service.test.ts`

Expected: PASS and Guest binding preserves the same `activity_members.id`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/activity-service.ts src/server/services/member-service.ts tests/integration/activity/member-service.test.ts
git commit -m "feat: add activities and stable member identities"
```

### Task 4: Transfer ownership in one transaction

**Files:**

- Create: `src/server/services/ownership-service.ts`
- Create: `tests/integration/activity/ownership-service.test.ts`

- [ ] **Step 1: Write the failing transfer test**

```ts
// tests/integration/activity/ownership-service.test.ts
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { OwnershipService } from "@/server/services/ownership-service";
let h: PostgresHarness;
beforeAll(async () => {
  h = await startPostgres();
  await h.seedActivityWithMembers("act", "old", "next");
});
afterAll(async () => {
  await h.stop();
});
it("atomically changes both roles, owner pointer, audit, notification, and revision", async () => {
  await new OwnershipService(h.sql).transferOwnership("act", "old", "next");
  const members =
    await h.sql`select id,role from activity_members where activity_id='act' order by id`;
  const [activity] =
    await h.sql`select owner_member_id,revision from activities where id='act'`;
  expect(members).toEqual([
    { id: "next", role: "OWNER" },
    { id: "old", role: "ADMIN" },
  ]);
  expect(activity).toEqual({ owner_member_id: "next", revision: "1" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/integration/activity/ownership-service.test.ts`

Expected: FAIL because `OwnershipService` is missing.

- [ ] **Step 3: Write the minimal transaction**

```ts
// src/server/services/ownership-service.ts
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { ApplicationError } from "@/server/errors/application-error";
export class OwnershipService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}
  async transferOwnership(
    activityId: string,
    actorMemberId: string,
    newOwnerId: string,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [activity] =
        await tx`select owner_member_id,deleted_at from activities where id=${activityId} for update`;
      if (!activity || activity.deleted_at)
        throw new ApplicationError(
          "ACTIVITY_NOT_FOUND",
          "活动不存在或已删除。",
          404,
        );
      if (activity.owner_member_id !== actorMemberId)
        throw new ApplicationError(
          "ROLE_FORBIDDEN",
          "只有当前 Owner 可以转让所有权。",
          403,
        );
      const [next] =
        await tx`select user_id,status from activity_members where id=${newOwnerId} and activity_id=${activityId} for update`;
      if (!next || next.status !== "ACTIVE")
        throw new ApplicationError(
          "INVALID_NEW_OWNER",
          "新 Owner 必须是当前活动的有效成员。",
          422,
        );
      /* 一个 CASE 语句在语句结束时只留下一个 OWNER，兼容不可延迟的部分唯一索引。 */
      await tx`update activity_members set role=case when id=${newOwnerId} then 'OWNER'::activity_role else 'ADMIN'::activity_role end where id in (${newOwnerId},${actorMemberId}) and activity_id=${activityId}`;
      await tx`update activities set owner_member_id=${newOwnerId},revision=revision+1,updated_at=now() where id=${activityId}`;
      await tx`insert into activity_audit_logs (id,activity_id,actor_member_id,action,payload_json) values (${randomUUID()},${activityId},${actorMemberId},'OWNER_TRANSFERRED',${JSON.stringify({ from: actorMemberId, to: newOwnerId })})`;
      if (next.user_id)
        await tx`insert into notifications (id,user_id,type,payload_json) values (${randomUUID()},${next.user_id},'OWNER_TRANSFERRED',${JSON.stringify({ activityId })})`;
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- tests/integration/activity/ownership-service.test.ts`

Expected: PASS; no commit state has zero or two Owners.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/ownership-service.ts tests/integration/activity/ownership-service.test.ts tests/support/postgres.ts
git commit -m "feat: add atomic ownership transfer"
```

### Task 5: Add hashed invitations and approval flow

**Files:**

- Modify: `src/server/db/schema/activity.ts`
- Create: `src/server/services/invitation-service.ts`
- Create: `src/app/api/activities/[activityId]/invitations/join-requests/[requestId]/route.ts`
- Create: `tests/integration/activity/invitation-service.test.ts`
- Modify: `drizzle/0002_activity_member.sql`

- [ ] **Step 1: Write the failing invitation test**

```ts
// tests/integration/activity/invitation-service.test.ts
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { InvitationService } from "@/server/services/invitation-service";
let h: PostgresHarness;
beforeAll(async () => {
  h = await startPostgres();
  await h.seedActivityWithMembers("act", "owner", "member");
});
afterAll(async () => {
  await h.stop();
});
it("stores only a token hash and validates the raw proof for Phase 2 registration", async () => {
  const service = new InvitationService(h.sql);
  const raw = await service.resetLink("act", "owner");
  const [row] =
    await h.sql`select token_hash from activity_invite_tokens where activity_id='act' and enabled=true`;
  expect(row.token_hash).not.toContain(raw);
  await expect(service.verify(raw)).resolves.toBe(true);
  await service.disableLink("act");
  await expect(service.verify(raw)).resolves.toBe(false);
});

it("lets an authorized manager approve a pending join request", async () => {
  const service = new InvitationService(h.sql);
  const pending = await service.join("act", "candidate", "候选成员");
  await service.decideJoinRequest(
    pending.requestId!,
    "owner",
    "APPROVE",
    "候选成员",
  );
  expect(await h.memberStatus("act", "candidate")).toBe("ACTIVE");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/integration/activity/invitation-service.test.ts`

Expected: FAIL because `InvitationService` is missing.

- [ ] **Step 3: Add invitation tables and service**

Add to `src/server/db/schema/activity.ts`:

```ts
export const activityUserInvitations = pgTable("activity_user_invitations", {
  id: text("id").primaryKey(),
  activityId: text("activity_id")
    .notNull()
    .references(() => activities.id, { onDelete: "cascade" }),
  targetUserId: text("target_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  senderMemberId: text("sender_member_id").notNull(),
  status: text("status").notNull().default("PENDING"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const activityJoinRequests = pgTable("activity_join_requests", {
  id: text("id").primaryKey(),
  activityId: text("activity_id")
    .notNull()
    .references(() => activities.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("PENDING"),
  decidedByMemberId: text("decided_by_member_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
```

`activity_invite_tokens.enabled` is already a PostgreSQL boolean in the initial schema; do not generate an intermediate text column.

```ts
// src/server/services/invitation-service.ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { InvitationRegistrationVerifier } from "@/server/auth/registration-gate";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
export class InvitationService implements InvitationRegistrationVerifier {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}
  async resetLink(activityId: string, actorMemberId: string): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    await this.sql.begin(async (tx) => {
      await tx`update activity_invite_tokens set enabled=false where activity_id=${activityId}`;
      await tx`insert into activity_invite_tokens (id,activity_id,token_hash,enabled,created_by_member_id) values (${randomUUID()},${activityId},${hash(raw)},true,${actorMemberId})`;
    });
    return raw;
  }
  async disableLink(activityId: string): Promise<void> {
    await this
      .sql`update activity_invite_tokens set enabled=false where activity_id=${activityId}`;
  }
  async verify(raw: string): Promise<boolean> {
    const rows = await this
      .sql`select 1 from activity_invite_tokens t join activities a on a.id=t.activity_id where t.token_hash=${hash(raw)} and t.enabled=true and a.deleted_at is null limit 1`;
    return rows.length === 1;
  }
  async join(
    activityId: string,
    userId: string,
    displayName: string,
  ): Promise<{ memberId?: string; requestId?: string }> {
    const [activity] = await this
      .sql`select invite_mode,status,deleted_at from activities where id=${activityId}`;
    if (!activity || activity.deleted_at || activity.status !== "ACTIVE")
      throw new Error("当前活动不能加入");
    const id = randomUUID();
    if (activity.invite_mode === "REQUIRE_APPROVAL") {
      await this
        .sql`insert into activity_join_requests (id,activity_id,user_id,status) values (${id},${activityId},${userId},'PENDING')`;
      return { requestId: id };
    }
    await this
      .sql`insert into activity_members (id,activity_id,user_id,display_name,member_type,role,status,joined_at) values (${id},${activityId},${userId},${displayName},'USER','MEMBER','ACTIVE',now())`;
    return { memberId: id };
  }

  async decideJoinRequest(
    requestId: string,
    actorMemberId: string,
    decision: "APPROVE" | "REJECT",
    displayName: string,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [request] =
        await tx`select id,activity_id,user_id,status from activity_join_requests where id=${requestId} for update`;
      if (!request || request.status !== "PENDING")
        throw new Error("加入申请不存在或已经处理");
      const [actor] =
        await tx`select role,status from activity_members where id=${actorMemberId} and activity_id=${request.activity_id}`;
      if (
        !actor ||
        actor.status !== "ACTIVE" ||
        !["OWNER", "ADMIN"].includes(actor.role)
      )
        throw new Error("你没有审批加入申请的权限");
      if (decision === "APPROVE") {
        await tx`insert into activity_members (id,activity_id,user_id,display_name,member_type,role,status,joined_at)
          values (${randomUUID()},${request.activity_id},${request.user_id},${displayName},'USER','MEMBER','ACTIVE',now())`;
      }
      await tx`update activity_join_requests
        set status=${decision === "APPROVE" ? "APPROVED" : "REJECTED"}, decided_by_member_id=${actorMemberId}, decided_at=now()
        where id=${requestId}`;
    });
  }
}
```

Phase 3 composition changes `/api/auth/register` from the rejecting verifier to `new InvitationService(sql)`; no policy rule changes. Invitation proof and join-request routes call the Phase 2 `RateLimiter` with scope `INVITATION` before token or membership lookup. The join-request Route Handler exposes manager-only approve/reject actions and delegates to `decideJoinRequest()`; it does not duplicate permission checks in UI code.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- tests/integration/activity/invitation-service.test.ts`

Expected: PASS; plaintext token is absent from the database, disabling invalidates proof, and both approval decisions close the pending request exactly once.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/activity.ts src/server/services/invitation-service.ts src/app/api/auth/register/route.ts src/app/api/activities/[activityId]/invitations drizzle/0002_activity_member.sql tests/integration/activity/invitation-service.test.ts
git commit -m "feat: add activity invitations"
```

### Task 6: Implement lifecycle transitions and thin HTTP boundaries

**Files:**

- Create: `src/server/services/activity-lifecycle-service.ts`
- Create: `src/server/validation/activity.ts`
- Create: `src/server/http/activity-lifecycle-route.ts`
- Create: `src/app/api/activities/route.ts`
- Create: `src/app/api/activities/[activityId]/end/route.ts`
- Create: `src/app/api/activities/[activityId]/reopen/route.ts`
- Create: `src/app/api/activities/[activityId]/archive/route.ts`
- Create: `src/app/api/activities/[activityId]/unarchive/route.ts`
- Create: `src/app/api/activities/[activityId]/delete/route.ts`
- Create: `src/app/api/activities/[activityId]/restore/route.ts`
- Create: `tests/integration/activity/lifecycle-service.test.ts`

- [ ] **Step 1: Write the failing lifecycle test**

```ts
// tests/integration/activity/lifecycle-service.test.ts
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  startPostgres,
  type PostgresHarness,
} from "@/../tests/support/postgres";
import { ActivityLifecycleService } from "@/server/services/activity-lifecycle-service";
let h: PostgresHarness;
beforeAll(async () => {
  h = await startPostgres();
  await h.seedActivityWithMembers("act", "owner", "admin");
});
afterAll(async () => {
  await h.stop();
});
it("follows ACTIVE→ENDED→ARCHIVED, restores status, and preserves revision", async () => {
  const service = new ActivityLifecycleService(h.sql);
  await service.transition("act", "admin", "END");
  await service.transition("act", "owner", "ARCHIVE");
  await service.transition("act", "owner", "DELETE");
  await service.transition("act", "owner", "RESTORE");
  const [row] =
    await h.sql`select status,deleted_at,purge_after,revision from activities where id='act'`;
  expect(row.status).toBe("ARCHIVED");
  expect(row.deleted_at).toBeNull();
  expect(row.purge_after).toBeNull();
  expect(row.revision).toBe("4");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- tests/integration/activity/lifecycle-service.test.ts`

Expected: FAIL because lifecycle service is missing.

- [ ] **Step 3: Implement transitions, validation, and routes**

```ts
// src/server/services/activity-lifecycle-service.ts
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { ApplicationError } from "@/server/errors/application-error";
export type LifecycleAction =
  "END" | "REOPEN" | "ARCHIVE" | "UNARCHIVE" | "DELETE" | "RESTORE";
const next: Record<
  Exclude<LifecycleAction, "DELETE" | "RESTORE">,
  [string, string]
> = {
  END: ["ACTIVE", "ENDED"],
  REOPEN: ["ENDED", "ACTIVE"],
  ARCHIVE: ["ENDED", "ARCHIVED"],
  UNARCHIVE: ["ARCHIVED", "ENDED"],
};
export class ActivityLifecycleService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}
  async transition(
    activityId: string,
    actorMemberId: string,
    action: LifecycleAction,
  ): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [a] =
        await tx`select status,owner_member_id,deleted_at,purge_after from activities where id=${activityId} for update`;
      const [m] =
        await tx`select role,status from activity_members where id=${actorMemberId} and activity_id=${activityId}`;
      if (!a || !m || m.status !== "ACTIVE")
        throw new ApplicationError(
          "ACTIVITY_NOT_FOUND",
          "活动不存在或你无权操作。",
          404,
        );
      if (
        ["ARCHIVE", "UNARCHIVE", "DELETE", "RESTORE"].includes(action) &&
        m.role !== "OWNER"
      )
        throw new ApplicationError(
          "ROLE_FORBIDDEN",
          "只有 Owner 可以执行此操作。",
          403,
        );
      if (["END", "REOPEN"].includes(action) && m.role === "MEMBER")
        throw new ApplicationError(
          "ROLE_FORBIDDEN",
          "当前角色不能改变活动状态。",
          403,
        );
      if (action === "DELETE")
        await tx`update activities set deleted_at=now(),purge_after=now()+interval '30 days',revision=revision+1 where id=${activityId}`;
      else if (action === "RESTORE") {
        if (!a.deleted_at || a.purge_after <= new Date())
          throw new ApplicationError(
            "RESTORE_WINDOW_EXPIRED",
            "活动已超过 30 天恢复期限。",
            409,
          );
        await tx`update activities set deleted_at=null,purge_after=null,revision=revision+1 where id=${activityId}`;
      } else {
        const [from, to] = next[action];
        if (a.deleted_at || a.status !== from)
          throw new ApplicationError(
            "INVALID_ACTIVITY_TRANSITION",
            "当前活动状态不能执行此转换。",
            409,
          );
        await tx`update activities set status=${to},revision=revision+1,updated_at=now() where id=${activityId}`;
      }
      await tx`insert into activity_audit_logs (id,activity_id,actor_member_id,action,payload_json) values (${randomUUID()},${activityId},${actorMemberId},${`ACTIVITY_${action}`},'{}')`;
    });
  }
}
```

```ts
// src/server/validation/activity.ts
import { z } from "zod";
export const createActivityInput = z.object({
  name: z.string().trim().min(1).max(80),
  location: z.string().trim().max(120).optional(),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  startDate: z.string().date(),
  endDate: z.string().date().optional(),
});
```

Create `src/server/http/activity-lifecycle-route.ts` so each HTTP file declares only its literal transition:

```ts
import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import {
  ActivityLifecycleService,
  type LifecycleAction,
} from "@/server/services/activity-lifecycle-service";
export function makeLifecycleRoute(action: LifecycleAction) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ activityId: string }> },
  ) {
    const session = (await requireSession(request.headers)) as {
      user: { id: string };
    };
    const { activityId } = await context.params;
    const [member] =
      await sql`select id from activity_members where activity_id=${activityId} and user_id=${session.user.id}`;
    await new ActivityLifecycleService(sql).transition(
      activityId,
      member?.id,
      action,
    );
    return NextResponse.json({ data: { action } });
  };
}
```

Create the six route files exactly:

```ts
// src/app/api/activities/[activityId]/end/route.ts
import { makeLifecycleRoute } from "@/server/http/activity-lifecycle-route";
export const POST = makeLifecycleRoute("END");
```

```ts
// src/app/api/activities/[activityId]/reopen/route.ts
import { makeLifecycleRoute } from "@/server/http/activity-lifecycle-route";
export const POST = makeLifecycleRoute("REOPEN");
```

```ts
// src/app/api/activities/[activityId]/archive/route.ts
import { makeLifecycleRoute } from "@/server/http/activity-lifecycle-route";
export const POST = makeLifecycleRoute("ARCHIVE");
```

```ts
// src/app/api/activities/[activityId]/unarchive/route.ts
import { makeLifecycleRoute } from "@/server/http/activity-lifecycle-route";
export const POST = makeLifecycleRoute("UNARCHIVE");
```

```ts
// src/app/api/activities/[activityId]/delete/route.ts
import { makeLifecycleRoute } from "@/server/http/activity-lifecycle-route";
export const POST = makeLifecycleRoute("DELETE");
```

```ts
// src/app/api/activities/[activityId]/restore/route.ts
import { makeLifecycleRoute } from "@/server/http/activity-lifecycle-route";
export const POST = makeLifecycleRoute("RESTORE");
```

Create `src/app/api/activities/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import { ActivityService } from "@/server/services/activity-service";
import { createActivityInput } from "@/server/validation/activity";
export async function GET(request: Request) {
  const session = (await requireSession(request.headers)) as {
    user: { id: string };
  };
  const data =
    await sql`select a.* from activities a join activity_members m on m.activity_id=a.id where m.user_id=${session.user.id} and a.deleted_at is null order by a.updated_at desc`;
  return NextResponse.json({ data });
}
export async function POST(request: Request) {
  const session = (await requireSession(request.headers)) as {
    user: { id: string };
  };
  const body = createActivityInput.parse(await request.json());
  const [profile] =
    await sql`select nickname from user_profiles where user_id=${session.user.id}`;
  const data = await new ActivityService(sql).create({
    ...body,
    ownerUserId: session.user.id,
    ownerDisplayName: profile.nickname,
  });
  return NextResponse.json({ data }, { status: 201 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- tests/integration/activity/lifecycle-service.test.ts`

Expected: PASS; stored status survives delete/restore and revision increments once per committed transition.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/activity-lifecycle-service.ts src/server/validation/activity.ts src/app/api/activities tests/integration/activity/lifecycle-service.test.ts
git commit -m "feat: add activity lifecycle APIs"
```

### Task 7: Run the Phase 3 gate

**Files:**

- Test: `tests/unit/permissions/**`
- Test: `tests/integration/activity/**`

- [ ] **Step 1: Run focused tests**

```bash
npm run test:unit -- tests/unit/permissions
npm run test:integration -- tests/integration/activity
```

Expected: all permission, constraint, Owner, member, invitation, and lifecycle tests pass.

- [ ] **Step 2: Run the project gate**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 3: Scan core invariant codes and forbidden balance storage**

```powershell
Select-String -Path 'src/server/**/*.ts' -Pattern 'OWNER_TRANSFER_REQUIRED|LAST_ACTIVE_ADMIN'
$balanceTable = Select-String -Path 'src/server/db/schema/*.ts' -Pattern 'user_balance|member_balance'
if ($balanceTable) { $balanceTable; exit 1 }
```

Expected: both invariant codes exist and no mutable balance table is found.

- [ ] **Step 4: Verify the Owner constraint in migration**

Run: `Select-String -Path 'drizzle/0002_activity_member.sql' -Pattern 'activities_owner_same_activity_fk|activity_members_one_owner_uq|deferrable initially deferred'`

Expected: all three constraint markers are found.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: complete activity member verification"
```
