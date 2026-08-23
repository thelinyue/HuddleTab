# HuddleTab Phase 7 Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support reliable offline viewing and offline creation of complete Expenses through user-isolated IndexedDB snapshots, an idempotent foreground mutation queue, attachment queueing, revision convergence, and explicit recoverable sync states.

**Architecture:** IndexedDB stores cached server snapshots and pending client mutations; it is not a second ledger. The foreground React application owns synchronization on startup, `online`, and manual retry; Serwist remains limited to App Shell/static caching and controlled updates and never imports business-sync code.

**Tech Stack:** TypeScript, idb, IndexedDB, React, Vitest with fake-indexeddb, Playwright, existing Expense Domain and API.

---

## File responsibility map

```text
src/pwa/indexed-db/schema.ts                          Typed IndexedDB records and status unions
src/pwa/indexed-db/database.ts                        Versioned per-user database opener and stale-state recovery
src/pwa/indexed-db/snapshot-repository.ts             Replace/read authoritative Activity Snapshot
src/pwa/indexed-db/mutation-repository.ts             Atomic queue, state transitions and explicit discard
src/pwa/indexed-db/attachment-repository.ts           Offline blobs keyed by client_attachment_id
src/pwa/sync-queue/enqueue-expense.ts                 Shared Domain validation then atomic local enqueue
src/pwa/sync-queue/sync-coordinator.ts                Foreground sequential worker and finite retry policy
src/pwa/sync-queue/sync-triggers.tsx                  Startup/online/manual triggers bound to signed-in user
src/pwa/sync-queue/merge-feed.ts                      Snapshot + pending visual overlay; no authoritative balance mutation
src/features/expenses/components/offline-status.tsx   Pending/retry/rejected/attachment UI and recovery actions
src/features/expenses/components/quick-expense-form.tsx Online/offline submission integration
src/features/settlements/components/settlement-form.tsx Explicit offline disable; no queue path
src/pwa/service-worker/*                              App Shell only in Phase 10; must not import sync-queue
tests/unit/pwa/*.test.ts                              IDB migration, queue transitions, merge and retry behavior
tests/e2e/offline/*.spec.ts                           Refresh persistence, response loss, rejection and attachment flows
```

## Offline invariants

- Supported offline: read last Snapshot and create one complete Expense, optionally with queued attachments.
- Forbidden offline: Expense edit/delete, Settlement create/edit/delete, member/invitation/lifecycle operations.
- `clientMutationId` is generated once before local enqueue and reused for every server retry; server uniqueness remains `(created_by_user_id, client_mutation_id)`.
- Cached balances/totals are labeled “截至上次同步”; pending amounts may appear only as separate local estimates.
- Service Worker/Serwist never sends Expense or attachment requests and never opens the business queue.

### Task 1: Create a user-isolated IndexedDB schema

**Files:**
- Create: `src/pwa/indexed-db/schema.ts`
- Create: `src/pwa/indexed-db/database.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/unit/pwa/indexed-db.test.ts`

- [ ] **Step 1: Install the test-only IndexedDB implementation**

Run: `npm install --save-dev fake-indexeddb`

Expected: `package.json` and `package-lock.json` include `fake-indexeddb`; runtime `idb` already exists from Phase 0.

- [ ] **Step 2: Write the failing database test**

```ts
import "fake-indexeddb/auto";
import { afterEach, expect, test } from "vitest";
import { deleteDB } from "idb";
import { openHuddleTabDb } from "@/pwa/indexed-db/database";

afterEach(() => Promise.all([deleteDB("huddletab:u1"), deleteDB("huddletab:u2")]));

test("不同登录用户使用隔离数据库，遗留 SYNCING 恢复为 RETRYABLE", async () => {
  const first = await openHuddleTabDb("u1");
  await first.put("pending_mutations", { id:"m1", userId:"u1", activityId:"a1", kind:"CREATE_EXPENSE", payload:{}, status:"SYNCING", attemptCount:1, nextAttemptAt:0, createdAt:1, updatedAt:1 });
  first.close();
  const reopened = await openHuddleTabDb("u1");
  expect((await reopened.get("pending_mutations", "m1"))?.status).toBe("RETRYABLE");
  expect((await openHuddleTabDb("u2")).objectStoreNames.contains("pending_mutations")).toBe(true);
});
```

