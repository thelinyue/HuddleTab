# HuddleTab Phase 5 Ledger and Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculate authoritative activity balances and recommendations dynamically from facts, and record real Settlement transfers with strict lifecycle, LEFT-member, overpayment, audit, revision, notification, and optimistic-lock rules.

**Architecture:** PostgreSQL stores Expense/Payment/Share and Settlement facts only. `LedgerService` loads undeleted facts and delegates deterministic balance/recommendation calculation to Phase 1 pure Domain functions; `SettlementService` always reauthorizes and recalculates current debt inside a transaction before writing an actual transfer.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL 18, Vitest, fast-check, Testcontainers, Next.js Route Handlers.

---

## File responsibility map

```text
src/server/db/schema/settlements.ts                                  Settlement facts; never recommendations or balances
src/features/settlements/contracts.ts                                JSON-safe balance, recommendation and settlement DTOs
src/server/repositories/ledger-repository.ts                         Read undeleted accounting facts in one consistent snapshot
src/server/repositories/settlement-repository.ts                     Settlement persistence, conditional version writes, audit/revision
src/server/services/ledger-service.ts                                Authoritative balance and recommendation orchestration
src/server/services/settlement-service.ts                            Permission, overpayment confirmation and fact transactions
src/server/validation/settlement.ts                                  Positive base-currency amount and confirmation schemas
src/app/api/activities/[activityId]/ledger/route.ts                  Dynamic member balances
src/app/api/activities/[activityId]/settlement-recommendations/route.ts Dynamic non-persisted recommendations
src/app/api/activities/[activityId]/settlements/route.ts             Actual Settlement list/create
src/app/api/activities/[activityId]/settlements/[settlementId]/route.ts Versioned update/delete
tests/unit/domain/ledger/*.test.ts                                   Formula, conservation and recommendation determinism
tests/support/database-harness.ts                           Shared Phase 2 postgres.js harness extensions
tests/support/api-harness.ts                                Route request/session fixture
tests/integration/settlements/*.test.ts                              Lifecycle, LEFT, overpayment, version and transaction behavior
tests/api/settlements/*.test.ts                                      HTTP contract and Chinese errors
```

## Cross-phase contracts used by this plan

Phase 1 exports `calculateLedger(facts)` from `src/domain/ledger/ledger.ts` and `recommendSettlements(balances)` from `src/domain/settlement/recommendation.ts`; all amounts are `bigint`, and ties sort by `memberId ASC`. Phase 3 exports `authorizeActivityOperation`. Phase 4 exports Expense schemas and `ExpenseRepository` facts. Do not add `member_balances`, `ledger_rows`, or persisted recommendation tables.

### Task 1: Add the Settlement fact schema

**Files:**
- Create: `src/server/db/schema/settlements.ts`
- Modify: `src/server/db/schema/index.ts`
- Create: `drizzle/0004_settlement_facts.sql`
- Test: `tests/integration/settlements/settlement-schema.test.ts`

- [ ] **Step 1: Write the failing constraint test**

```ts
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDatabaseHarness } from "../support/database-harness";

const db = createDatabaseHarness();
beforeAll(() => db.start());
afterAll(() => db.stop());

test("Settlement 拒绝非正金额和相同付款收款人", async () => {
  const seed = await db.seedActiveActivity();
  await expect(db.insertSettlement({ id: crypto.randomUUID(), activityId: seed.activityId,
    payerMemberId: seed.memberId, receiverMemberId: seed.memberId, amountMinor: 0n,
    currency: seed.baseCurrency, occurredAt: new Date(), createdByMemberId: seed.memberId, version: 1 }))
    .rejects.toMatchObject({ code: "23514" });
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration -- tests/integration/settlements/settlement-schema.test.ts`

Expected: FAIL because `settlements` does not exist.

- [ ] **Step 3: Implement the schema and migration**

