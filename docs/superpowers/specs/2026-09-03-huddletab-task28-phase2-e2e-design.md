# Task 28 Phase 2 离线工作台设计

## 目标与边界

Task 28 只收口 Phase 2 的离线读取、Expense Create 前台同步、REJECTED 本地修正、PWA 更新保护和浏览器验收。不新增 Rust API、PostgreSQL migration 或 IndexedDB schema version 2，也不进入 Phase 3。

所有离线读取都以当前用户已经在线获得的 Activity Snapshot 为权威来源。Snapshot 通过现有 weak ETag 条件刷新并完整替换；网络恢复时重新条件刷新。Activity 列表、通知、邀请和管理数据不进入离线缓存。

## 身份与缓存安全

最近一次成功 Session 仅保存在当前标签页 `sessionStorage`。Session 请求只有在传输层网络错误时允许回退；服务端 401/403 等明确响应清除回退身份并沿用认证失效流程。IndexedDB 数据库名仍为 `huddletab:<user_id>`，任何离线读取都显式使用当前 Session 的 user id，禁止扫描或复用其他用户数据库。

## 离线工作台

在线 ActivityWorkspace 同时刷新 Activity Snapshot，并将 Activity、Member、Expense、Settlement、Ledger、Recommendation 作为完整对象提供给工作台。断网后只从该 Activity 的缓存 Snapshot 渲染流水、详情和结算主视图，并显示中文离线/缓存提示；pending Expense 单独展示，不叠加进权威金额统计。

离线唯一可写动作是 Expense Create：完整草稿和图片 Blob 通过既有 schema v1 队列入库，联网后由前台同步器串行发送。账单更新/删除、Settlement、活动、成员、邀请、审批和所有权转让在离线界面不暴露写入口。

## REJECTED 修正

REJECTED 行复用现有记账 Sheet，载入完整原始字段和待上传图片。修正必须沿用原 `clientMutationId`，在一个 IndexedDB readwrite 事务中原子替换 payload 与附件集合，并将 mutation 与附件重置为 `PENDING`、清除错误/服务端 id/尝试次数和自动汇率失效元数据。保留图片使用原 `clientAttachmentId`，新增图片生成新 id。只有事务重新确认仍为 REJECTED 时才允许修正；“丢弃本地记录”经二次确认后在同一事务删除 mutation 及附件，不影响服务端事实。

## PWA 更新闸门

`PwaUpdatePrompt` 监听既有队列变化事件，读取当前用户两个 object store 的状态。只要 Mutation 或 Attachment 存在 `PENDING`、`SYNCING`、`RETRYABLE` 或 `REJECTED`，沿用 v0.0.2 文案“有新版本可用，完成同步后更新”并禁用刷新。点击刷新前再次读取 IndexedDB；仅全部为空或 `SYNCED` 时调用现有 Service Worker 激活入口。Service Worker 不执行任何业务写入。

## UI 与验收

离线提示、Sheet、表单密度和按钮层级沿用远程/本地 `v0.0.2`；新栈活动主导航仍严格为“流水 / 结算”。固定 Phase 2 runner 复用 Phase 1E 的安全 Compose 编排，执行 Chromium Desktop `1440x1000`、Mobile `390x844` 的离线/重放/REJECTED/Snapshot 流程，以及既有附件、审批/所有权和 WebKit smoke；单 worker、零重试，报告和失败 trace 保留在 `frontend/artifacts`。
