# HuddleTab Phase 4 Expense Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement complete, idempotent Expense facts with multiple payers, four split modes, immutable foreign-exchange snapshots, optimistic concurrency, Audit Log, and Activity Revision updates.

**Architecture:** Keep amount conversion and split calculation in pure TypeScript Domain code. Route Handlers validate transport data, while `ExpenseService` enforces the fixed permission order and writes Expense, Payment, Share, Audit, and Revision in one PostgreSQL transaction; attachment bytes remain outside this transaction.

**Tech Stack:** TypeScript, Zod, Drizzle ORM, PostgreSQL 18, Vitest, fast-check, Testcontainers, Next.js Route Handlers.

---

## File responsibility map

```text
src/domain/expenses/prepare-expense.ts                 Pure validation, FX snapshot conversion, payment/share allocation
src/features/expenses/contracts.ts                     JSON-safe request/response contracts; all minor amounts are strings
src/features/expenses/categories.ts                    Fixed V1 category values and Chinese labels
src/server/db/schema/expenses.ts                       Expense, payment, share, rate-cache and audit persistence
src/server/repositories/expense-repository.ts          Persistence only; no accounting or permission decisions
src/server/services/exchange-rate-service.ts           Provider/cache/manual-rate fallback orchestration
src/server/services/expense-service.ts                 Permission, idempotency, transaction, version, audit and revision
src/server/validation/expense.ts                       Zod transport validation
src/app/api/activities/[activityId]/expenses/route.ts  List/create HTTP boundary
src/app/api/activities/[activityId]/expenses/[expenseId]/route.ts Detail/update/delete HTTP boundary
tests/unit/domain/expenses/prepare-expense.test.ts      Accounting examples and invariant tests
tests/support/database-harness.ts                           Shared Phase 2 postgres.js harness extensions
tests/support/api-harness.ts                                Route request/session fixture
tests/integration/expenses/*.test.ts                   PostgreSQL constraints, idempotency and concurrency
tests/api/expenses/expense-routes.test.ts              Status/error contract and permission regression tests
```

## Cross-phase contracts used by this plan

Phase 1 exports `parseDecimalRate()` / `convertMinorAmount()` from `src/domain/exchange-rate/decimal-rate.ts`, `allocateByWeights()` from `src/domain/splitting/allocation.ts`, and `splitExpense()` from `src/domain/splitting/split.ts`. Phase 3 must export `authorizeActivityOperation(tx, input)` and `ActivityAuthorization` from `src/server/permissions/authorize-activity-operation.ts`; its implementation order is Session → membership exists → activity lifecycle → member status → role → ownership → operation. If those files differ when implementation begins, align the earlier phase before starting this plan rather than creating a second permission or money abstraction.

### Task 1: Add Expense fact tables and database invariants

**Files:**

- Create: `src/server/db/schema/expenses.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `drizzle/0003_expense_facts.sql`
- Test: `tests/integration/expenses/expense-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDatabaseHarness } from "../support/database-harness";

const db = createDatabaseHarness();
beforeAll(() => db.start());
afterAll(() => db.stop());

test("同一用户重试同一个 client_mutation_id 只能保留一笔消费", async () => {
  const seed = await db.seedActiveActivity();
  const row = {
    id: crypto.randomUUID(),
    activityId: seed.activityId,
    title: "晚餐",
    category: "FOOD",
    originalCurrency: "CNY",
    originalAmountMinor: 1000n,
    baseCurrency: "CNY",
    baseAmountMinor: 1000n,
    exchangeRate: "1",
    exchangeRateSource: "IDENTITY",
    exchangeRateAt: new Date(),
    splitMode: "EQUAL",
    occurredAt: new Date(),
    createdByMemberId: seed.memberId,
    createdByUserId: seed.userId,
    clientMutationId: "01JEXPENSEMUTATION00000001",
    version: 1,
  };
  await db.insertExpense(row);
  await expect(
    db.insertExpense({ ...row, id: crypto.randomUUID() }),
  ).rejects.toMatchObject({ code: "23505" });
});
```

- [ ] **Step 2: Run the test and verify the expected failure**

Run: `npm run test:integration -- tests/integration/expenses/expense-schema.test.ts`

Expected: FAIL because `expenses` and `insertExpense` do not exist.

- [ ] **Step 3: Add the minimal Drizzle schema and migration**

```ts
// src/server/db/schema/expenses.ts
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
import { sql } from "drizzle-orm";
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

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey(),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id),
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
      .references(() => activityMembers.id),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id),
    clientMutationId: text("client_mutation_id").notNull(),
    version: bigint("version", { mode: "number" }).notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByMemberId: text("deleted_by_member_id").references(
      () => activityMembers.id,
    ),
  },
  (t) => [
    uniqueIndex("expenses_creator_mutation_uq").on(
      t.createdByUserId,
      t.clientMutationId,
    ),
    index("expenses_activity_occurred_idx").on(t.activityId, t.occurredAt),
    check("expenses_original_positive", sql`${t.originalAmountMinor} > 0`),
    check("expenses_base_positive", sql`${t.baseAmountMinor} > 0`),
    check("expenses_version_positive", sql`${t.version} >= 1`),
  ],
);