```ts
// src/server/db/schema/settlements.ts
import { bigint, check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { activities, activityMembers } from "./activity";

export const settlements = pgTable("settlements", {
  id: uuid("id").primaryKey(),
  activityId: text("activity_id").notNull().references(() => activities.id),
  payerMemberId: text("payer_member_id").notNull().references(() => activityMembers.id),
  receiverMemberId: text("receiver_member_id").notNull().references(() => activityMembers.id),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  currency: text("currency").notNull(), occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(), note: text("note"),
  createdByMemberId: text("created_by_member_id").notNull().references(() => activityMembers.id),
  version: bigint("version", { mode: "number" }).notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }), deletedByMemberId: text("deleted_by_member_id").references(() => activityMembers.id),
}, (t) => [
  index("settlements_activity_occurred_idx").on(t.activityId, t.occurredAt),
  check("settlements_amount_positive", sql`${t.amountMinor} > 0`),
  check("settlements_distinct_members", sql`${t.payerMemberId} <> ${t.receiverMemberId}`),
  check("settlements_version_positive", sql`${t.version} >= 1`),
]);
```

The migration must also add same-activity composite foreign keys for payer, receiver, creator and deleted-by members using `(member_id, activity_id) → activity_members(id, activity_id)`. Currency equality to `activities.base_currency` is checked while the activity row is locked in the service because PostgreSQL checks cannot reference another table.

- [ ] **Step 4: Run the schema test**

Run: `npm run test:integration -- tests/integration/settlements/settlement-schema.test.ts`

Expected: PASS with PostgreSQL `23514` for invalid facts.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/settlements.ts src/server/db/schema/index.ts drizzle/0004_settlement_facts.sql tests/integration/settlements/settlement-schema.test.ts
git commit -m "feat: add settlement fact schema"
```

### Task 2: Calculate Ledger dynamically from undeleted facts

**Files:**
- Create: `src/features/settlements/contracts.ts`
- Create: `src/server/repositories/ledger-repository.ts`
- Create: `src/server/services/ledger-service.ts`
- Test: `tests/unit/domain/ledger/ledger-facts.test.ts`
- Test: `tests/integration/settlements/ledger-service.test.ts`

- [ ] **Step 1: Write the failing formula test**

```ts
import { expect, test } from "vitest";
import { calculateLedger } from "@/domain/ledger/ledger";

