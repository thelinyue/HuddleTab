# HuddleTab Task 26 Expense Create Queue 实施计划

**Goal:** 在 Task 25 IndexedDB 边界上实现单用途 Expense Create 前台同步队列。

**Spec:** `docs/superpowers/specs/2026-09-01-huddletab-task26-expense-queue-design.md`

## 约束

- RED -> GREEN；每个新行为先看到预期失败。
- 只同步 Expense Create，不抽象通用 mutation runner。
- 不新增服务端 API、Schema 或 OpenAPI 改动。
- pending 展示不得进入权威 Expense 聚合、统计、Ledger 或余额。
- 不进入 Task 27，不发布或标记 `0.0.3`。

## 执行步骤

1. 扩展 `MutationRepository`，增加全队列确定排序读取；验证用户隔离和状态完整持久化。
2. 新增 Expense Queue 同步器测试，覆盖串行、同 Promise 去重、响应丢失重放、3 次有限重试、业务拒绝和原输入保留。
3. 实现最小同步器与 API 发送边界，并在登录前台、重新联网和新入队时触发。
4. 将 Expense Create hook 改为先入队；增加 pending 查询与流水展示测试，断言服务端统计和 Ledger query 不受影响。
5. 运行 scoped tests、Frontend 全量 unit、typecheck、production build 和 `git diff --check`。
6. 更新交接文档，只将状态推进到“Task 26 完成，可以进入 Task 27”，然后提交检查点。
