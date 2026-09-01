# CSV 与结算分享 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every behavior change follows RED -> GREEN -> regression.

**Goal:** 完成受 Session 与有效 ActivityMember 权限保护的结算摘要、PNG 导出和 CSV 下载闭环。

**Architecture:** Rust sharing application service 在一次 PostgreSQL `REPEATABLE READ READ ONLY` 事务中装载活动账务快照，并复用现有 Ledger/Recommendation 领域算法。React 通过 generated client 与 TanStack Query 读取摘要，使用独立分享页和固定 800px 导出画布生成 2x PNG。

**Tech Stack:** Rust 1.97、Axum、SQLx、PostgreSQL、utoipa；React 19、React Router、TanStack Query、openapi-fetch、html-to-image、Vitest。

**Spec:** User-approved plan in the current Codex task; no separate design document exists.

## Global Constraints

- 遵守 `AGENTS.md`：关键设计补充中文注释，用户可见错误与部署日志使用明确中文。
- 不新增数据库 migration、公开分享 Token、匿名访问、Web Share API 或服务端 PNG。
- 金额、Ledger、Balance 和 Recommendation 只由 Rust 权威计算；TypeScript 只做展示状态映射。
- API DTO 由 Rust/utoipa 导出 OpenAPI，再生成 TypeScript client；组件不直接 `fetch`。
- 只修改本功能需要的文件，不重构旧 Next.js 只读参考代码。

---

### Task 1: Rust Sharing/Summary 与 CSV 合同

**Files:**
- Create: `server/src/application/sharing.rs`
- Create: `server/src/infrastructure/sharing_repository.rs`
- Create: `server/src/http/sharing.rs`
- Create: `server/tests/sharing_api.rs`
- Modify: Rust module registries, router, OpenAPI, `contracts/openapi.json`, generated TypeScript client

**Interfaces:**
- Produce `GET /api/activities/{activity_id}/summary` with `ActivitySummaryData` containing activityName, memberCount, totalExpenseMinor, currency, revision, currentUserBalanceMinor, named balances and recommendations.
- Produce `GET /api/activities/{activity_id}/export.csv` with UTF-8 BOM, CRLF, fixed Chinese columns, safe quoting/formula neutralization, fixed filename and private/no-store headers.
- Both endpoints require Session plus active ActivityMember and load one repeatable-read read-only snapshot; deleted expenses and VOID settlements do not contribute.

**Steps:**
- [ ] Write application, serializer and PostgreSQL integration tests first; run each to observe the expected missing-feature failure.
- [ ] Implement the minimal application trait/types, repository snapshot and HTTP handlers; reuse `calculate_ledger` and `recommend_settlements`.
- [ ] Register routes and utoipa schemas, export OpenAPI, regenerate the TypeScript client.
- [ ] Run focused Rust tests, OpenAPI test, fmt and clippy; commit the reviewed task.

### Task 2: React 结算摘要、PNG 导出与 CSV 入口

**Files:**
- Create: `frontend/src/features/sharing/` adapter, page, card, image export and focused tests
- Modify: `frontend/src/app/router.tsx`, `frontend/src/api/query-keys.ts`, accounting/activity pages and `frontend/src/app.css`
- Modify: `frontend/package.json`, `frontend/package-lock.json`

**Interfaces:**
- Consume generated `ActivitySummaryData` only through feature adapter + TanStack Query.
- Add “生成分享摘要” to the Settlement tab and “数据导出 / 导出 CSV” to ActivityManagement Overlay.
- Add protected, lazy `/share-summary/:activityId`; suppress product navigation, activity header and PWA prompt.
- Render responsive preview plus off-screen 800px `#share-summary-card`; export only that node at pixelRatio 2 to `huddletab-settlement-summary.png`.

**Steps:**
- [ ] Write adapter, route, entry placement, card states and image export tests first; run each to observe the expected failure.
- [ ] Install `html-to-image@1.11.13` and implement the minimum adapter, query, pure card, export helper and page.
- [ ] Apply existing HuddleTab design tokens and local cover asset; cover empty, settled, long-name and mobile no-overflow states.
- [ ] Run focused Vitest, typecheck and production build; verify desktop/mobile browser flow and exported PNG width; commit the reviewed task.

### Task 3: Cross-Layer Verification

**Files:**
- Modify only files required to fix verification failures introduced by Tasks 1-2.

**Steps:**
- [ ] Run WSL PostgreSQL `sharing_api` integration tests against a disposable database.
- [ ] Run focused frontend tests, typecheck/build, Rust fmt/clippy and OpenAPI consistency checks.
- [ ] Verify Chromium at 1440x1000 and 390x844, CSV download, PNG dimensions, no horizontal overflow, and activity navigation remains exactly 流水/结算.