export const expensePayments = pgTable(
  "expense_payments",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    activityMemberId: uuid("activity_member_id")
      .notNull()
      .references(() => activityMembers.id),
    originalAmountMinor: bigint("original_amount_minor", {
      mode: "bigint",
    }).notNull(),
    baseAmountMinor: bigint("base_amount_minor", { mode: "bigint" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.activityMemberId] }),
    check(
      "expense_payment_original_positive",
      sql`${t.originalAmountMinor} > 0`,
    ),
    check("expense_payment_base_nonnegative", sql`${t.baseAmountMinor} >= 0`),
  ],
);

export const expenseShares = pgTable(
  "expense_shares",
  {
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    activityMemberId: uuid("activity_member_id")
      .notNull()
      .references(() => activityMembers.id),
    splitInputMinor: bigint("split_input_minor", { mode: "bigint" }),
    originalAmountMinor: bigint("original_amount_minor", {
      mode: "bigint",
    }).notNull(),
    baseAmountMinor: bigint("base_amount_minor", { mode: "bigint" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.activityMemberId] }),
    check(
      "expense_share_original_nonnegative",
      sql`${t.originalAmountMinor} >= 0`,
    ),
    check("expense_share_base_nonnegative", sql`${t.baseAmountMinor} >= 0`),
  ],
);
```

The SQL migration must create the same enums, columns, checks, foreign keys, composite primary keys, `expenses_creator_mutation_uq`, and activity/date index. Export all three tables from `src/server/db/schema/index.ts`.

- [ ] **Step 4: Run the schema test**

Run: `npm run test:integration -- tests/integration/expenses/expense-schema.test.ts`

Expected: PASS; the second insert fails with PostgreSQL `23505` on `expenses_creator_mutation_uq`.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/expenses.ts src/server/db/schema/index.ts drizzle/0003_expense_facts.sql tests/integration/expenses/expense-schema.test.ts
git commit -m "feat: add expense fact schema"
```

### Task 2: Define JSON contracts and prepare a complete Expense in the Domain

**Files:**

- Create: `src/features/expenses/categories.ts`
- Create: `src/features/expenses/contracts.ts`
- Create: `src/domain/expenses/prepare-expense.ts`
- Create: `src/server/validation/expense.ts`
- Test: `tests/unit/domain/expenses/prepare-expense.test.ts`

- [ ] **Step 1: Write failing accounting tests**

```ts
import { describe, expect, test } from "vitest";
import { prepareExpense } from "@/domain/expenses/prepare-expense";

const members = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

describe("prepareExpense", () => {
  test("付款人与承担人独立，并稳定分配外币换算尾差", () => {
    const result = prepareExpense({
      originalCurrency: "JPY",
      baseCurrency: "CNY",
      originalAmountMinor: 6001n,
      exchangeRate: "0.048",
      payments: [{ memberId: members[2], amountMinor: 6001n }],
      split: { mode: "EQUAL", members: members.slice(0, 2) },
    });
    expect(result.baseAmountMinor).toBe(28805n);
    expect(result.payments.map((x) => x.baseAmountMinor)).toEqual([28805n]);
    expect(result.shares.map((x) => x.originalAmountMinor)).toEqual([
      3001n,
      3000n,
    ]);
    expect(result.shares.reduce((sum, x) => sum + x.baseAmountMinor, 0n)).toBe(
      28805n,
    );
  });

  test("比例必须精确等于 10000 基点", () => {
    expect(() =>
      prepareExpense({
        originalCurrency: "CNY",
        baseCurrency: "CNY",
        originalAmountMinor: 100n,
        exchangeRate: "1",
        payments: [{ memberId: members[0], amountMinor: 100n }],
        split: {
          mode: "PERCENTAGE",
          entries: [
            { memberId: members[0], value: 3333n },
            { memberId: members[1], value: 3333n },
          ],
        },
      }),
    ).toThrowError("比例合计必须等于 100.00%");
  });
});
```