- [ ] **Step 3: Run the test**

Run: `npm run test:unit -- tests/unit/pwa/indexed-db.test.ts`

Expected: FAIL because `openHuddleTabDb` is missing.

- [ ] **Step 4: Implement the schema and opener**

```ts
// src/pwa/indexed-db/schema.ts
import type { DBSchema } from "idb";
export type MutationStatus = "PENDING" | "SYNCING" | "RETRYABLE" | "REJECTED" | "SYNCED";
export interface ActivitySnapshotRecord { activityId:string; userId:string; revision:string; fetchedAt:number; snapshot:ActivitySnapshotDto; }
export interface PendingExpenseMutation { id:string; userId:string; activityId:string; kind:"CREATE_EXPENSE"; payload:CreateExpenseRequest; status:MutationStatus; attemptCount:number; nextAttemptAt:number; lastError?:{ code:string; message:string }; serverExpenseId?:string; createdAt:number; updatedAt:number; }
export interface PendingAttachment { id:string; userId:string; activityId:string; mutationId:string; clientAttachmentId:string; fileName:string; mimeType:string; blob:Blob; status:MutationStatus; attemptCount:number; nextAttemptAt:number; lastError?:{ code:string; message:string }; createdAt:number; updatedAt:number; }
export interface HuddleTabDb extends DBSchema {
  activity_snapshots:{ key:string; value:ActivitySnapshotRecord };
  activity_preferences:{ key:string; value:{ key:string; userId:string; activityId:string; value:unknown } };
  pending_mutations:{ key:string; value:PendingExpenseMutation; indexes:{ "by-status-next":[MutationStatus,number]; "by-activity":string } };
  pending_attachments:{ key:string; value:PendingAttachment; indexes:{ "by-mutation":string; "by-status-next":[MutationStatus,number] } };
}
```

```ts
// src/pwa/indexed-db/database.ts
/** 数据库名包含服务器用户 ID，避免退出后另一账号看到前一账号的活动快照或待同步账单。 */
export async function openHuddleTabDb(userId: string) {
  const db = await openDB<HuddleTabDb>(`huddletab:${userId}`, 1, { upgrade(db) {
    db.createObjectStore("activity_snapshots", { keyPath:"activityId" });
    db.createObjectStore("activity_preferences", { keyPath:"key" });
    const mutations=db.createObjectStore("pending_mutations",{keyPath:"id"}); mutations.createIndex("by-status-next",["status","nextAttemptAt"]); mutations.createIndex("by-activity","activityId");
    const attachments=db.createObjectStore("pending_attachments",{keyPath:"id"}); attachments.createIndex("by-mutation","mutationId"); attachments.createIndex("by-status-next",["status","nextAttemptAt"]);
  }});
  const tx=db.transaction("pending_mutations","readwrite"); for await (const cursor of tx.store) if(cursor.value.status==="SYNCING") await cursor.update({...cursor.value,status:"RETRYABLE",updatedAt:Date.now()}); await tx.done;
  return db;
}
```

On logout or Session revocation, close current handles and delete or make unreachable the current user database before showing another account. Never key isolation by nickname or ActivityMember ID.

- [ ] **Step 5: Run and commit**

Run: `npm run test:unit -- tests/unit/pwa/indexed-db.test.ts`

Expected: PASS with isolated DB names and stale SYNCING recovery.

```bash
git add package.json package-lock.json src/pwa/indexed-db/schema.ts src/pwa/indexed-db/database.ts tests/unit/pwa/indexed-db.test.ts
git commit -m "feat: add user isolated IndexedDB"
```

### Task 2: Persist and replace authoritative Activity Snapshots

**Files:**
- Create: `src/pwa/indexed-db/snapshot-repository.ts`
- Create: `src/pwa/sync-queue/merge-feed.ts`
- Test: `tests/unit/pwa/snapshot-repository.test.ts`

- [ ] **Step 1: Write the failing convergence test**

