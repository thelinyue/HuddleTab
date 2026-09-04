# HuddleTab Task 25 IndexedDB Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-isolated IndexedDB persistence for authoritative Activity Snapshots and future Expense Create mutations without implementing offline synchronization.

**Architecture:** Each server user owns one `huddletab:<user_id>` IndexedDB database at schema version 1. Repositories open and close the database for each operation, inject their own `userId`, atomically replace whole Snapshot records, and persist complete queue records without interpreting sync state.

**Tech Stack:** TypeScript 5.9, React 19, Vite 8, `idb`, Vitest 4, `fake-indexeddb`, existing Task 24 Snapshot adapter.

**Spec:** `docs/superpowers/specs/2026-09-01-huddletab-task25-indexeddb-design.md`

## Global Constraints

- Only `activity_snapshots` and `pending_mutations` are created at schema version 1.
- Do not migrate or support unpublished Next.js IndexedDB data.
- Do not persist TanStack Query cache.
- Logout and global 401 must preserve IndexedDB; only `clearLocalData(userId)` may delete it.
- Do not implement foreground sync, retries, pending feed overlays, attachments, offline UI, or Service Worker business writes.
- Do not modify Rust, PostgreSQL, OpenAPI, product routes, or release artifacts.
- Task 25 completion means only “IndexedDB isolation and local storage boundaries are complete; Task 26 may begin.”

## File Responsibility Map

```text
frontend/src/pwa/indexed-db/schema.ts                 Typed Snapshot and Expense queue records
frontend/src/pwa/indexed-db/database.ts               Version 1 opener, short-lived handle helper, explicit deletion
frontend/src/pwa/indexed-db/snapshot-repository.ts    Atomic Snapshot read/replace/refresh
frontend/src/pwa/indexed-db/mutation-repository.ts    Complete queue record storage and activity listing
frontend/src/pwa/indexed-db/test-fixtures.ts           Complete generated-contract fixtures shared by tests
frontend/src/pwa/indexed-db/*.test.ts                 fake-indexeddb contract tests
frontend/src/features/auth/api.test.tsx               Logout retention regression
frontend/src/app/providers.test.tsx                   Global 401 retention regression
docs/handovers/...                                    Task 25 commands, results, and remaining work
```

---

### Task 1: Create the user-isolated schema and explicit cleanup

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/pwa/indexed-db/schema.ts`
- Create: `frontend/src/pwa/indexed-db/database.ts`
- Create: `frontend/src/pwa/indexed-db/database.test.ts`

**Interfaces:**
- Consumes: generated `components["schemas"]["ActivitySnapshotData"]` and `components["schemas"]["ExpenseDraftRequest"]`.
- Produces: `HuddleTabDb`, `ActivitySnapshotRecord`, `PendingExpenseMutation`, `databaseName(userId)`, `withUserDatabase(userId, operation)`, and `clearLocalData(userId)`.

- [ ] **Step 1: Install direct runtime and test dependencies**

Run:

```powershell
npm --prefix frontend install idb@8.0.3
npm --prefix frontend install --save-dev fake-indexeddb@6.2.5
```

Expected: `frontend/package.json` contains runtime `idb` and dev-only `fake-indexeddb`; the lockfile records both as direct dependencies.

- [ ] **Step 2: Write the failing schema and isolation tests**

Create `frontend/src/pwa/indexed-db/database.test.ts`:

```ts
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteDB } from "idb";
import {
  clearLocalData,
  databaseName,
  withUserDatabase,
} from "./database";

const users = ["user-1", "user-2"];

afterEach(() => Promise.all(users.map((userId) => deleteDB(databaseName(userId)))));