- [ ] **Step 2: Run the unit test**

Run: `npm run test:unit -- tests/unit/domain/expenses/prepare-expense.test.ts`

Expected: FAIL with `Cannot find module '@/domain/expenses/prepare-expense'`.

- [ ] **Step 3: Implement the contracts and pure preparation function**

```ts
// src/features/expenses/contracts.ts
export type SplitInput =
  | { mode: "EQUAL"; members: string[] }
  | {
      mode: "EXACT" | "PERCENTAGE" | "WEIGHT";
      entries: Array<{ memberId: string; value: string }>;
    };
export interface CreateExpenseRequest {
  clientMutationId: string;
  title: string;
  category: string;
  originalCurrency: string;
  originalAmountMinor: string;
  exchangeRate: string;
  exchangeRateSource: "IDENTITY" | "PROVIDER" | "CACHE" | "MANUAL";
  exchangeRateAt: string;
  occurredAt: string;
  note?: string;
  payments: Array<{ memberId: string; amountMinor: string }>;
  split: SplitInput;
}
export interface ExpenseDto extends CreateExpenseRequest {
  id: string;
  activityId: string;
  baseCurrency: string;
  baseAmountMinor: string;
  createdByMemberId: string;
  createdByUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
```

```ts
// src/domain/expenses/prepare-expense.ts
import { getCurrencyMinorUnits } from "@/domain/currency/currency";
import {
  convertMinorAmount,
  parseDecimalRate,
} from "@/domain/exchange-rate/decimal-rate";
import { allocateByWeights } from "@/domain/splitting/allocation";
import { splitExpense } from "@/domain/splitting/split";

type Input = {
  originalCurrency: string;
  baseCurrency: string;
  originalAmountMinor: bigint;
  exchangeRate: string;
  payments: Array<{ memberId: string; amountMinor: bigint }>;
  split:
    | { mode: "EQUAL"; members: string[] }
    | {
        mode: "EXACT" | "PERCENTAGE" | "WEIGHT";
        entries: Array<{ memberId: string; value: bigint }>;
      };
};

/**
 * 将用户输入收敛为可持久化的 Expense 事实。
 * 先计算唯一的主币总额，再分别按稳定 memberId 顺序分配付款行和承担行，
 * 避免逐行换算产生或丢失最小货币单位。
 */
export function prepareExpense(input: Input) {
  const rate = parseDecimalRate(input.exchangeRate);
  const paymentTotal = input.payments.reduce(
    (sum, row) => sum + row.amountMinor,
    0n,
  );
  if (paymentTotal !== input.originalAmountMinor)
    throw new Error("付款合计必须等于消费金额");
  const baseAmountMinor = convertMinorAmount(
    input.originalAmountMinor,
    getCurrencyMinorUnits(input.originalCurrency),
    getCurrencyMinorUnits(input.baseCurrency),
    rate,
  );
  const sharesOriginal =
    input.split.mode === "EQUAL"
      ? splitExpense({
          mode: "EQUAL",
          totalMinor: input.originalAmountMinor,
          memberIds: input.split.members,
        })
      : input.split.mode === "EXACT"
        ? splitExpense({
            mode: "EXACT",
            totalMinor: input.originalAmountMinor,
            shares: input.split.entries.map((x) => ({
              memberId: x.memberId,
              amountMinor: x.value,
            })),
          })
        : input.split.mode === "PERCENTAGE"
          ? splitExpense({
              mode: "PERCENTAGE",
              totalMinor: input.originalAmountMinor,
              shares: input.split.entries.map((x) => ({
                memberId: x.memberId,
                basisPoints: x.value,
              })),
            })
          : splitExpense({
              mode: "WEIGHT",
              totalMinor: input.originalAmountMinor,
              shares: input.split.entries.map((x) => ({
                memberId: x.memberId,
                weightHundredths: x.value,
              })),
            });
  const paymentBase = allocateByWeights(
    baseAmountMinor,
    input.payments.map((x) => ({
      memberId: x.memberId,
      weight: x.amountMinor,
    })),
  );
  const shareBase = allocateByWeights(
    baseAmountMinor,
    sharesOriginal.map((x) => ({
      memberId: x.memberId,
      weight: x.amountMinor,
    })),
  );
  const payments = paymentBase.map((x) => ({
    memberId: x.memberId,
    originalAmountMinor: input.payments.find((p) => p.memberId === x.memberId)!
      .amountMinor,
    baseAmountMinor: x.amountMinor,
  }));
  const shares = shareBase.map((x) => ({
    memberId: x.memberId,
    splitInputMinor:
      input.split.mode === "EQUAL"
        ? null
        : input.split.entries.find((e) => e.memberId === x.memberId)!.value,
    originalAmountMinor: sharesOriginal.find(
      (row) => row.memberId === x.memberId,
    )!.amountMinor,
    baseAmountMinor: x.amountMinor,
  }));
  if (!shares.some((x) => x.originalAmountMinor > 0n))
    throw new Error("至少一名成员必须承担大于零的金额");
  return { baseAmountMinor, payments, shares };
}
```