```ts
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { SnapshotRepository } from "@/pwa/indexed-db/snapshot-repository";
import { mergeFeed } from "@/pwa/sync-queue/merge-feed";

test("新 Revision 原子替换快照，并把待同步行作为本地预估叠加", async () => {
  const repo = await SnapshotRepository.open("u1");
  await repo.replace({ activityId:"a1", revision:"5", fetchedAt:1, snapshot:fixtureSnapshot({ revision:"5", totalMinor:"1000" }) });
  await repo.replace({ activityId:"a1", revision:"7", fetchedAt:2, snapshot:fixtureSnapshot({ revision:"7", totalMinor:"2000" }) });
  const view = mergeFeed((await repo.require("a1")).snapshot, [fixturePendingExpense({ originalAmountMinor:"300" })]);
  expect(view.authoritativeTotalMinor).toBe("2000"); expect(view.localPendingEstimateMinor).toBe("300");
  expect(view.authorityLabel).toBe("截至上次同步");
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/pwa/snapshot-repository.test.ts`

Expected: FAIL because repository and merge function are missing.

- [ ] **Step 3: Implement replace and overlay behavior**

```ts
export class SnapshotRepository {
  static async open(userId:string){ return new SnapshotRepository(await openHuddleTabDb(userId)); }
  private constructor(private readonly db:IDBPDatabase<HuddleTabDb>){}
  async replace(record:ActivitySnapshotRecord){ await this.db.put("activity_snapshots",record); }
  async get(activityId:string){ return this.db.get("activity_snapshots",activityId); }
  async require(activityId:string){ const value=await this.get(activityId); if(!value) throw new Error("此活动尚未缓存，无法离线查看"); return value; }
}
```

```ts
/** Pending 行只叠加到流水和单独的本地预估，不修改服务器快照中的 Ledger、余额或总额。 */
export function mergeFeed(snapshot:ActivitySnapshotDto, pending:PendingExpenseMutation[]) {
  return { ...snapshot, feed:[...pending.map(toPendingFeedRow),...snapshot.feed], authoritativeTotalMinor:snapshot.totalMinor,
    localPendingEstimateMinor:pending.reduce((sum,x)=>sum+BigInt(x.payload.originalCurrency===snapshot.baseCurrency?x.payload.originalAmountMinor:"0"),0n).toString(), authorityLabel:"截至上次同步" as const };
}
```

Snapshot replacement is a complete record replacement, not a delta merge. Pending mutations stay in their own store and are re-overlaid after replacement.

- [ ] **Step 4: Run and commit**

Run: `npm run test:unit -- tests/unit/pwa/snapshot-repository.test.ts`

Expected: PASS; revision 7 replaces revision 5 while authoritative total remains distinct from local estimate.

```bash
git add src/pwa/indexed-db/snapshot-repository.ts src/pwa/sync-queue/merge-feed.ts tests/unit/pwa/snapshot-repository.test.ts
git commit -m "feat: cache authoritative activity snapshots"
```

### Task 3: Atomically enqueue a complete Expense and optional attachments

**Files:**
- Create: `src/pwa/indexed-db/mutation-repository.ts`
- Create: `src/pwa/indexed-db/attachment-repository.ts`
- Create: `src/pwa/sync-queue/enqueue-expense.ts`
- Test: `tests/unit/pwa/enqueue-expense.test.ts`

- [ ] **Step 1: Write the failing atomic enqueue test**

```ts
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { enqueueExpense } from "@/pwa/sync-queue/enqueue-expense";

test("一次 IndexedDB 事务保存同一 mutationId 和附件，且保留 clientMutationId", async () => {
  const result = await enqueueExpense({ userId:"u1", activity:fixtureSnapshot(), input:validExpenseInput({ clientMutationId:"01JOFFLINECREATE000000001" }), files:[new File(["receipt"],"receipt.jpg",{type:"image/jpeg"})] });
  expect(result.mutation.payload.clientMutationId).toBe("01JOFFLINECREATE000000001");
  expect(result.attachments).toHaveLength(1); expect(result.attachments[0].mutationId).toBe(result.mutation.id);
});

test("离线外币没有缓存或手工汇率时拒绝正式入队", async () => {
  await expect(enqueueExpense({ userId:"u1", activity:fixtureSnapshot(), input:validExpenseInput({ originalCurrency:"JPY", exchangeRate:"" }), files:[] }))
    .rejects.toThrow("离线外币消费需要有效缓存汇率或手工汇率");
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/pwa/enqueue-expense.test.ts`