describe("HuddleTab IndexedDB", () => {
  it("fresh database 只创建 Task 25 的两个 store 和活动索引", async () => {
    await withUserDatabase("user-1", async (database) => {
      expect(database.version).toBe(1);
      expect([...database.objectStoreNames]).toEqual([
        "activity_snapshots",
        "pending_mutations",
      ]);
      const transaction = database.transaction("pending_mutations", "readonly");
      expect([...transaction.store.indexNames]).toEqual(["by-activity"]);
      await transaction.done;
    });
  });

  it("不同 user_id 使用不同数据库且显式清理不影响另一用户", async () => {
    await withUserDatabase("user-1", (database) =>
      database.put("activity_snapshots", {
        userId: "user-1",
        activityId: "activity-1",
        etag: 'W/"1"',
        snapshot: { revision: "1" } as never,
        fetchedAt: 1,
      }),
    );
    await withUserDatabase("user-2", (database) =>
      database.put("activity_snapshots", {
        userId: "user-2",
        activityId: "activity-1",
        etag: 'W/"2"',
        snapshot: { revision: "2" } as never,
        fetchedAt: 2,
      }),
    );

    await clearLocalData("user-1");

    await withUserDatabase("user-1", async (database) => {
      expect(await database.get("activity_snapshots", "activity-1")).toBeUndefined();
    });
    await withUserDatabase("user-2", async (database) => {
      expect(await database.get("activity_snapshots", "activity-1")).toMatchObject({
        userId: "user-2",
        etag: 'W/"2"',
      });
    });
  });

  it("IndexedDB 不可用时返回中文错误并保留 cause", async () => {
    const unavailable = new Error("indexeddb unavailable");
    vi.spyOn(indexedDB, "open").mockImplementation(() => { throw unavailable; });
    await expect(withUserDatabase("user-1", async () => undefined))
      .rejects.toMatchObject({
        message: "无法访问此设备上的伙记本地数据。",
        cause: unavailable,
      });
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```powershell
npm --prefix frontend run test:unit -- src/pwa/indexed-db/database.test.ts
```

Expected: FAIL because `./database` does not exist.

- [ ] **Step 4: Implement the typed schema**

Create `frontend/src/pwa/indexed-db/schema.ts`:

```ts
import type { DBSchema } from "idb";
import type { components } from "../../api/generated/openapi";

export type ActivitySnapshotData = components["schemas"]["ActivitySnapshotData"];
export type ExpenseCreateInput = components["schemas"]["ExpenseDraftRequest"];
export type MutationStatus =
  | "PENDING"
  | "SYNCING"
  | "RETRYABLE"
  | "REJECTED"
  | "SYNCED";

export type ActivitySnapshotRecord = {
  userId: string;
  activityId: string;
  etag: string;
  snapshot: ActivitySnapshotData;
  fetchedAt: number;
};

export type PendingExpenseMutation = {
  id: string;
  userId: string;
  activityId: string;
  kind: "CREATE_EXPENSE";
  payload: ExpenseCreateInput;
  status: MutationStatus;
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: { code: string; message: string };
  serverExpenseId?: string;
  createdAt: number;
  updatedAt: number;
};

export interface HuddleTabDb extends DBSchema {
  activity_snapshots: {
    key: string;
    value: ActivitySnapshotRecord;
  };
  pending_mutations: {
    key: string;
    value: PendingExpenseMutation;
    indexes: { "by-activity": string };
  };
}
```

- [ ] **Step 5: Implement short-lived database access and explicit deletion**

Create `frontend/src/pwa/indexed-db/database.ts`:

```ts
import { deleteDB, openDB, type IDBPDatabase } from "idb";
import type { HuddleTabDb } from "./schema";

const databaseVersion = 1;

export function databaseName(userId: string) {
  return `huddletab:${userId}`;
}

/** 每次操作关闭连接，确保用户显式清理本地数据时不会被本标签页阻塞。 */
export async function withUserDatabase<T>(
  userId: string,
  operation: (database: IDBPDatabase<HuddleTabDb>) => Promise<T>,
): Promise<T> {
  try {
    const database = await openDB<HuddleTabDb>(databaseName(userId), databaseVersion, {
      upgrade(upgradeDatabase) {
        upgradeDatabase.createObjectStore("activity_snapshots", {
          keyPath: "activityId",
        });
        const mutations = upgradeDatabase.createObjectStore("pending_mutations", {
          keyPath: "id",
        });
        mutations.createIndex("by-activity", "activityId");
      },
    });
    try {
      return await operation(database);
    } finally {
      database.close();
    }
  } catch (cause) {
    throw new Error("无法访问此设备上的伙记本地数据。", { cause });
  }
}

export async function clearLocalData(userId: string): Promise<void> {
  try {
    await deleteDB(databaseName(userId));
  } catch (cause) {
    throw new Error("无法清除此设备上的伙记本地数据。", { cause });
  }
}
```

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```powershell
npm --prefix frontend run test:unit -- src/pwa/indexed-db/database.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 7: Commit the schema boundary**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/src/pwa/indexed-db/schema.ts frontend/src/pwa/indexed-db/database.ts frontend/src/pwa/indexed-db/database.test.ts
git commit -m "feat: add user isolated indexeddb schema"
```

---

### Task 2: Persist and refresh authoritative Activity Snapshots

**Files:**
- Create: `frontend/src/pwa/indexed-db/snapshot-repository.ts`
- Create: `frontend/src/pwa/indexed-db/snapshot-repository.test.ts`

**Interfaces:**
- Consumes: `withUserDatabase`, `ActivitySnapshotRecord`, and Task 24 `fetchActivitySnapshot(activityId, current?)`.
- Produces: `SnapshotRepository.get(activityId)`, `require(activityId)`, `replace(activityId, value)`, and `refresh(activityId)`.

- [ ] **Step 1: Write failing atomic replacement and conditional refresh tests**

Create `frontend/src/pwa/indexed-db/snapshot-repository.test.ts` with this mock and fixture before the test cases:

```ts
import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { deleteDB } from "idb";
import type { ActivitySnapshotData } from "./schema";

const snapshotApi = vi.hoisted(() => ({ fetchActivitySnapshot: vi.fn() }));
vi.mock("../../features/activities/snapshot-api", () => snapshotApi);

import { databaseName } from "./database";
import { SnapshotRepository } from "./snapshot-repository";

const fetchActivitySnapshotMock = snapshotApi.fetchActivitySnapshot;
const snapshot = {
  activity: { activityId: "activity-1" },
  expenses: [],
  ledger: { balances: [], baseCurrency: "CNY", revision: "2" },
  members: [],
  recommendations: {
    baseCurrency: "CNY",
    recommendations: [],
    revision: "2",
  },
  revision: "2",
  settlements: [],
} as ActivitySnapshotData;

afterEach(async () => {
  vi.clearAllMocks();
  await deleteDB(databaseName("user-1"));
});
```

Then assert these exact cases:

```ts
it("用新 ETag 和完整 Snapshot 原子替换同一活动旧记录", async () => {
  const repository = new SnapshotRepository("user-1", () => 200);
  await repository.replace("activity-1", {
    etag: 'W/"1"',
    snapshot: { ...snapshot, revision: "1", expenses: [{ expenseId: "old" }] },
  } as never);
  await repository.replace("activity-1", {
    etag: 'W/"2"',
    snapshot: { ...snapshot, revision: "2", expenses: [] },
  } as never);

  expect(await repository.get("activity-1")).toEqual({
    userId: "user-1",
    activityId: "activity-1",
    etag: 'W/"2"',
    snapshot: { ...snapshot, revision: "2", expenses: [] },
    fetchedAt: 200,
  });
});

it("304 复用已有记录且不重写 fetchedAt", async () => {
  const repository = new SnapshotRepository("user-1", () => 300);
  const current = await repository.replace("activity-1", {
    etag: 'W/"2"',
    snapshot,
  });
  fetchActivitySnapshotMock.mockResolvedValue({
    status: "not-modified",
    value: { etag: current.etag, snapshot: current.snapshot },
  });

  await expect(repository.refresh("activity-1")).resolves.toEqual(current);
  expect(fetchActivitySnapshotMock).toHaveBeenCalledWith("activity-1", {
    etag: current.etag,
    snapshot: current.snapshot,
  });
});

it("没有缓存时 require 返回明确中文错误", async () => {
  await expect(new SnapshotRepository("user-1").require("missing"))
    .rejects.toThrow("此活动尚未缓存，无法离线查看。");
});
```

Use `afterEach` to delete `databaseName("user-1")` and reset mocks.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix frontend run test:unit -- src/pwa/indexed-db/snapshot-repository.test.ts
```

Expected: FAIL because `SnapshotRepository` is missing.

- [ ] **Step 3: Implement the Snapshot repository**

Create `frontend/src/pwa/indexed-db/snapshot-repository.ts`:

```ts
import {
  fetchActivitySnapshot,
  type CachedActivitySnapshot,
} from "../../features/activities/snapshot-api";
import { withUserDatabase } from "./database";
import type { ActivitySnapshotRecord } from "./schema";

/** Snapshot 只做完整替换；本地层不解释或增量修改不同 revision 的账务事实。 */
export class SnapshotRepository {
  constructor(
    private readonly userId: string,
    private readonly now: () => number = Date.now,
  ) {}

  get(activityId: string) {
    return withUserDatabase(this.userId, (database) =>
      database.get("activity_snapshots", activityId),
    );
  }

  async require(activityId: string) {
    const record = await this.get(activityId);
    if (!record) throw new Error("此活动尚未缓存，无法离线查看。");
    return record;
  }

  async replace(activityId: string, value: CachedActivitySnapshot) {
    const record: ActivitySnapshotRecord = {
      userId: this.userId,
      activityId,
      etag: value.etag,
      snapshot: value.snapshot,
      fetchedAt: this.now(),
    };
    await withUserDatabase(this.userId, (database) =>
      database.put("activity_snapshots", record),
    );
    return record;
  }

  async refresh(activityId: string) {
    const current = await this.get(activityId);
    const result = await fetchActivitySnapshot(
      activityId,
      current ? { etag: current.etag, snapshot: current.snapshot } : undefined,
    );
    return result.status === "not-modified" && current
      ? current
      : this.replace(activityId, result.value);
  }
}
```

- [ ] **Step 4: Run Task 24 adapter and Snapshot repository tests**

Run:

```powershell
npm --prefix frontend run test:unit -- src/features/activities/snapshot-api.test.ts src/pwa/indexed-db/snapshot-repository.test.ts
```

Expected: Task 24 adapter tests remain green and all repository tests pass.

- [ ] **Step 5: Commit Snapshot persistence**

```powershell
git add frontend/src/pwa/indexed-db/snapshot-repository.ts frontend/src/pwa/indexed-db/snapshot-repository.test.ts
git commit -m "feat: persist activity snapshots locally"
```

---

### Task 3: Persist complete Expense Create queue records

**Files:**
- Create: `frontend/src/pwa/indexed-db/mutation-repository.ts`
- Create: `frontend/src/pwa/indexed-db/test-fixtures.ts`
- Create: `frontend/src/pwa/indexed-db/mutation-repository.test.ts`

**Interfaces:**
- Consumes: `PendingExpenseMutation` and `withUserDatabase`.
- Produces: `MutationRepository.put(input)`, `get(id)`, and `listByActivity(activityId)`.

- [ ] **Step 1: Write failing queue isolation and ordering tests**

Create `frontend/src/pwa/indexed-db/test-fixtures.ts`:

```ts
import type { PendingExpenseMutation } from "./schema";

export const expensePayload: PendingExpenseMutation["payload"] = {
  category: "FOOD",
  clientMutationId: "mutation-client-1",
  exchangeRate: "1",
  exchangeRateKind: "IDENTITY",
  occurredAt: "2026-09-01T08:00:00Z",
  originalAmountMinor: "100",
  originalCurrency: "CNY",
  payments: [{ memberId: "member-1", amountMinor: "100" }],
  split: { mode: "EQUAL", members: ["member-1"] },
  title: "早餐",
};

export function pendingMutationFixture(
  id: string,
  overrides: Partial<Omit<PendingExpenseMutation, "id" | "userId">> = {},
): Omit<PendingExpenseMutation, "userId"> {
  return {
    id,
    activityId: "activity-1",
    kind: "CREATE_EXPENSE",
    payload: expensePayload,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: 10,
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}
```

Create `frontend/src/pwa/indexed-db/mutation-repository.test.ts` and test:

```ts
it("repository 注入当前 userId 并完整保存 Expense Create 输入", async () => {
  const repository = new MutationRepository("user-1");
  const input = pendingMutationFixture("mutation-1");
  const saved = await repository.put(input);
  expect(saved).toEqual({ ...input, userId: "user-1" });
  expect(await repository.get("mutation-1")).toEqual(saved);
});

it("按 activityId 隔离并使用 createdAt、id 提供确定顺序", async () => {
  const repository = new MutationRepository("user-1");
  await repository.put(pendingMutationFixture("b", { createdAt: 20 }));
  await repository.put(pendingMutationFixture("c", { activityId: "activity-2", createdAt: 1 }));
  await repository.put(pendingMutationFixture("a", { createdAt: 20 }));
  expect((await repository.listByActivity("activity-1")).map(({ id }) => id))
    .toEqual(["a", "b"]);
});
```

Import `pendingMutationFixture`, use `fake-indexeddb/auto`, and delete both test-user databases in `afterEach`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix frontend run test:unit -- src/pwa/indexed-db/mutation-repository.test.ts
```

Expected: FAIL because `MutationRepository` is missing.

- [ ] **Step 3: Implement storage-only queue operations**

Create `frontend/src/pwa/indexed-db/mutation-repository.ts`:

```ts
import { withUserDatabase } from "./database";
import type { PendingExpenseMutation } from "./schema";

type MutationInput = Omit<PendingExpenseMutation, "userId">;

/** Task 25 只持久化完整记录；状态转换、退避和同步顺序由 Task 26 负责。 */
export class MutationRepository {
  constructor(private readonly userId: string) {}

  async put(input: MutationInput) {
    const record: PendingExpenseMutation = { ...input, userId: this.userId };
    await withUserDatabase(this.userId, (database) =>
      database.put("pending_mutations", record),
    );
    return record;
  }

  get(id: string) {
    return withUserDatabase(this.userId, (database) =>
      database.get("pending_mutations", id),
    );
  }

  async listByActivity(activityId: string) {
    const records = await withUserDatabase(this.userId, (database) =>
      database.getAllFromIndex("pending_mutations", "by-activity", activityId),
    );
    return records.sort(
      (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
  }
}
```

- [ ] **Step 4: Run all IndexedDB focused tests**

Run:

```powershell
npm --prefix frontend run test:unit -- src/pwa/indexed-db
```

Expected: database, Snapshot, and mutation repository suites all pass.

- [ ] **Step 5: Commit Queue persistence**

```powershell
git add frontend/src/pwa/indexed-db/mutation-repository.ts frontend/src/pwa/indexed-db/test-fixtures.ts frontend/src/pwa/indexed-db/mutation-repository.test.ts
git commit -m "feat: persist expense create queue records"
```

---

### Task 4: Lock authentication retention boundaries and close Task 25

**Files:**
- Modify: `frontend/src/features/auth/api.test.tsx`
- Modify: `frontend/src/app/providers.test.tsx`
- Modify: `docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md`

**Interfaces:**
- Consumes: `MutationRepository`, current `useLogoutMutation`, and `AUTH_EXPIRED_EVENT`.
- Produces: regression evidence that neither logout nor global 401 deletes pending IndexedDB records; updated Task 25 handoff status.

- [ ] **Step 1: Add a logout retention regression test**

Extend the hoisted API mock in `frontend/src/features/auth/api.test.tsx` with `POST`, import `fake-indexeddb/auto`, `MutationRepository`, `pendingMutationFixture`, `databaseName`, and `deleteDB`, then add:

```ts
it("退出登录只清理内存认证状态并保留 pending queue", async () => {
  const repository = new MutationRepository("user-1");
  await repository.put(pendingMutationFixture("logout-pending"));
  client.POST.mockResolvedValue({
    data: { data: { loggedOut: true } },
    response: new Response(null, { status: 200 }),
  });
  const { result } = renderHook(() => useLogoutMutation(), { wrapper });

  await act(() => result.current.mutateAsync());

  expect(await repository.get("logout-pending")).toBeDefined();
});
```

Delete `databaseName("user-1")` in `afterEach`. Do not modify `useLogoutMutation`.

- [ ] **Step 2: Add a global 401 retention regression test**

In `frontend/src/app/providers.test.tsx`, seed `MutationRepository("user-1")`, dispatch `AUTH_EXPIRED_EVENT`, wait for the Session cache to become `null`, and assert the seeded mutation remains readable. Add IndexedDB cleanup to `afterEach` only; do not call `clearLocalData` from `AppProviders`.

```ts
it("全局 401 清理认证缓存但保留当前用户 pending queue", async () => {
  const repository = new MutationRepository("user-1");
  await repository.put(pendingMutationFixture("expired-pending"));
  render(<AppProviders><QueryClientCapture /></AppProviders>);

  await act(async () => {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    await Promise.resolve();
  });

  expect(mountedQueryClient?.getQueryData(queryKeys.session)).toBeNull();
  expect(await repository.get("expired-pending")).toBeDefined();
});
```

- [ ] **Step 3: Run authentication and IndexedDB regression tests**

Run:

```powershell
npm --prefix frontend run test:unit -- src/features/auth/api.test.tsx src/app/providers.test.tsx src/pwa/indexed-db
```

Expected: all selected suites pass; logout and global 401 retain the seeded queue records.

- [ ] **Step 4: Verify no Query cache persistence was added**

Run in PowerShell:

```powershell
$matches = rg -n "persistQueryClient|PersistQueryClientProvider|@tanstack/query.*persist" frontend/src frontend/package.json frontend/package-lock.json
if ($LASTEXITCODE -eq 0) { $matches; throw "检测到未允许的 Query cache 持久化" }
if ($LASTEXITCODE -ne 1) { throw "Query cache 持久化检查执行失败" }
```

Expected: no matches.

- [ ] **Step 5: Run complete Frontend verification**

Run:

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: all unit tests pass, typecheck exits 0, production build exits 0, and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Update the handoff with measured results**

Update `docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md` to:

- Change current status to “Task 25 complete; Task 26 may begin” only after every command in Step 5 passes.
- Record the exact focused and full Frontend test counts and commands actually run.
- Document schema version 1, the two stores, per-user database naming, Snapshot ETag replacement, queue storage-only boundary, logout/401 retention, and explicit per-user deletion.
- Continue listing Tasks 26–31, real-device PWA acceptance, final Release Verification, physical cleanup Job, `v0.0.3`, and GHCR `0.0.3` as incomplete.
- State that Rust/PostgreSQL/OpenAPI and Phase 1E Playwright/Compose were not rerun because Task 25 changes only Frontend local persistence without visible UI or runtime-image behavior.

- [ ] **Step 7: Commit the Task 25 exit checkpoint**

```powershell
git add frontend/src/features/auth/api.test.tsx frontend/src/app/providers.test.tsx docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md
git commit -m "test: close task 25 indexeddb gate"
git status --short --branch
```

Expected: the commit succeeds and the worktree is clean.