`src/server/validation/expense.ts` must use Zod to require a positive decimal-string amount, non-empty title, ISO currency code, valid timestamps, at least one payment and participant, unique member IDs, percentage inputs totaling `10000`, and weight inputs greater than zero. Error messages must be Chinese, for example `付款合计必须等于消费金额` and `外币消费必须提供有效汇率`.

- [ ] **Step 4: Run unit tests**

Run: `npm run test:unit -- tests/unit/domain/expenses/prepare-expense.test.ts`

Expected: PASS, including the exact JPY/CNY allocation and percentage rejection.

- [ ] **Step 5: Commit**

```bash
git add src/features/expenses src/domain/expenses src/server/validation/expense.ts tests/unit/domain/expenses/prepare-expense.test.ts
git commit -m "feat: prepare complete expense facts"
```

### Task 3: Isolate exchange-rate provider and cache fallback

**Files:**

- Create: `src/server/db/schema/exchange-rates.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `drizzle/0003_expense_facts.sql`
- Create: `src/server/services/exchange-rate-service.ts`
- Create: `src/server/repositories/exchange-rate-repository.ts`
- Test: `tests/unit/server/exchange-rate-service.test.ts`

- [ ] **Step 1: Write the failing fallback test**

```ts
import { expect, test, vi } from "vitest";
import { ExchangeRateService } from "@/server/services/exchange-rate-service";