Expected: FAIL because enqueue modules do not exist.

- [ ] **Step 3: Implement shared validation and atomic enqueue**

```ts
/** 离线创建仍必须是完整账务事实；不引入待补金额、待补成员或待补汇率草稿。 */
export async function enqueueExpense(input:EnqueueExpenseInput) {
  const request=normalizeCreateExpense(input.input);
  prepareExpense(toDomainInput(request,input.activity.baseCurrency));
  if(request.originalCurrency!==input.activity.baseCurrency && (!request.exchangeRate || !["CACHE","MANUAL"].includes(request.exchangeRateSource)))
    throw new Error("离线外币消费需要有效缓存汇率或手工汇率");
  const db=await openHuddleTabDb(input.userId); const now=Date.now(); const mutationId=crypto.randomUUID();
  const mutation:PendingExpenseMutation={id:mutationId,userId:input.userId,activityId:input.activity.activity.id,kind:"CREATE_EXPENSE",payload:request,status:"PENDING",attemptCount:0,nextAttemptAt:now,createdAt:now,updatedAt:now};
  const attachments=input.files.map((file,index)=>({id:crypto.randomUUID(),userId:input.userId,activityId:mutation.activityId,mutationId,clientAttachmentId:crypto.randomUUID(),fileName:file.name,mimeType:file.type,blob:file,status:"PENDING" as const,attemptCount:0,nextAttemptAt:now,createdAt:now,updatedAt:now}));
  const tx=db.transaction(["pending_mutations","pending_attachments"],"readwrite"); await tx.objectStore("pending_mutations").add(mutation); for(const row of attachments) await tx.objectStore("pending_attachments").add(row); await tx.done;
  return { mutation, attachments };
}
```

The quick form creates `clientMutationId` before calling this function and never replaces it during retries or page refresh. Limit attachment count to three and retain original blobs only in the user-isolated database.

- [ ] **Step 4: Run and commit**

Run: `npm run test:unit -- tests/unit/pwa/enqueue-expense.test.ts`

Expected: PASS for valid complete Expense, atomic attachment queue, and offline FX rejection.

```bash
git add src/pwa/indexed-db/mutation-repository.ts src/pwa/indexed-db/attachment-repository.ts src/pwa/sync-queue/enqueue-expense.ts tests/unit/pwa/enqueue-expense.test.ts
git commit -m "feat: enqueue offline expenses atomically"
```

### Task 4: Implement the foreground sync coordinator and finite retry policy

**Files:**
- Create: `src/pwa/sync-queue/sync-coordinator.ts`
- Create: `src/pwa/sync-queue/sync-triggers.tsx`
- Test: `tests/unit/pwa/sync-coordinator.test.ts`

- [ ] **Step 1: Write failing retry classification tests**

```ts
import { expect, test, vi } from "vitest";
import { SyncCoordinator } from "@/pwa/sync-queue/sync-coordinator";

test("网络与 5xx 有限退避，403/409/422 进入 REJECTED", async () => {
  const queue=fixtureQueue(); const api=vi.fn().mockRejectedValueOnce({ kind:"network" }).mockRejectedValueOnce({ status:422, code:"ACTIVITY_ENDED", message:"活动已结束，无法同步这笔消费" });
  const sync=new SyncCoordinator(queue,fixtureAttachments(),fixtureSnapshots(),api,()=>0);
  await sync.runOnce(); expect(queue.current.status).toBe("RETRYABLE"); expect(queue.current.nextAttemptAt).toBe(1000);
  await sync.runOnce(); expect(queue.current.status).toBe("REJECTED"); expect(queue.current.lastError?.message).toBe("活动已结束，无法同步这笔消费");
});

test("同一协调器不并发处理队列", async () => {
  const gate=deferred(); const api=vi.fn().mockReturnValue(gate.promise); const sync=fixtureCoordinator(api);
  const first=sync.run(); const second=sync.run(); expect(api).toHaveBeenCalledTimes(1); gate.resolve(fixtureCreated()); await Promise.all([first,second]);
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test:unit -- tests/unit/pwa/sync-coordinator.test.ts`

Expected: FAIL because `SyncCoordinator` is missing.

- [ ] **Step 3: Implement sequential foreground synchronization**

