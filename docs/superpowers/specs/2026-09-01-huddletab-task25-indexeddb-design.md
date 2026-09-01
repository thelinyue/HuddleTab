# HuddleTab Task 25 IndexedDB 隔离设计

## 1. 目标

Task 25 为 Task 24 的 Activity Snapshot 和 Task 26 的 Expense Create Queue 提供浏览器本地持久化边界。本轮只实现用户隔离的 IndexedDB schema、Snapshot repository、Queue repository 和显式本地清理能力，不实现离线同步、重试、流水叠加或用户界面。

## 2. 范围

本轮包含：

- 按 `user_id` 隔离 IndexedDB 数据库。
- 在记录内保留 `activity_id`，并提供按活动读取 Snapshot 和 Queue 的接口。
- 完整保存 Task 24 的 weak ETag 与 Activity Snapshot，更新时原子替换整条记录。
- 保存 Task 26 后续需要的完整 Expense Create 输入和同步元数据。
- 登出和全局 401 只清理内存中的认证与 Query cache，不删除 IndexedDB。
- 仅通过显式调用按当前 `user_id` 删除本地数据库。
- 使用真实 IndexedDB API 的测试替身验证隔离、原子替换和清理边界。

本轮不包含：

- Task 26 的前台同步器、有限重试、REJECTED 处理和 pending 流水叠加。
- 离线页面切换、清理按钮或其他 UI。
- Attachment、审批、通知、汇率 Provider 或 Service Worker 业务同步。
- TanStack Query cache 持久化。
- 未发布旧 Next.js IndexedDB 数据兼容或迁移。

## 3. 数据库与 Schema

每个用户使用独立数据库：

```text
huddletab:<user_id>
```

数据库从 schema version 1 开始，只创建两个 object store：

```text
activity_snapshots   keyPath: activityId
pending_mutations    keyPath: id; index: by-activity(activityId)
```

当前产品尚未发布正式版本，因此不迁移旧 `activity_preferences`、`pending_attachments` 或旧格式 Snapshot。测试只验证 fresh database 的 upgrade callback 正确建立 version 1 schema；真实跨版本迁移在发布后首次修改 schema 时随该修改增加。

### 3.1 Snapshot 记录

```ts
type ActivitySnapshotRecord = {
  userId: string;
  activityId: string;
  etag: string;
  snapshot: ActivitySnapshotData;
  fetchedAt: number;
};
```

`SnapshotRepository.replace()` 使用单次 IndexedDB `put` 整体替换记录，不进行字段级合并。`refresh()` 先读取当前记录并调用 Task 24 `fetchActivitySnapshot()`：200 写入完整新记录，304 返回并保留当前记录。

### 3.2 Queue 记录

```ts
type PendingExpenseMutation = {
  id: string;
  userId: string;
  activityId: string;
  kind: "CREATE_EXPENSE";
  payload: CreateExpenseRequest;
  status: "PENDING" | "SYNCING" | "RETRYABLE" | "REJECTED" | "SYNCED";
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: { code: string; message: string };
  serverExpenseId?: string;
  createdAt: number;
  updatedAt: number;
};
```

Task 25 的 Queue repository 只负责完整记录的原子保存、按 ID 读取和按 Activity 列出。它不生成 mutation ID、不改变状态，也不决定重试时间；这些行为属于 Task 26。

## 4. 隔离与生命周期

Repository 由 `user_id` 构造，数据库名由该 ID 唯一确定；调用方不能传入另一个用户的数据库名。写入时 repository 使用自己的 `user_id` 形成记录，避免调用方伪造记录归属。

每次 repository 操作短暂打开数据库并在完成后关闭，避免长期连接阻塞显式删除。`clearLocalData(userId)` 只删除该用户对应的数据库，不扫描或删除其他用户数据。

退出登录、Session 撤销和全局 401 不调用 `clearLocalData()`。换号后的 repository 使用另一个数据库名，因此新用户无法读取上一用户的 Snapshot 或 pending queue。

## 5. 错误边界

IndexedDB 打开、事务或删除失败时向调用方抛出明确的中文错误，并保留原始 `cause`。Repository 不静默降级为内存存储，避免用户误以为离线数据已经持久化。

Snapshot 缺失返回 `undefined`；需要完整缓存的调用方可使用 `require()`，其错误为“此活动尚未缓存，无法离线查看。”。Task 25 不把 IndexedDB 错误映射为产品 API 错误。

## 6. 测试与验收

使用 Vitest 和 `fake-indexeddb` 测试：

- 不同 `user_id` 使用不同数据库，Snapshot 和 Queue 不可互读。
- 同一用户的不同 `activity_id` 可分别读取，Queue 按 Activity 隔离并稳定排序。
- fresh database 正确创建两个 store 与 `by-activity` 索引。
- Snapshot 新 ETag 和完整 body 原子替换旧记录；304 保持原对象内容。
- Queue 保存完整 Create Expense 输入，不执行同步状态转换。
- 显式清理只删除指定用户数据库。
- 登出和全局 401 后 pending queue 仍存在。
- 源码和依赖中没有 TanStack Query persistence 插件或 Query cache 持久化入口。

完成 focused tests 后运行 Frontend 全量单元测试、typecheck 和 production build。本轮没有服务端、OpenAPI、可见 UI 或运行镜像变化，不重复 Rust/PostgreSQL 和 Phase 1E Playwright/Compose 验收。

## 7. 完成边界

Task 25 完成后只能声明“IndexedDB 隔离和本地存储边界完成，可以进入 Task 26”。不得声明离线 Expense 已可用，也不得创建 `v0.0.3`、发布 `0.0.3` 镜像或进入正式发布流程。
