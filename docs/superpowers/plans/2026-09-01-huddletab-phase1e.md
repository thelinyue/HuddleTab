# HuddleTab Phase 1E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Follow RED -> GREEN -> regression and keep PostgreSQL/Docker work inside disposable WSL environments.

**Goal:** 完成单实例自托管定位下的安全、并发、浏览器和发布验收。

**Architecture:** Rust 进程内 fixed-window limiter 只保护三个共享敏感操作类别；账务并发继续由 PostgreSQL 事务、幂等键和 version 控制。React/Vite 新栈使用独立 Playwright 配置和临时 WSL Compose 环境验收。

**Tech Stack:** Rust 1.97、Axum、SQLx、PostgreSQL、React 19、Vite、Playwright、Docker Compose、PowerShell、WSL。

**Spec:** `docs/superpowers/specs/2026-08-31-huddletab-rust-replatform-design.md`，并以 `docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md` 的当前状态为准。

## Global Constraints

- 关键设计与非显然实现使用中文注释；用户错误与部署日志使用明确中文。
- 不进入 Phase 2，不修改旧 Next.js E2E，不新增产品 API。
- PostgreSQL/Docker 验收只使用 WSL 中的独立可丢弃环境。
- 不使用 Redis 或 PostgreSQL 保存限流状态，不删除遗留 `security_rate_limits` 表。
- 不记录密码、Session、CSRF、邀请 token、app-secret 或临时验收凭据。
- 普通 Activity、Member、Expense、Settlement、summary 和 CSV 不限流。

---

### Task 1: 进程内限流、客户端 IP 与 429 Contract

先写失败测试，再实现并发安全 fixed-window limiter：`Auth` 为登录和注册共享 `10/分钟/IP`，`AnonymousInvite` 为邀请预览和 join 共享 `30/分钟/IP`，`SensitiveAuthenticated` 为创建邀请、撤销邀请和改密共享 `10/分钟/user_id`。窗口从首次请求开始，最多 4096 个活跃桶，每 128 次检查和容量满时清理；仍满则新 identifier 返回 429。

`TRUST_PROXY=false` 只使用 TCP peer IP；字面值 `true` 时只接受合法单值 `X-Real-IP`，否则回退 peer IP。429 使用现有 JSON envelope、`RATE_LIMITED`、中文消息和整数秒 `Retry-After`。补充 OpenAPI 429 响应并生成 TypeScript client。

### Task 2: 敏感输入与安全 API 边界

为 bootstrap、登录、注册、改密和 join 等含明文 secret 的应用输入提供脱敏 `Debug`。使用真实 PostgreSQL 验证三个共享类别跨路由计数、IP/用户隔离、429 envelope/Retry-After，以及 Session/CSRF 仍是敏感写操作的前置条件。更新 `.env.example` 与 HTTPS 部署文档。

### Task 3: 账务并发与事务

使用真实 PostgreSQL 并发验证 Expense/Settlement 相同 `clientMutationId` 只产生一个资源和一次 Audit/revision，另一请求返回 replay；相同 version 的两个不同更新恰好一个成功、一个 `409 VERSION_CONFLICT`，最终 version、Audit 和 revision 只增加一次。只在测试暴露竞态时修改现有事务或锁顺序。

### Task 4: React/Vite Playwright 与临时 Compose

在 `frontend/` 建立独立 Playwright 配置、support 和 PowerShell 单一入口。入口自动安装依赖/浏览器，创建 WSL 临时目录、独立 Compose project/端口，构建、health、stdin bootstrap、运行测试、重启持久性与运行镜像检查，并在 `finally` 验证 `/tmp/huddletab-phase1e-*` 前缀后清理。

Chromium Desktop `1440x1000` 与 Mobile `390x844` 覆盖登录、活动/成员、单币种均摊、外币手工汇率/多付款/非均摊、部分结算到归零、Expense/Settlement 双上下文冲突、summary/CSV API、双主导航和无横向溢出。WebKit 只验证登录、创建活动和打开流水/结算。单 worker、零重试，失败保留 trace/截图，Chromium 保存成功态截图。

### Task 5: 发布验证与交接

运行相关 Rust/Frontend/OpenAPI/PostgreSQL 检查和 Phase 1E 单一 Compose/Playwright 命令。验证 fresh migration、SPA 深链、非 root UID、运行时无 Node/Next/Drizzle/Better Auth、中文冷启动数据库错误，以及 app/PostgreSQL 重启后数据可读。更新交接文档，只记录实际通过的证据和仍未实现的 Phase 2/物理清理任务。