```ts
const RETRY_MS=[1000,5000,15000,60000,300000] as const;
/**
 * 业务同步只由前台应用驱动。单实例串行处理，避免同一 mutation 同时上传；
 * PENDING/RETRYABLE 可重试，权限、生命周期和业务拒绝保留输入并停止自动重试。
 */
export class SyncCoordinator {
  private running:Promise<void>|null=null;
  run(){ if(this.running) return this.running; this.running=this.drain().finally(()=>{this.running=null;}); return this.running; }
  private async drain(){ for(let item=await this.queue.nextReady();item;item=await this.queue.nextReady()) await this.syncOne(item); }
  private async syncOne(item:PendingExpenseMutation){
    await this.queue.markSyncing(item.id);
    try { const created=await this.api.createExpense(item.activityId,item.payload); await this.queue.markSynced(item.id,created.expense.id); await this.attachments.syncFor(item.id,created.expense.id); await this.snapshots.refresh(item.activityId); }
    catch(error){ const failure=classifySyncError(error); if(failure.retryable && item.attemptCount<RETRY_MS.length) await this.queue.markRetryable(item.id,Date.now()+RETRY_MS[item.attemptCount],failure); else await this.queue.markRejected(item.id,{code:failure.code,message:failure.message||"同步失败，请检查后重试"}); }
  }
}
```

`SyncTriggers` calls `coordinator.run()` after signed-in app mount, on browser `online`, and from a visible manual retry button. It removes listeners on unmount. Do not use Background Sync, WebSocket, or Service Worker messaging for business synchronization.

- [ ] **Step 4: Run and commit**

Run: `npm run test:unit -- tests/unit/pwa/sync-coordinator.test.ts`

Expected: PASS; retries are bounded, rejections preserve Chinese reasons, and one worker runs at a time.

```bash
git add src/pwa/sync-queue/sync-coordinator.ts src/pwa/sync-queue/sync-triggers.tsx tests/unit/pwa/sync-coordinator.test.ts
git commit -m "feat: sync offline queue in foreground"
```

### Task 5: Make Expense and attachment retries independently idempotent

**Files:**
- Modify: `src/pwa/sync-queue/sync-coordinator.ts`
- Modify: `src/pwa/indexed-db/attachment-repository.ts`
- Test: `tests/unit/pwa/idempotent-sync.test.ts`
- Test: `tests/integration/expenses/offline-idempotency.test.ts`

- [ ] **Step 1: Write the failing response-loss test**

```ts
import { expect, test } from "vitest";
import { offlineHarness } from "./support/offline-harness";

test("服务器已提交但响应丢失，重试仍只有一笔 Expense 和一次副作用", async () => {
  const h=await offlineHarness(); const mutation=await h.enqueue({ clientMutationId:"01JRESPONSELOST000000001" });
  await h.serverCreateThenDropResponse(mutation); await h.coordinator.run();
  expect(await h.server.countExpenses()).toBe(1); expect(await h.server.countAudit("EXPENSE_CREATED")).toBe(1); expect(await h.server.revision()).toBe(1n);
  expect((await h.queue.get(mutation.id))?.status).toBe("SYNCED");
});

test("账单成功而附件失败只重试附件", async () => {
  const h=await offlineHarness(); const mutation=await h.enqueueWithAttachment(); await h.failNextAttachmentUpload();
  await h.coordinator.run(); await h.coordinator.run();
  expect(await h.server.countExpenses()).toBe(1); expect(await h.server.countAttachments()).toBe(1);
});
```

- [ ] **Step 2: Run both tests**

Run: `npm run test:unit -- tests/unit/pwa/idempotent-sync.test.ts && npm run test:integration -- tests/integration/expenses/offline-idempotency.test.ts`

Expected: FAIL until replay and attachment state are separated.

- [ ] **Step 3: Implement replay-safe transitions**

When Phase 4 API returns `200 { idempotentReplay:true, expense }`, mark the mutation SYNCED with the existing server ID and continue attachments. Upload each attachment with `clientAttachmentId`; Phase 8 endpoint must enforce `(expense_id, client_attachment_id)` uniqueness and return the existing metadata on replay. Do not reset Expense to PENDING when only an attachment fails.