test("Provider 失败时使用最近缓存而不阻塞记账", async () => {
  const provider = { getRate: vi.fn().mockRejectedValue(new Error("timeout")) };
  const cache = {
    findToday: vi.fn().mockResolvedValue(null),
    findLatest: vi.fn().mockResolvedValue({
      rate: "0.048",
      capturedAt: new Date("2026-08-22T08:00:00Z"),
    }),
    save: vi.fn(),
  };
  await expect(
    new ExchangeRateService(provider, cache).suggest(
      "JPY",
      "CNY",
      new Date("2026-08-23T08:00:00Z"),
    ),
  ).resolves.toMatchObject({ rate: "0.048", source: "CACHE" });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/server/exchange-rate-service.test.ts`

Expected: FAIL because `ExchangeRateService` does not exist.

- [ ] **Step 3: Implement the minimal provider boundary**

```ts
export interface ExchangeRateProvider {
  getRate(
    from: string,
    to: string,
    at: Date,
  ): Promise<{ rate: string; capturedAt: Date; provider: string }>;
}
export interface ExchangeRateCache {
  findToday(
    from: string,
    to: string,
    at: Date,
  ): Promise<{ rate: string; capturedAt: Date } | null>;
  findLatest(
    from: string,
    to: string,
  ): Promise<{ rate: string; capturedAt: Date } | null>;
  save(value: {
    from: string;
    to: string;
    rate: string;
    capturedAt: Date;
    provider: string;
  }): Promise<void>;
}

/** Provider 只提供建议；保存 Expense 时使用请求中的精确字符串快照，之后不再追随实时汇率。 */
export class ExchangeRateService {
  constructor(
    private readonly provider: ExchangeRateProvider,
    private readonly cache: ExchangeRateCache,
  ) {}
  async suggest(from: string, to: string, at: Date) {
    if (from === to)
      return { rate: "1", source: "IDENTITY" as const, capturedAt: at };
    try {
      const value = await this.provider.getRate(from, to, at);
      await this.cache.save({ from, to, ...value });
      return {
        rate: value.rate,
        source: "PROVIDER" as const,
        capturedAt: value.capturedAt,
      };
    } catch {
      const cached =
        (await this.cache.findToday(from, to, at)) ??
        (await this.cache.findLatest(from, to));
      return cached ? { ...cached, source: "CACHE" as const } : null;
    }
  }
}
```

Add `exchange_rate_cache` with `(base_currency, quote_currency, captured_at, provider, rate)`; do not couple the service to a concrete public API in V1. A `null` suggestion makes the UI request manual input rather than creating a draft.

- [ ] **Step 4: Run the test**

Run: `npm run test:unit -- tests/unit/server/exchange-rate-service.test.ts`

Expected: PASS; timeout resolves to the cached exact string.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/exchange-rates.ts src/server/db/schema/index.ts drizzle/0003_expense_facts.sql src/server/repositories/exchange-rate-repository.ts src/server/services/exchange-rate-service.ts tests/unit/server/exchange-rate-service.test.ts
git commit -m "feat: add exchange rate fallback service"
```

### Task 4: Create Expense idempotently in one transaction

**Files:**

- Create: `src/server/repositories/expense-repository.ts`
- Create: `src/server/services/expense-service.ts`
- Test: `tests/integration/expenses/create-expense.test.ts`

- [ ] **Step 1: Write the failing response-loss/idempotency test**

```ts
import { expect, test } from "vitest";
import { createExpenseHarness } from "./support/expense-harness";

test("重复创建返回原资源且不重复 Audit 与 Revision", async () => {
  const h = await createExpenseHarness();
  const request = h.validRequest({
    clientMutationId: "01JEXPENSERETRY0000000001",
  });
  const first = await h.service.create(h.session, h.activityId, request);
  const second = await h.service.create(h.session, h.activityId, request);
  expect(second.expense.id).toBe(first.expense.id);
  expect(second.idempotentReplay).toBe(true);
  expect(await h.count("expenses")).toBe(1);
  expect(await h.countAudit("EXPENSE_CREATED")).toBe(1);
  expect(await h.activityRevision()).toBe(1n);
});
```

- [ ] **Step 2: Run the integration test**

Run: `npm run test:integration -- tests/integration/expenses/create-expense.test.ts`

Expected: FAIL because `ExpenseService.create` is missing.

- [ ] **Step 3: Implement the transactional service**

```ts
/**
 * Expense 创建事务的唯一入口。幂等检查必须位于权限检查之后、任何副作用之前；
 * 冲突插入时再次按唯一键读取，以覆盖两个请求同时通过首次查询的竞争窗口。
 */
async create(session: Session, activityId: string, request: CreateExpenseRequest) {
  return this.db.transaction(async (tx) => {
    const auth = await authorizeActivityOperation(tx, { session, activityId, operation: "EXPENSE_CREATE" });
    const existing = await this.repo.findByCreatorMutation(tx, auth.userId, request.clientMutationId);
    if (existing) return { expense: existing, idempotentReplay: true };
    const prepared = prepareExpense(toDomainInput(request, auth.activity.baseCurrency));
    try {
      const expense = await this.repo.insertAggregate(tx, { request, prepared, activityId, createdByUserId: auth.userId, createdByMemberId: auth.member.id });
      await this.repo.insertAudit(tx, { activityId, actorUserId: auth.userId, actorMemberId: auth.member.id, eventType: "EXPENSE_CREATED", targetId: expense.id });
      await this.repo.incrementRevision(tx, activityId);
      await this.repo.savePreferences(tx, auth.userId, activityId, request);
      return { expense, idempotentReplay: false };
    } catch (error) {
      if (!isUniqueViolation(error, "expenses_creator_mutation_uq")) throw error;
      return { expense: await this.repo.requireByCreatorMutation(tx, auth.userId, request.clientMutationId), idempotentReplay: true };
    }
  });
}
```

`insertAggregate` must insert one Expense and replace neither payments nor shares; creation inserts all children once. It must verify every referenced ActivityMember belongs to the same activity and has an accounting identity. The saved `exchange_rate`, source, timestamp, original/base totals and child base allocations are immutable snapshots. Ordinary creation does not create notifications.

- [ ] **Step 4: Run the integration test**

Run: `npm run test:integration -- tests/integration/expenses/create-expense.test.ts`

Expected: PASS with one Expense, one audit event, and one revision increment after two identical calls.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/expense-repository.ts src/server/services/expense-service.ts tests/integration/expenses/create-expense.test.ts
git commit -m "feat: create expenses idempotently"
```

### Task 5: Add optimistic update, soft delete, and LEFT protection

**Files:**

- Modify: `src/server/services/expense-service.ts`
- Modify: `src/server/repositories/expense-repository.ts`
- Test: `tests/integration/expenses/update-delete-expense.test.ts`

- [ ] **Step 1: Write failing concurrency and permission tests**

```ts
import { expect, test } from "vitest";
import { createExpenseHarness } from "./support/expense-harness";

test("旧版本修改返回 409 VERSION_CONFLICT 且不覆盖新值", async () => {
  const h = await createExpenseHarness();
  const expense = await h.createExpense();
  await h.service.update(h.ownerSession, h.activityId, expense.id, {
    ...h.validRequest(),
    version: 1,
    title: "新标题",
  });
  await expect(
    h.service.update(h.adminSession, h.activityId, expense.id, {
      ...h.validRequest(),
      version: 1,
      title: "旧表单",
    }),
  ).rejects.toMatchObject({
    status: 409,
    code: "VERSION_CONFLICT",
    message: "这笔消费已被其他人修改，请刷新后重试",
  });
});

test("LEFT 成员即使是创建者也不能修改或删除历史消费", async () => {
  const h = await createExpenseHarness();
  const expense = await h.createExpenseBy(h.leftUserBeforeLeaving);
  await expect(
    h.service.remove(h.leftSession, h.activityId, expense.id, 1),
  ).rejects.toMatchObject({ status: 403, code: "EXPENSE_READ_ONLY_FOR_LEFT" });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration -- tests/integration/expenses/update-delete-expense.test.ts`

Expected: FAIL because update/delete operations are not implemented.

- [ ] **Step 3: Implement conditional update and soft delete**

```ts
async update(session: Session, activityId: string, expenseId: string, request: UpdateExpenseRequest) {
  return this.db.transaction(async (tx) => {
    const current = await this.repo.requireAggregate(tx, activityId, expenseId);
    const auth = await authorizeActivityOperation(tx, { session, activityId, operation: "EXPENSE_UPDATE", resourceOwnerMemberId: current.createdByMemberId });
    const prepared = prepareExpense(toDomainInput(request, auth.activity.baseCurrency));
    const updated = await this.repo.updateWhereVersion(tx, expenseId, request.version, request, prepared);
    if (!updated) throw conflict("VERSION_CONFLICT", "这笔消费已被其他人修改，请刷新后重试");
    await this.repo.replacePaymentsAndShares(tx, expenseId, prepared);
    await this.repo.insertAudit(tx, { activityId, actorUserId: auth.userId, actorMemberId: auth.member.id, eventType: "EXPENSE_UPDATED", targetId: expenseId });
    await this.repo.incrementRevision(tx, activityId);
    return updated;
  });
}

async remove(session: Session, activityId: string, expenseId: string, version: number) {
  return this.db.transaction(async (tx) => {
    const current = await this.repo.requireAggregate(tx, activityId, expenseId);
    const auth = await authorizeActivityOperation(tx, { session, activityId, operation: "EXPENSE_DELETE", resourceOwnerMemberId: current.createdByMemberId });
    const removed = await this.repo.softDeleteWhereVersion(tx, expenseId, version, auth.member.id);
    if (!removed) throw conflict("VERSION_CONFLICT", "这笔消费已被其他人修改或删除，请刷新后重试");
    await this.repo.insertAudit(tx, { activityId, actorUserId: auth.userId, actorMemberId: auth.member.id, eventType: "EXPENSE_DELETED", targetId: expenseId });
    await this.repo.incrementRevision(tx, activityId);
  });
}
```

The permission implementation must reject LEFT before role/ownership checks. ACTIVE OWNER/ADMIN may update all; ACTIVE MEMBER may update only facts they created. ENDED, ARCHIVED and DELETED lifecycle results take precedence over member role. Soft-deleted rows disappear from normal list/statistics/Ledger and have no V1 restore API.

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- tests/integration/expenses/update-delete-expense.test.ts`

Expected: PASS; stale writes remain unchanged and LEFT receives `EXPENSE_READ_ONLY_FOR_LEFT`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/expense-service.ts src/server/repositories/expense-repository.ts tests/integration/expenses/update-delete-expense.test.ts
git commit -m "feat: protect expense updates with version locks"
```

### Task 6: Expose Expense list, detail, create, update, and delete routes

**Files:**

- Create: `src/app/api/activities/[activityId]/expenses/route.ts`
- Create: `src/app/api/activities/[activityId]/expenses/[expenseId]/route.ts`
- Test: `tests/api/expenses/expense-routes.test.ts`

- [ ] **Step 1: Write the failing route test**

```ts
import { expect, test } from "vitest";
import { apiHarness } from "../support/api-harness";

test("POST 返回 JSON-safe 金额与幂等重放标志", async () => {
  const h = await apiHarness();
  const body = h.validExpenseRequest();
  const first = await h.post(`/api/activities/${h.activityId}/expenses`, body);
  const replay = await h.post(`/api/activities/${h.activityId}/expenses`, body);
  expect(first.status).toBe(201);
  expect(typeof first.json.expense.baseAmountMinor).toBe("string");
  expect(replay.status).toBe(200);
  expect(replay.json.idempotentReplay).toBe(true);
});
```

- [ ] **Step 2: Run the route test**

Run: `npm run test:unit -- tests/api/expenses/expense-routes.test.ts`

Expected: FAIL with route module not found.

- [ ] **Step 3: Implement thin Route Handlers**

```ts
// POST excerpt; GET uses the same session and activity visibility checks.
export async function POST(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const session = await requireSession(request);
  const input = createExpenseSchema.parse(await request.json());
  const { activityId } = await context.params;
  const result = await expenseService.create(session, activityId, input);
  return NextResponse.json(serializeExpenseResult(result), {
    status: result.idempotentReplay ? 200 : 201,
  });
}
```

The item route must accept `PUT` with a required integer `version` and `DELETE` with `{ version }`. Map stable application errors to the global `{ error: { code, message, fieldErrors, details } }` shape. List accepts only `query`, fixed `category`, and `mine=true`; it excludes soft-deleted rows and returns original/base amount strings plus status metadata needed by Phase 6.

- [ ] **Step 4: Run API tests**

Run: `npm run test:unit -- tests/api/expenses/expense-routes.test.ts`

Expected: PASS for 201 create, 200 replay, 409 version conflict, 403 LEFT write, and 422 accounting validation.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/activities/[activityId]/expenses tests/api/expenses/expense-routes.test.ts
git commit -m "feat: expose expense API"
```

## Phase 4 verification gate

**Files:**

- Verify only; modify only Phase 4 files when a failure is caused by this phase.

- [ ] **Step 1: Run focused invariant tests**

Run: `npm run test:unit -- tests/unit/domain/expenses && npm run test:integration -- tests/integration/expenses && npm run test:unit -- tests/api/expenses`

Expected: PASS; payment/share original and base totals are conserved, retries are idempotent, and stale versions are rejected.

- [ ] **Step 2: Run repository gates**

Run: `npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Inspect forbidden coupling**

Run: `rg -n "from ['\"](react|next|drizzle-orm)" src/domain/expenses`

Expected: no matches.

- [ ] **Step 4: Inspect required idempotency and version constraints**

Run: `rg -n "createdByUserId.*clientMutationId|expenses_creator_mutation_uq|VERSION_CONFLICT|EXPENSE_READ_ONLY_FOR_LEFT" src tests drizzle`

Expected: matches exist in schema/migration, service, and tests.

- [ ] **Step 5: Commit verification fixes if needed**

```bash
git add src/domain/expenses src/features/expenses src/server/db/schema src/server/repositories/expense-repository.ts src/server/services src/server/validation/expense.ts src/app/api/activities tests/unit/domain/expenses tests/integration/expenses tests/api/expenses drizzle/0003_expense_facts.sql
git commit -m "chore: complete expense phase verification"
```