test("付款减承担加转出减转入，且成员净额守恒", () => {
  const balances = calculateLedger({ memberIds: ["A", "B", "C"],
    payments: [{ memberId: "A", amountMinor: 900n }],
    shares: [{ memberId: "B", amountMinor: 300n }, { memberId: "C", amountMinor: 600n }],
    settlements: [{ payerMemberId: "C", receiverMemberId: "A", amountMinor: 200n }] });
  expect(balances).toEqual([
    { memberId: "A", netMinor: 700n },
    { memberId: "B", netMinor: -300n },
    { memberId: "C", netMinor: -400n },
  ]);
  expect(balances.reduce((sum, row) => sum + row.netMinor, 0n)).toBe(0n);
});
```

- [ ] **Step 2: Run the unit test**

Run: `npm run test:integration -- tests/integration/settlements/ledger-service.test.ts`

Expected: FAIL because `LedgerService` and `LedgerRepository` do not exist; the Phase 1 Domain test remains green.

- [ ] **Step 3: Implement the service adapter using the Phase 1 Domain function**

```ts
// src/server/services/ledger-service.ts
export class LedgerService {
  constructor(private readonly db: Database, private readonly repo: LedgerRepository) {}
  async getBalances(session: Session, activityId: string) {
    return this.db.transaction(async (tx) => {
      const auth = await authorizeActivityOperation(tx, { session, activityId, operation: "LEDGER_READ" });
      const facts = await this.repo.loadFacts(tx, activityId); // queries only deleted_at IS NULL rows
      return { activityId, currency: auth.activity.baseCurrency, revision: auth.activity.revision.toString(), balances: calculateLedger(facts) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }
}
```

`src/features/settlements/contracts.ts` must expose amount and revision values as strings. `LedgerRepository.loadFacts` includes every ACTIVE or LEFT accounting identity, undeleted Expense payments/shares, and undeleted Settlements; it must not query or write any balance table.

- [ ] **Step 4: Run both tests**

Run: `npm run test:unit -- tests/unit/domain/ledger/ledger-facts.test.ts && npm run test:integration -- tests/integration/settlements/ledger-service.test.ts`

Expected: PASS; soft-deleted Expense and Settlement rows are excluded and `Σ net = 0`.

- [ ] **Step 5: Commit**

```bash
git add src/features/settlements/contracts.ts src/server/repositories/ledger-repository.ts src/server/services/ledger-service.ts tests/unit/domain/ledger tests/integration/settlements/ledger-service.test.ts
git commit -m "feat: calculate authoritative activity ledger"
```

### Task 3: Return deterministic, non-persisted recommendations

**Files:**
- Modify: `src/server/services/ledger-service.ts`
- Create: `src/app/api/activities/[activityId]/ledger/route.ts`
- Create: `src/app/api/activities/[activityId]/settlement-recommendations/route.ts`
- Test: `tests/api/settlements/ledger-routes.test.ts`

- [ ] **Step 1: Write the failing recommendation test**

```ts
import { expect, test } from "vitest";
import { apiHarness } from "../support/api-harness";

test("推荐每次由当前 Ledger 计算且平局按 member id 稳定", async () => {
  const h = await apiHarness(); await h.seedBalances({ A: 500n, B: 500n, C: -500n, D: -500n });
  const response = await h.get(`/api/activities/${h.activityId}/settlement-recommendations`);
  expect(response.status).toBe(200);
  expect(response.json.recommendations).toEqual([
    { payerMemberId: "C", receiverMemberId: "A", amountMinor: "500" },
    { payerMemberId: "D", receiverMemberId: "B", amountMinor: "500" },
  ]);
  expect(await h.tableExists("settlement_recommendations")).toBe(false);
});
```

- [ ] **Step 2: Run the API test**

Run: `npm run test:unit -- tests/api/settlements/ledger-routes.test.ts`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement read-only routes**

```ts
export async function GET(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const session = await requireSession(request); const { activityId } = await context.params;
  const ledger = await ledgerService.getBalances(session, activityId);
  return NextResponse.json(serializeLedger({ ...ledger, recommendations: recommendSettlements(ledger.balances) }));
}
```

The ledger route returns balances only; the recommendations route returns the same authoritative `revision`, currency, and calculated transfers. Clicking a recommendation in Phase 6 will prefill a separate form; this route never writes Settlement facts.

- [ ] **Step 4: Run the API test**

Run: `npm run test:unit -- tests/api/settlements/ledger-routes.test.ts`

Expected: PASS and no persisted recommendation table.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/ledger-service.ts src/app/api/activities/[activityId]/ledger src/app/api/activities/[activityId]/settlement-recommendations tests/api/settlements/ledger-routes.test.ts
git commit -m "feat: expose dynamic settlement recommendations"
```

### Task 4: Enforce Settlement permission and lifecycle rules

**Files:**
- Create: `src/server/validation/settlement.ts`
- Create: `src/server/repositories/settlement-repository.ts`
- Create: `src/server/services/settlement-service.ts`
- Test: `tests/integration/settlements/settlement-permissions.test.ts`

- [ ] **Step 1: Write failing LEFT and lifecycle tests**

```ts
import { expect, test } from "vitest";
import { settlementHarness } from "./support/settlement-harness";

test("LEFT 只能以自己为付款人，但收款人可为 ACTIVE 或 LEFT", async () => {
  const h = await settlementHarness();
  await expect(h.service.create(h.leftSession, h.activityId, h.request({ payerMemberId: h.otherMemberId })))
    .rejects.toMatchObject({ status: 403, code: "SETTLEMENT_PAYER_MUST_BE_SELF" });
  await expect(h.service.create(h.leftSession, h.activityId, h.request({ payerMemberId: h.leftMemberId, receiverMemberId: h.secondLeftMemberId })))
    .resolves.toMatchObject({ settlement: { payerMemberId: h.leftMemberId, receiverMemberId: h.secondLeftMemberId } });
});

test("活动生命周期优先于 LEFT 权限", async () => {
  const h = await settlementHarness({ activityStatus: "ARCHIVED" });
  await expect(h.service.create(h.leftSession, h.activityId, h.request({ payerMemberId: h.leftMemberId })))
    .rejects.toMatchObject({ status: 409, code: "ACTIVITY_ARCHIVED_READ_ONLY" });
});
```

- [ ] **Step 2: Run the integration tests**

Run: `npm run test:integration -- tests/integration/settlements/settlement-permissions.test.ts`

Expected: FAIL because `SettlementService` does not exist.

- [ ] **Step 3: Implement validation and authorization entry**

```ts
// src/server/validation/settlement.ts
export const createSettlementSchema = z.object({
  payerMemberId: z.string().uuid(), receiverMemberId: z.string().uuid(),
  amountMinor: z.string().regex(/^\d+$/, "结算金额必须是正整数最小单位").refine((x) => BigInt(x) > 0n, "结算金额必须大于零"),
  occurredAt: z.string().datetime(), note: z.string().trim().max(500).optional(),
  confirmOverSettlement: z.boolean().default(false),
}).refine((x) => x.payerMemberId !== x.receiverMemberId, { message: "付款人和收款人不能相同", path: ["receiverMemberId"] });
```

```ts
async authorizeWrite(tx: Transaction, session: Session, activityId: string, input: SettlementWriteInput, current?: SettlementRow) {
  const auth = await authorizeActivityOperation(tx, { session, activityId,
    operation: current ? "SETTLEMENT_UPDATE" : "SETTLEMENT_CREATE",
    resourceOwnerMemberId: current?.createdByMemberId, settlementPayerMemberId: input.payerMemberId });
  if ((auth.member.role === "MEMBER" || auth.member.status === "LEFT") && input.payerMemberId !== auth.member.id)
    throw forbidden("SETTLEMENT_PAYER_MUST_BE_SELF", "你只能记录自己实际支付的结算");
  if (current && (auth.member.role === "MEMBER" || auth.member.status === "LEFT") && current.createdByMemberId !== auth.member.id)
    throw forbidden("SETTLEMENT_NOT_OWNED", "你不能修改别人创建的结算记录");
  await this.repo.requireAccountingMember(tx, activityId, input.receiverMemberId); // ACTIVE or LEFT are both valid
  return auth;
}
```

The Phase 3 permission matrix must allow Settlement writes in ACTIVE and ENDED, but reject ARCHIVED and DELETED before evaluating LEFT/role/ownership. Recommendation amount zero never blocks actual Settlement creation.

- [ ] **Step 4: Run the permission tests**

Run: `npm run test:integration -- tests/integration/settlements/settlement-permissions.test.ts`

Expected: PASS for self-payer LEFT writes, LEFT receiver, and lifecycle-first rejection.

- [ ] **Step 5: Commit**

```bash
git add src/server/validation/settlement.ts src/server/repositories/settlement-repository.ts src/server/services/settlement-service.ts tests/integration/settlements/settlement-permissions.test.ts
git commit -m "feat: enforce settlement permissions"
```

### Task 5: Require explicit confirmation for over-settlement after server recalculation

**Files:**
- Modify: `src/server/services/settlement-service.ts`
- Test: `tests/integration/settlements/over-settlement.test.ts`

- [ ] **Step 1: Write the failing overpayment test**

```ts
import { expect, test } from "vitest";
import { settlementHarness } from "./support/settlement-harness";

test("服务器重算超额并在确认后忠实保存实际金额", async () => {
  const h = await settlementHarness(); await h.seedDebt(h.payerId, h.receiverId, 32650n);
  const input = h.request({ payerMemberId: h.payerId, receiverMemberId: h.receiverId, amountMinor: "40000" });
  await expect(h.service.create(h.payerSession, h.activityId, input)).rejects.toMatchObject({
    status: 409, code: "OVER_SETTLEMENT_CONFIRMATION_REQUIRED",
    message: "本次支付比当前应付多 ¥73.50，保存后可能产生新的反向余额",
    details: { currentPayableMinor: "32650", overAmountMinor: "7350" },
  });
  const saved = await h.service.create(h.payerSession, h.activityId, { ...input, confirmOverSettlement: true });
  expect(saved.settlement.amountMinor).toBe("40000");
});

test("当前推荐为零仍可记录真实 Settlement", async () => {
  const h = await settlementHarness();
  await expect(h.service.create(h.payerSession, h.activityId, { ...h.request(), confirmOverSettlement: true })).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:integration -- tests/integration/settlements/over-settlement.test.ts`

Expected: FAIL because overpayment is not recalculated.

- [ ] **Step 3: Implement the locked recalculation and transaction**

```ts
/**
 * confirmation 只表示用户看过警告，不携带或信任客户端余额。
 * 每次提交都在锁定 Activity 后重新读取事实并计算当前付款方向的应付额。
 */
function payableFromTo(ledger: MemberBalance[], payerId: string, receiverId: string) {
  const payer = ledger.find((row) => row.memberId === payerId)?.netMinor ?? 0n;
  const receiver = ledger.find((row) => row.memberId === receiverId)?.netMinor ?? 0n;
  return payer < 0n && receiver > 0n ? (-payer < receiver ? -payer : receiver) : 0n;
}

async create(session: Session, activityId: string, input: CreateSettlementRequest) {
  return this.db.transaction(async (tx) => {
    await this.repo.lockActivity(tx, activityId);
    const auth = await this.authorizeWrite(tx, session, activityId, input);
    const ledger = calculateLedger(await this.ledgerRepo.loadFacts(tx, activityId));
    const currentPayable = payableFromTo(ledger, input.payerMemberId, input.receiverMemberId);
    const amount = BigInt(input.amountMinor); const over = amount > currentPayable ? amount - currentPayable : 0n;
    if (over > 0n && !input.confirmOverSettlement) throw conflict("OVER_SETTLEMENT_CONFIRMATION_REQUIRED",
      `本次支付比当前应付多 ${formatMoney(over, auth.activity.baseCurrency)}，保存后可能产生新的反向余额`,
      { currentPayableMinor: currentPayable.toString(), overAmountMinor: over.toString() });
    const settlement = await this.repo.insert(tx, { ...input, amountMinor: amount, currency: auth.activity.baseCurrency, activityId, createdByMemberId: auth.member.id });
    await this.repo.insertAudit(tx, { activityId, actorUserId: auth.userId, actorMemberId: auth.member.id, eventType: "SETTLEMENT_CREATED", targetId: settlement.id });
    await this.repo.incrementRevision(tx, activityId);
    await this.repo.notifyReceiver(tx, settlement);
    return { settlement: serializeSettlement(settlement) };
  });
}
```

Do not truncate to `currentPayable`. Partial, exact, over, and recommendation-zero transfers are all actual facts. Audit, receiver notification, and one Revision increment commit with the fact.

- [ ] **Step 4: Run the test**

Run: `npm run test:integration -- tests/integration/settlements/over-settlement.test.ts`

Expected: PASS and the stored amount remains `40000`.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/settlement-service.ts tests/integration/settlements/over-settlement.test.ts
git commit -m "feat: confirm over settlement explicitly"
```

### Task 6: Add versioned Settlement update and soft delete

**Files:**
- Modify: `src/server/services/settlement-service.ts`
- Modify: `src/server/repositories/settlement-repository.ts`
- Test: `tests/integration/settlements/update-delete-settlement.test.ts`

- [ ] **Step 1: Write failing ownership/version tests**

```ts
import { expect, test } from "vitest";
import { settlementHarness } from "./support/settlement-harness";

test("普通或 LEFT 成员不能修改别人创建的 Settlement", async () => {
  const h = await settlementHarness(); const row = await h.createByOwner();
  await expect(h.service.update(h.leftSession, h.activityId, row.id, { ...h.request({ payerMemberId: h.leftMemberId }), version: 1 }))
    .rejects.toMatchObject({ status: 403, code: "SETTLEMENT_NOT_OWNED" });
});

test("旧版本删除返回 VERSION_CONFLICT", async () => {
  const h = await settlementHarness(); const row = await h.createByOwner(); await h.bumpVersion(row.id);
  await expect(h.service.remove(h.ownerSession, h.activityId, row.id, 1)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:integration -- tests/integration/settlements/update-delete-settlement.test.ts`

Expected: FAIL because update/remove are absent.

- [ ] **Step 3: Implement conditional writes**

```ts
const updated = await this.repo.updateWhereVersion(tx, settlementId, input.version, normalizedInput);
if (!updated) throw conflict("VERSION_CONFLICT", "这笔结算已被其他人修改，请刷新后重试");
await this.repo.insertAudit(tx, { activityId, actorUserId: auth.userId, actorMemberId: auth.member.id, eventType: "SETTLEMENT_UPDATED", targetId: settlementId });
await this.repo.incrementRevision(tx, activityId);
```

Delete uses `UPDATE ... SET deleted_at, deleted_by_member_id, version = version + 1 WHERE id = ? AND version = ? AND deleted_at IS NULL`. Update reruns lifecycle, permission, payer-self, ownership and overpayment checks. Delete reruns lifecycle, permission and ownership checks, then removes the fact and lets the next dynamic Ledger read reflect it; delete does not require an overpayment confirmation. Both write Audit and increment Revision in the same transaction. OWNER/ADMIN may manage all records; MEMBER/LEFT require both creator=self and payer=self.

- [ ] **Step 4: Run the tests**

Run: `npm run test:integration -- tests/integration/settlements/update-delete-settlement.test.ts`

Expected: PASS; stale and unauthorized changes produce stable Chinese errors without side effects.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/settlement-service.ts src/server/repositories/settlement-repository.ts tests/integration/settlements/update-delete-settlement.test.ts
git commit -m "feat: version settlement changes"
```

### Task 7: Expose actual Settlement routes and error contract

**Files:**
- Create: `src/app/api/activities/[activityId]/settlements/route.ts`
- Create: `src/app/api/activities/[activityId]/settlements/[settlementId]/route.ts`
- Test: `tests/api/settlements/settlement-routes.test.ts`

- [ ] **Step 1: Write the failing HTTP test**

```ts
import { expect, test } from "vitest";
import { apiHarness } from "../support/api-harness";

test("超额创建先返回可确认的 409，再由明确确认创建事实", async () => {
  const h = await apiHarness(); await h.seedDebt(1000n);
  const first = await h.post(`/api/activities/${h.activityId}/settlements`, h.settlementRequest({ amountMinor: "1200" }));
  expect(first.status).toBe(409); expect(first.json.error.code).toBe("OVER_SETTLEMENT_CONFIRMATION_REQUIRED");
  const confirmed = await h.post(`/api/activities/${h.activityId}/settlements`, h.settlementRequest({ amountMinor: "1200", confirmOverSettlement: true }));
  expect(confirmed.status).toBe(201); expect(confirmed.json.settlement.amountMinor).toBe("1200");
});
```

- [ ] **Step 2: Run the API test**

Run: `npm run test:unit -- tests/api/settlements/settlement-routes.test.ts`

Expected: FAIL because routes are missing.

- [ ] **Step 3: Implement thin handlers**

```ts
export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const session = await requireSession(request); const input = createSettlementSchema.parse(await request.json());
  const { activityId } = await context.params;
  return NextResponse.json(await settlementService.create(session, activityId, input), { status: 201 });
}
```

GET lists undeleted actual Settlement facts and never mixes recommendations into the same collection. PUT requires `version`; DELETE accepts `{ version }`. Map overpayment to 409 with `details.currentPayableMinor` and `details.overAmountMinor`, version conflicts to 409, permission failures to 403, and invalid money/currency to 422.

- [ ] **Step 4: Run API tests**

Run: `npm run test:unit -- tests/api/settlements/settlement-routes.test.ts`

Expected: PASS for partial, exact, over, LEFT, ENDED, ARCHIVED, ownership, and version cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/activities/[activityId]/settlements tests/api/settlements/settlement-routes.test.ts
git commit -m "feat: expose actual settlement API"
```

### Task 8: Expose settlement summary and deterministic CSV export

**Files:**
- Create: `src/server/services/activity-summary-service.ts`
- Create: `src/server/export/expense-csv.ts`
- Create: `src/app/api/activities/[activityId]/summary/route.ts`
- Create: `src/app/api/activities/[activityId]/export.csv/route.ts`
- Test: `tests/api/activities/summary-export.test.ts`

- [ ] **Step 1: Write failing summary and CSV tests**

```ts
import { expect, test } from "vitest";
import { apiHarness } from "../support/api-harness";

test("summary excludes private data and CSV contains the frozen V1 columns", async () => {
  const h = await apiHarness();
  await h.seedExpenseAndBalances();
  const summary = await h.get(`/api/activities/${h.activityId}/summary`);
  expect(summary.json.data).toMatchObject({ activityName: h.activityName, memberCount: 3 });
  expect(JSON.stringify(summary.json)).not.toMatch(/email|attachment|audit/i);
  const csv = await h.getText(`/api/activities/${h.activityId}/export.csv`);
  expect(csv.headers.get("content-type")).toContain("text/csv");
  expect(csv.text).toContain("消费时间,用途,分类,原始金额,原始币种,汇率,主币种金额,付款人,参与成员,分摊方式,创建人,创建时间,备注");
  expect(csv.text).toContain("小王:800 | 小李:400");
});
```

- [ ] **Step 2: Run tests and verify the routes are absent**

Run: `npm run test:unit -- tests/api/activities/summary-export.test.ts`

Expected: FAIL with missing summary/export Route Handlers.

- [ ] **Step 3: Implement one authorized read model and deterministic serializers**

```ts
// src/server/export/expense-csv.ts
export interface ExpenseExportRow {
  occurredAt: string; title: string; category: string; originalAmount: string; originalCurrency: string;
  exchangeRate: string; baseAmount: string; payers: Array<{ name: string; amount: string }>;
  participants: Array<{ name: string; amount: string }>; splitMode: string; creatorName: string;
  createdAt: string; note: string | null;
}
const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`;

/** CSV 只导出已授权的 Expense 事实，不包含邮箱、附件内容或 Audit Log。 */
export function serializeExpenseCsv(rows: readonly ExpenseExportRow[]): string {
  const header = ["消费时间","用途","分类","原始金额","原始币种","汇率","主币种金额","付款人","参与成员","分摊方式","创建人","创建时间","备注"];
  const body = rows.map((row) => [row.occurredAt,row.title,row.category,row.originalAmount,row.originalCurrency,row.exchangeRate,row.baseAmount,row.payers.map((x)=>`${x.name}:${x.amount}`).join(" | "),row.participants.map((x)=>`${x.name}:${x.amount}`).join(" | "),row.splitMode,row.creatorName,row.createdAt,row.note ?? ""].map((value)=>quote(String(value))).join(","));
  return `﻿${[header.join(","), ...body].join("

")}`;
}
```

`ActivitySummaryService.get()` first calls the Phase 3 `authorizeActivityOperation(..., { operation: "LEDGER_READ" })`, then reads one repeatable-read snapshot containing activity name/date, member count, total Expense, original-currency totals, current user's balance, all balances, Phase 1 recommendations and category totals. The summary JSON never includes email, attachment bytes/paths or Audit Log. The CSV query includes only undeleted Expense facts and the exact V1 columns above; multi-member fields are sorted by ActivityMember ID and rendered as `姓名:金额 | 姓名:金额`.

The summary route returns `{ data: ... }`. The CSV route returns UTF-8 with BOM, `Content-Type: text/csv; charset=utf-8`, a safe generated filename, and `Cache-Control: private, no-store`.

- [ ] **Step 4: Run API tests**

Run: `npm run test:unit -- tests/api/activities/summary-export.test.ts`

Expected: PASS; values come from the same authoritative facts as Ledger and no private fields are present.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/activity-summary-service.ts src/server/export/expense-csv.ts src/app/api/activities/[activityId]/summary src/app/api/activities/[activityId]/export.csv tests/api/activities/summary-export.test.ts
git commit -m "feat: add settlement summary and csv export"
```

## Phase 5 verification gate

**Files:**
- Verify only; modify only Phase 5 files for failures introduced here.

- [ ] **Step 1: Run accounting and permission suites**

Run: `npm run test:unit -- tests/unit/domain/ledger && npm run test:integration -- tests/integration/settlements && npm run test:unit -- tests/api/settlements`

Expected: PASS; `Σ member net = 0`, recommendations are deterministic, actual transfers are separate, and all LEFT/lifecycle branches pass.

- [ ] **Step 2: Prove no editable balance or recommendation persistence exists**

Run: `rg -n "member_balances|user_balance|settlement_recommendations" src/server/db drizzle`

Expected: no matches.

- [ ] **Step 3: Prove all Settlement writes pass through server recalculation**

Run: `rg -n "calculateLedger|OVER_SETTLEMENT_CONFIRMATION_REQUIRED|confirmOverSettlement|SETTLEMENT_PAYER_MUST_BE_SELF" src/server/services/settlement-service.ts tests`

Expected: each required invariant has implementation and tests.

- [ ] **Step 4: Run repository gates**

Run: `npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build`

Expected: all commands exit 0.

- [ ] **Step 5: Commit verification fixes if needed**

```bash
git add src/domain/ledger src/features/settlements src/server/db/schema/settlements.ts src/server/repositories/ledger-repository.ts src/server/repositories/settlement-repository.ts src/server/services/ledger-service.ts src/server/services/settlement-service.ts src/server/validation/settlement.ts src/app/api/activities tests/unit/domain/ledger tests/integration/settlements tests/api/settlements drizzle/0004_settlement_facts.sql
git commit -m "chore: complete ledger and settlement verification"
```