```ts
if (created.expense.id) {
  await this.queue.markSynced(item.id, created.expense.id);
  const attachmentResult=await this.attachments.syncFor(item.id,created.expense.id);
  if(attachmentResult.pendingCount>0) await this.queue.setInfo(item.id,{code:"ATTACHMENTS_PENDING",message:"账单已同步，附件待同步"});
}
```

- [ ] **Step 4: Run and commit**

Run: `npm run test:unit -- tests/unit/pwa/idempotent-sync.test.ts && npm run test:integration -- tests/integration/expenses/offline-idempotency.test.ts`

Expected: PASS with exactly one Expense, Payment/Share set, Audit, Revision increment and attachment.

```bash
git add src/pwa/sync-queue/sync-coordinator.ts src/pwa/indexed-db/attachment-repository.ts tests/unit/pwa/idempotent-sync.test.ts tests/integration/expenses/offline-idempotency.test.ts
git commit -m "feat: make offline sync idempotent"
```

### Task 6: Integrate offline states into the core UI and block unsupported operations

**Files:**
- Create: `src/features/expenses/components/offline-status.tsx`
- Modify: `src/features/expenses/components/quick-expense-form.tsx`
- Modify: `src/features/expenses/components/expense-detail.tsx`
- Modify: `src/features/settlements/components/settlement-form.tsx`
- Modify: `src/features/members/components/member-list.tsx`
- Test: `tests/unit/ui/offline-boundaries.test.tsx`

- [ ] **Step 1: Write failing UI boundary tests**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ExpenseDetail } from "@/features/expenses/components/expense-detail";
import { SettlementForm } from "@/features/settlements/components/settlement-form";

