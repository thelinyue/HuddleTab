# HuddleTab Task 26 Expense Create Queue 设计

## 1. 目标

Task 26 在 Task 25 的 `pending_mutations` store 上实现 Expense Create 前台同步。用户提交新账单时先持久化完整输入，再由登录态下的前台同步器发送；同一条记录始终复用服务端已有的 `clientMutationId` 幂等合同。

本轮不实现 Service Worker 后台写入、审批、附件、通知、Guest Binding、汇率 Provider 或通用 mutation framework。

## 2. 状态与顺序

- 新记录为 `PENDING`，主键使用 `payload.clientMutationId`。
- 每次请求前写为 `SYNCING` 并增加 `attemptCount`。
- 成功后写为 `SYNCED`，保存 `serverExpenseId`，再刷新服务端 Expense、Ledger、Recommendation、Activity detail 查询。
- 网络错误、401、408、429 和 5xx 写为 `RETRYABLE`；一次前台 flush 对单条记录最多尝试 3 次，延迟为 1 秒、5 秒。达到本轮上限后保留记录，等待重新联网、下次登录前台或后续新入队再次触发。
- 其他 4xx 视为可修正的业务拒绝，写为 `REJECTED`，保留完整原始 payload 和中文错误。
- `SYNCING` 也会在下一次 flush 重放，用于页面中断或响应丢失后的恢复。

同步器按 `createdAt`、`id` 串行处理；同一同步器的并发 flush 共用同一个 Promise，避免同标签页重复发送。

每次发送前还会核对当前前台 Session 用户。旧用户队列在退避期间退出后立即停止，不能借用随后登录用户的 Session 重放。

## 3. 前端接入

`useCreateExpenseMutation` 只负责把完整 Expense Create 输入写入 IndexedDB 并通知前台同步器，不把离线或暂时失败误报为表单失败。同步器由受保护应用树挂载，在有效 Session、`online` 事件和新入队事件时运行。

流水页可显示 `PENDING`、`SYNCING`、`RETRYABLE` 和 `REJECTED` 记录，并明确标出同步状态。Pending 行不伪造成服务端 `ExpenseAggregate`，不可进入详情页，也不参与总消费、人均、外币统计、Ledger、余额或 Recommendation 计算。

## 4. 错误与保留边界

IndexedDB 写入失败会阻止表单关闭并展示本地数据错误，避免用户误以为账单已保存。网络与服务端暂时错误保留队列；业务拒绝保留原始输入供后续 Task 28 的修正流程使用。本轮不删除 `SYNCED` 记录，也不新增清理 Job。

登出和全局 401 继续保留当前用户数据库。换号后按 Task 25 的数据库名隔离，另一用户不能读取或同步该队列。

## 5. 验收

- 两条记录严格串行且顺序确定。
- 响应丢失后用相同 `clientMutationId` 重放并接受服务端 replay。
- 网络/5xx 最多自动尝试 3 次；业务 4xx 立即 `REJECTED`。
- 成功、重试和拒绝都持久化完整状态；原 payload 不被改写。
- pending 流水可见但不改变任何权威统计或账本查询。
- Frontend focused tests、全量 unit、typecheck 和 production build 通过。

Task 26 完成后只能声明“Expense Create 前台同步队列完成，可以进入 Task 27”。