test("离线时只允许新增 Expense，不出现编辑删除或 Settlement 队列入口", () => {
  render(<><ExpenseDetail expense={fixtureExpense()} online={false}/><SettlementForm data={fixtureSettlementForm()} online={false}/></>);
  expect(screen.queryByRole("button", { name:"编辑消费" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name:"删除消费" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name:"确认已支付" })).toBeDisabled();
  expect(screen.getByText("结算必须联网后记录" )).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/ui/offline-boundaries.test.tsx`

Expected: FAIL because online state is not integrated.

- [ ] **Step 3: Implement explicit recoverable states**

`QuickExpenseForm` calls the server when online and `enqueueExpense` when offline/network submission fails before a confirmed response. A queued success closes the overlay and announces `已保存到本机，联网后自动同步`. Feed rows show PENDING “待同步”, RETRYABLE “同步失败，可重试”, REJECTED server Chinese reason plus “检查账单” and “丢弃本地记录”, and SYNCED-with-attachment-pending “账单已同步，附件待同步”. Explicit discard deletes only local pending mutation/attachments after confirmation; it never calls server DELETE.

```tsx
<Button disabled={!online} aria-describedby={!online?"settlement-offline-help":undefined}>确认已支付</Button>
{!online&&<p id="settlement-offline-help" className="text-sm text-[var(--warning)]"><WifiOff aria-hidden="true"/>结算必须联网后记录</p>}
```

Expense update/delete, Settlement, member, invitation and lifecycle buttons are disabled or hidden offline with visible reasons. Do not create generic mutation kinds for them.

- [ ] **Step 4: Run and commit**

Run: `npm run test:unit -- tests/unit/ui/offline-boundaries.test.tsx`

Expected: PASS; only create Expense has an offline persistence path.

```bash
git add src/features/expenses/components src/features/settlements/components/settlement-form.tsx src/features/members/components/member-list.tsx tests/unit/ui/offline-boundaries.test.tsx
git commit -m "feat: show explicit offline boundaries"
```

### Task 7: Refresh Snapshot by Activity Revision and handle state races

**Files:**
- Modify: `src/pwa/sync-queue/sync-coordinator.ts`
- Create: `src/pwa/sync-queue/refresh-snapshot.ts`
- Test: `tests/unit/pwa/revision-convergence.test.ts`

- [ ] **Step 1: Write the failing revision/race test**

```ts
import { expect, test } from "vitest";
import { refreshSnapshotIfChanged } from "@/pwa/sync-queue/refresh-snapshot";

test("Revision 不同则全量替换，相同则不拉取", async () => {
  const api=fixtureSnapshotApi({ revision:"9" }); const repo=fixtureSnapshotRepo({ revision:"8" });
  await refreshSnapshotIfChanged("a1",api,repo); expect(api.fetchSnapshot).toHaveBeenCalledOnce(); expect(repo.current.revision).toBe("9");
  await refreshSnapshotIfChanged("a1",api,repo); expect(api.fetchSnapshot).toHaveBeenCalledOnce();
});

test("离线时 ACTIVE、同步时 ENDED 的消费保留为 REJECTED", async () => {
  const h=fixtureCoordinatorRejecting({ status:409, code:"ACTIVITY_ENDED", message:"活动已经结束，这笔离线消费未同步" });
  await h.run(); expect(h.queue.current.status).toBe("REJECTED"); expect(h.queue.current.payload.title).toBe("晚餐");
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/pwa/revision-convergence.test.ts`

Expected: FAIL because refresh helper is missing.

- [ ] **Step 3: Implement full-snapshot convergence**

```ts
/** Revision 只决定是否重拉；V1 不实现 Delta Sync。 */
export async function refreshSnapshotIfChanged(activityId:string, api:SnapshotApi, repo:SnapshotRepository) {
  const local=await repo.get(activityId); const head=await api.getRevision(activityId);
  if(local?.revision===head.revision) return local;
  const snapshot=await api.fetchSnapshot(activityId); await repo.replace({activityId,userId:snapshot.userId,revision:snapshot.revision,fetchedAt:Date.now(),snapshot}); return snapshot;
}
```

After each Expense/attachment synchronization, fetch or compare server Revision and replace the full snapshot, then overlay remaining pending rows. Permissions or activity/member status rejection is final until user explicitly edits by creating a new online request or discards the local record; do not mutate payload to bypass the server.

- [ ] **Step 4: Run and commit**

Run: `npm run test:unit -- tests/unit/pwa/revision-convergence.test.ts`

Expected: PASS for full replacement and preserved rejected input.

```bash
git add src/pwa/sync-queue/refresh-snapshot.ts src/pwa/sync-queue/sync-coordinator.ts tests/unit/pwa/revision-convergence.test.ts
git commit -m "feat: converge offline data by activity revision"
```

### Task 8: Freeze the Serwist boundary and protect pending data during updates

**Files:**
- Create: `src/pwa/service-worker/business-sync-boundary.ts`
- Create: `src/pwa/service-worker/update-policy.ts`
- Test: `tests/unit/pwa/service-worker-boundary.test.ts`

- [ ] **Step 1: Write the failing boundary/update test**

```ts
import { expect, test } from "vitest";
import { mayActivateUpdate } from "@/pwa/service-worker/update-policy";

test("存在待同步账单或附件时不允许触发重载更新", () => {
  expect(mayActivateUpdate({ pendingMutations:1, pendingAttachments:0 })).toEqual({ allowed:false, message:"有新版本可用，完成同步后更新" });
  expect(mayActivateUpdate({ pendingMutations:0, pendingAttachments:0 }).allowed).toBe(true);
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/pwa/service-worker-boundary.test.ts`

Expected: FAIL because update policy is missing.

- [ ] **Step 3: Implement the explicit boundary**

```ts
/** Serwist 只负责 App Shell 与静态资源；业务队列由前台 SyncCoordinator 独占。 */
export const BUSINESS_SYNC_OWNER = "FOREGROUND_APP" as const;
export function mayActivateUpdate(input:{pendingMutations:number;pendingAttachments:number}) {
  return input.pendingMutations+input.pendingAttachments>0
    ? {allowed:false as const,message:"有新版本可用，完成同步后更新"}
    : {allowed:true as const,message:"可以更新"};
}
```

Phase 10 Serwist worker may import `BUSINESS_SYNC_OWNER` only as a build-time assertion, but must not import `sync-coordinator`, IndexedDB repositories, Expense API clients, or register Background Sync. The update prompt must not call `skipWaiting`/reload while pending counts are nonzero.

- [ ] **Step 4: Add a source-boundary assertion**

```ts
import { readFileSync } from "node:fs";
test("Service Worker 不拥有业务同步", () => {
  const source=["business-sync-boundary.ts","update-policy.ts"].map((name)=>readFileSync(`src/pwa/service-worker/${name}`,"utf8")).join("\n");
  expect(source).not.toMatch(/sync-coordinator|pending_mutations|createExpense|BackgroundSync/);
});
```

Run: `npm run test:unit -- tests/unit/pwa/service-worker-boundary.test.ts`

Expected: PASS; pending data blocks reload and source has no business-sync dependency.

- [ ] **Step 5: Commit**

```bash
git add src/pwa/service-worker/business-sync-boundary.ts src/pwa/service-worker/update-policy.ts tests/unit/pwa/service-worker-boundary.test.ts
git commit -m "feat: keep business sync out of service worker"
```

### Task 9: Prove the offline flow end to end

**Files:**
- Create: `tests/e2e/offline/create-expense.spec.ts`
- Create: `tests/e2e/offline/response-loss.spec.ts`
- Create: `tests/e2e/offline/state-race.spec.ts`

- [ ] **Step 1: Write the refresh-persistence flow**

```ts
import { expect, test } from "@playwright/test";

test("断网新增、刷新保留、联网后服务器仅一笔", async ({ page, context }) => {
  await signInAndOpenActivity(page); await context.setOffline(true);
  await page.getByRole("button",{name:"记一笔"}).click(); await page.getByLabel("金额").fill("88"); await page.getByLabel("用途").fill("离线午餐"); await page.getByRole("button",{name:"保存消费"}).click();
  await expect(page.getByText("待同步")).toBeVisible(); await page.reload(); await expect(page.getByText("离线午餐")).toBeVisible();
  await context.setOffline(false); await page.evaluate(()=>window.dispatchEvent(new Event("online")));
  await expect(page.getByText("待同步")).toBeHidden(); expect(await countServerExpenses(page,"离线午餐")).toBe(1);
});
```

- [ ] **Step 2: Add response-loss and attachment-independent flows**

Intercept the first create response after the server commits and abort it; verify retry returns the existing Expense. Intercept the first attachment upload only; verify the UI says `账单已同步，附件待同步`, the Expense count remains one, and manual retry uploads one attachment.

- [ ] **Step 3: Add lifecycle race and forbidden-operation flows**

Cache an ACTIVE activity, go offline, enqueue Expense, change server state to ENDED, restore network, and assert REJECTED keeps title/amount plus Chinese reason. While offline, assert Expense edit/delete, Settlement, member management and lifecycle actions have no enabled submit path.

- [ ] **Step 4: Run the offline suite**

Run: `npm run test:e2e -- tests/e2e/offline`

Expected: PASS for refresh persistence, response loss, attachment retry, lifecycle rejection, user isolation and unsupported-operation boundaries.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/offline
git commit -m "test: verify offline expense synchronization"
```

## Phase 7 verification gate

**Files:**
- Verify only; modify only Phase 7 files for failures introduced here.

- [ ] **Step 1: Run focused offline tests**

Run: `npm run test:unit -- tests/unit/pwa tests/unit/ui/offline-boundaries.test.ts && npm run test:integration -- tests/integration/expenses/offline-idempotency.test.ts && npm run test:e2e -- tests/e2e/offline`

Expected: all commands exit 0.

- [ ] **Step 2: Scan for forbidden queue kinds and background sync**

Run: `rg -n "UPDATE_EXPENSE|DELETE_EXPENSE|SETTLEMENT|MEMBER_MANAGEMENT|BackgroundSync|periodicSync" src/pwa`

Expected: no matches except explanatory test descriptions that assert absence.

- [ ] **Step 3: Scan for the required idempotency identity**

Run: `rg -n "clientMutationId|createdByUserId|expenses_creator_mutation_uq|idempotentReplay" src/pwa src/server tests`

Expected: the client preserves `clientMutationId`, and Phase 4 server uniqueness/replay tests remain present.

- [ ] **Step 4: Run repository gates**

Run: `npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e && npm run build`

Expected: all commands exit 0.

- [ ] **Step 5: Commit verification fixes if needed**

```bash
git add package.json package-lock.json src/pwa src/features/expenses/components src/features/settlements/components/settlement-form.tsx src/features/members/components/member-list.tsx tests/unit/pwa tests/unit/ui/offline-boundaries.test.tsx tests/integration/expenses/offline-idempotency.test.ts tests/e2e/offline
git commit -m "chore: complete offline phase verification"
```
