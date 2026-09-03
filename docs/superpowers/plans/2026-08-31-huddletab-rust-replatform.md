# HuddleTab React/Vite + Rust/Axum Replatform Implementation Plan

> **For agentic workers:** 在 `codex/rust-replatform` 隔离工作树中顺序执行。每个行为变更遵循 RED -> GREEN -> regression；配置、生成文件和纯脚手架只执行相应 build/serve 验证。旧 Next 服务端只读，直到 Phase 1A 的新运行基础独立通过后才删除。

**Goal:** 将 HuddleTab 切换为同源部署的 React/Vite PWA + Rust/Axum 模块化单体，同时保持现有产品与视觉交互成果。

**Architecture:** 单 Rust crate 按 `domain/application/infrastructure/http` 分层；Axum 同源提供 JSON API 和 Vite SPA；PostgreSQL 保存全部权威事实；OpenAPI 是 Rust 到 TypeScript 的唯一 Contract 来源。

**Tech Stack:** Rust、Axum、SQLx、PostgreSQL、Serde、Tower、utoipa、Argon2；React 19、TypeScript、Vite、React Router、TanStack Query、openapi-fetch、Vitest、Playwright。

## Global Constraints

- 遵守仓库 `AGENTS.md`：关键类和非显然设计补充中文注释，用户可见错误与关键部署日志使用明确中文。
- 只修改迁移直接需要的文件；不顺手重构旧 Next 代码。
- SQLx row、Domain entity、HTTP DTO 分离；只为 Repository、Clock、PasswordHasher、Session token 等真实边界建立 trait。
- Rust 使用 `i64` 金额与 checked `i128` 中间值；HTTP 金额、version 和 revision 使用十进制字符串。
- 组件不得直接 fetch 或手写重复 DTO；所有请求经 generated client、feature adapter 和 Query hook。
- PostgreSQL/Docker 验收必须使用真实 PostgreSQL，禁止以 mock 或 SQLite 冒充通过。
- 不默认新增 hash、baseline、冻结 gate；OpenAPI 生成一致性是明确 Contract 失败场景，允许 CI 检查生成无 diff。
- 每个阶段完成后自查 `git diff`，不提交 generated build artifacts 或 secrets。

## Baseline

迁移前记录：

- `npm run test:unit`：123 files passed，499 passed / 1 skipped。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm run test:integration`：当前机器缺少容器运行时，Testcontainers 无法启动；此项不是测试失败豁免，获得 Docker 后必须补跑。

---

## Phase 0: 冻结设计与迁移计划

### Task 0.1: 评审架构设计

**Files:**

- Create: `docs/superpowers/specs/2026-08-31-huddletab-rust-replatform-design.md`

**Verify:**

- 对照用户批准的 Architecture、Data、Auth、API、Frontend、Offline、Test Plan 逐项检查无遗漏。
- 明确 Phase 1/2/3 范围，避免在 Phase 1 偷渡离线队列或管理功能。

### Task 0.2: 冻结可执行计划

**Files:**

- Create: `docs/superpowers/plans/2026-08-31-huddletab-rust-replatform.md`

**Verify:** 每项任务包含文件边界、RED/GREEN 或构建验证、回归范围和阶段退出条件。

---

## Phase 1A: 新运行基础

### Task 1: 建立四目录与 workspace 命令

**Files:**

- Create: `frontend/`
- Create: `server/`
- Create: `contracts/`
- Create: `golden/`
- Modify: root `package.json` only when root orchestration is ready
- Modify: `.gitignore`, `.dockerignore`

**Steps:**

1. 创建最小 Vite React 19 应用，保留根 Next 脚本以便迁移期间基线对照。
2. 创建单 Rust crate 和 `domain/application/infrastructure/http` 模块树。
3. 定义稳定的本地命令：前端 dev/build/test、Rust fmt/clippy/test、OpenAPI generate/check。

**Verify:**

```powershell
npm --prefix frontend ci
npm --prefix frontend run build
cargo fmt --manifest-path server/Cargo.toml --check
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path server/Cargo.toml
```

### Task 2: Axum 静态托管与 JSON fallback

**RED tests:**

- `/api/health` 返回 `{data}` 和 request ID。
- 未知 `/api/*` 返回 JSON 404，不返回 `index.html`。
- 已知 API 的错误 method 返回 JSON 405。
- 非 API 深层路由回退 `index.html`。
- hashed asset 缺失返回普通 404，不错误回退 HTML。

**Files:**

- Create: `server/src/main.rs`
- Create: `server/src/lib.rs`
- Create: `server/src/http/{mod.rs,error.rs,router.rs,static_files.rs}`
- Create: `server/tests/http_shell.rs`

**GREEN:** 实现最小 Axum router、envelope、request-id middleware 和静态 SPA fallback。

**Verify:**

```powershell
cargo test --manifest-path server/Cargo.toml --test http_shell
cargo run --manifest-path server/Cargo.toml -- serve --static-dir frontend/dist
```

### Task 3: OpenAPI 单一来源

**RED tests:**

- OpenAPI 包含 health schema、统一 error schema 和 route。
- `openapi` 子命令输出稳定 JSON。
- TypeScript 生成类型可被 typed client 编译使用。

**Files:**

- Create: `server/src/http/openapi.rs`
- Create: `contracts/openapi.json`
- Create: `frontend/src/api/generated/openapi.ts`
- Create: `frontend/src/api/client.ts`
- Modify: `frontend/package.json`

**Verify:**

```powershell
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
npm --prefix frontend run typecheck
git diff --exit-code -- contracts/openapi.json frontend/src/api/generated/openapi.ts
```

生成一致性检查只防止 Rust route/DTO 与已提交 TypeScript contract 漂移，普通类型检查无法覆盖“忘记重新生成”的失败场景。

### Task 4: SQLx migration 骨架

**RED integration tests:**

- 空 PostgreSQL 可执行全部 migration。
- 重复启动不重复修改 schema。
- health readiness 在数据库不可用时给出明确中文日志并非零退出。

**Files:**

- Create: `server/migrations/`
- Create: `server/src/infrastructure/database.rs`
- Create: `server/tests/migrations.rs`

**Verify:**

```powershell
sqlx migrate run --source server/migrations
cargo test --manifest-path server/Cargo.toml --test migrations
```

### Task 5: Docker 双服务骨架

**Files:**

- Replace: `Dockerfile`
- Modify: `compose.yaml`
- Modify: `.dockerignore`
- Remove old runtime entrypoint only after the new image starts successfully

**Steps:**

1. Node build stage 生成 `frontend/dist`。
2. Rust build stage 编译 release binary。
3. 非 root runtime stage 只复制 binary、静态产物与必要系统数据。
4. Compose 保留 app + postgres、bind mounts、healthcheck 和 `5660:5660`。

**Verify:**

```powershell
docker compose build
docker compose up -d
Invoke-RestMethod http://127.0.0.1:5660/api/health
docker compose exec app sh -lc "! command -v node && ! find /app -iname '*next*' -o -iname '*drizzle*'"
docker compose down
```

**Phase 1A exit:** Vite build、Rust build/test、Axum serve、OpenAPI generation、fresh migration 和 Compose 启动全部通过。只有到此时才能删除旧 Next 运行基础。

---

## Phase 1B: Domain、Schema 与认证基础

### Task 6: Currency、Money 与 DecimalRate

**RED tests:**

- 支持币种 exponent、合法/非法 decimal parsing。
- `i64` 边界和 checked `i128` 溢出。
- rate 最多 12 位小数、规范化、identity、half-up 正负边界。
- Expense total 只换算一次。

**Files:**

- Create: `server/src/domain/{currency.rs,money.rs,exchange_rate.rs}`
- Create: `golden/currency.json`, `golden/exchange-rates.json`
- Create: Rust golden test loader

**Verify:** `cargo test --manifest-path server/Cargo.toml domain::`

### Task 7: Splitting、Ledger 与 Recommendation

**RED tests:**

- EQUAL/EXACT/PERCENTAGE/WEIGHT 守恒。
- 输入顺序改变不改变 UUID 稳定输出。
- 多付款守恒、Ledger 零和、Settlement 到归零。
- Recommendation 确定且忽略零余额成员。
- property tests 覆盖合法总额与成员集合。

**Files:**

- Create: `server/src/domain/{splitting.rs,ledger.rs,settlement.rs}`
- Create: `golden/splitting.json`, `golden/accounting.json`
- Create: `frontend/src/domain-preview/` 对应 TypeScript 子集测试

**Verify:**

```powershell
cargo test --manifest-path server/Cargo.toml domain::
npm --prefix frontend test -- --run src/domain-preview
```

### Task 8: Phase 1 Schema

**RED PostgreSQL tests:**

- 所有 UUID 主键与 `BIGINT` 金额类型正确。
- 跨活动 owner/payer/share/settlement 复合外键失败。
- 每活动 Owner 唯一。
- Expense/Settlement client mutation 唯一约束。
- Expense 软删除和 Settlement VOID constraint。
- transaction rollback 不遗留子表、Audit 或 revision。

**Files:**

- Create migrations for all Phase 1 tables
- Create: `server/src/infrastructure/repositories/`
- Create: `server/tests/schema_constraints.rs`

### Task 9: Username、PasswordHasher 与 bootstrap-user

**RED tests:**

- username NFKC/trim/lowercase 与 ASCII allowlist。
- password 不 normalization，按 Unicode 字符数验证 8–128。
- Argon2id 参数精确且参数落后时 rehash。
- 并发 bootstrap 只有一个成功，`users>0` 时拒绝。
- 日志和错误不包含密码。

**Files:**

- Create: `server/src/domain/identity.rs`
- Create: `server/src/application/bootstrap_user.rs`
- Create: `server/src/infrastructure/password.rs`
- Extend CLI in `server/src/main.rs`

### Task 10: Session、CSRF 与 Auth API

**RED tests:**

- 32-byte token，仅 SHA-256 hash 入库。
- 30-day idle、90-day absolute、24h last-seen throttle。
- logout、改密撤销与当前 session rotation。
- app-secret 持久化与并发原子创建。
- CSRF 绑定 session/pre-auth context，Origin 与 Sec-Fetch-Site 拒绝。
- Cookie 属性、JSON 401、rate limit。

**Files:**

- Create: `server/src/application/auth/`
- Create: `server/src/infrastructure/{session.rs,app_secret.rs,clock.rs}`
- Create: `server/src/http/auth.rs`
- Create focused unit/PostgreSQL/API tests

### Task 11: Activity、Member、Guest 与 Invitation

**RED tests:**

- 创建活动同步创建唯一 OWNER member。
- 权限与生命周期规则在 application 层执行。
- guest 是无 user binding 的账务身份。
- activity-scoped invitation 管理、公开预览和 join 路由。
- 注册与 join 分别重新验证邀请。
- Audit/revision 在单事务且 replay 不重复。

**Files:**

- Create domain entities/policies, application use cases, SQLx repositories and HTTP routes
- Create matching utoipa schemas and regenerate contract

**Phase 1B exit:** Domain/golden/property、Schema constraint、Auth/API、Activity/Member/Invite suites 全绿，OpenAPI 与前端类型无 diff。

---

## Phase 1C: Expense 与权威账务 API

### Task 12: Expense create 与双金额事实

**RED tests:**

- identity/manual rate validation。
- total 一次换算、payments/shares original/base 守恒。
- UUID 尾差顺序。
- client mutation replay 返回同一资源且不重复副作用。
- 跨活动成员、非成员、生命周期与权限拒绝。

**Files:**

- Create: Expense domain input/fact, application create use case, repository and route
- Update: migrations only when tests expose missing database constraints
- Regenerate OpenAPI client

### Task 13: Expense read/update/delete

**RED tests:**

- list/detail 只返回可见活动事实。
- update 带 version，冲突返回 409 并保留服务器事实。
- update 原子替换 payment/share facts。
- soft delete 排除 Ledger，重复 delete 语义稳定。
- 每个成功事务 audit/revision 仅一次。

### Task 14: Ledger 与 Recommendation endpoints

**RED tests:**

- 只读取 base facts。
- Expense 删除和 Settlement VOID 后结果正确。
- Ledger 总和永远为零。
- Recommendation 输出顺序和金额确定。
- 数据损坏返回明确内部完整性错误，不伪造平衡。

### Task 15: Settlement create/update/void

**RED tests:**

- 仅活动主币种、正数、不同成员。
- client mutation replay 与 audit/revision 单次副作用。
- update version conflict。
- DELETE 执行 VOID，不物理删除。
- 部分 settlement 到最终归零。

**Phase 1C exit:** 全部 Expense/Settlement API、PostgreSQL 副作用测试和 accounting golden tests 通过。

---

## Phase 1D: React/Vite UI 迁移

### Task 16: Router、Query 与应用 Shell

**RED tests:**

- 原 Next 页面路径由 React Router 匹配。
- auth guard、404、深链接刷新。
- QueryClient 默认重试与 401 清理。
- query key 按 user/activity/resource 隔离。

**Files:**

- Create: `frontend/src/app/{router.tsx,providers.tsx}`
- Create: `frontend/src/api/query-keys.ts`
- Migrate root layout, theme, toast and PWA registration

### Task 17: Framework coupling replacement

**Steps:**

1. 逐个迁移 UI primitives、tokens、assets 和 feature components。
2. `next/link` 替换为 Router Link/NavLink。
3. `next/image` 替换为尺寸稳定的原生 image/component。
4. `next/navigation` 替换为 router hooks。
5. Server Components 改为 route loaders/query hooks；禁止在组件中直接 fetch。

**Verify:** 31 个已识别 coupling 清零，视觉资产文件 hash 不改变。

### Task 18: Auth、Activity、Member、Invite adapters

**RED tests:**

- adapter 使用 generated paths/types。
- 登录/注册/加入、csrf refresh、logout/401 清理。
- mutations 精准 invalidate 对应 activity keys。
- 网络与 field errors 映射为中文 UI 错误。

### Task 19: Expense、Ledger、Settlement adapters 与 UI

**RED tests:**

- existing Picker、表单与四种 split 预览保持行为。
- 提交 payload 使用 generated DTO 与 client mutation UUID。
- 409 保留草稿并允许查看最新事实。
- Pending 状态不误入 Phase 1 权威 ledger。
- Ledger/Balance/Recommendation 不在 TypeScript 重算。

### Task 20: Phase 1 PWA shell

**RED tests:**

- manifest、icons、hashed assets 和 SPA shell 可缓存。
- `/api/*`、session、csrf、账务 JSON 永不缓存。
- 更新提示不静默刷新正在编辑的表单。

**Phase 1D exit:** frontend unit/typecheck/build 通过；关键页面 desktop/mobile screenshot 与现有设计等价；不存在组件直接 fetch 或重复 DTO。

---

## Phase 1E: 系统验收

### Task 21: 核心 E2E

实现并通过：

1. 单币种、单付款、均摊。
2. 外币固化手工汇率、多付款、非均摊。
3. 部分 Settlement 到最终归零。
4. Expense 双客户端 version conflict。
5. Settlement 双客户端 version conflict。

### Task 22: 安全与错误边界

验证 bootstrap 竞争、Session 时间边界、改密轮换、CSRF、Origin、Sec-Fetch-Site、限流、Cookie、API JSON 404/405、secret 日志脱敏。

### Task 23: 发布镜像

验证 migration upgrade、非 root、只含 Rust runtime、双服务 Compose、healthcheck、bind mounts 和冷启动中文错误日志。

**Phase 1 exit gate:** Rust fmt/clippy/test、PostgreSQL integration、frontend lint/typecheck/unit/build、Playwright Chromium/WebKit、Compose 和镜像内容检查全部通过。任何一项未通过不得进入 Phase 2。

---

## Phase 2: Offline 与完整协作

### Task 24: Revision Snapshot 与 ETag

先测试 weak ETag、304、完整 snapshot 一致性、revision 单次递增和客户端原子替换，再实现 endpoint、repository query 和 adapter。

### Task 25: IndexedDB 隔离

先测试 user/activity keyspace、schema upgrade、logout 保留 pending、显式本地清理，再实现 Snapshot 与 Queue stores。禁止持久化 Query cache。

### Task 26: Expense Create Queue

先测试前台串行、响应丢失 replay、network/5xx 有界重试、业务 REJECTED 保留原输入、pending 不改变 ledger，再实现同步状态机。

### Task 27: 审批、Guest Binding、Notification、Attachment、Rate Provider

每个能力分别按 Domain/Application/Schema/API/UI 的真实边界实施；附件先验证大小、类型、路径穿越和孤立文件清理；Provider 先验证 cache 过期与历史 rate 固化。

### Task 28: Phase 2 E2E

覆盖断网刷新、响应丢失幂等、REJECTED 修正、Snapshot ETag、PWA 更新不丢 pending，以及审批与附件关键流程。

---

## Phase 3: 管理与外围功能

### Task 29: System Admin 与 Registration Policy

先测试最后一个有效管理员、管理员重置密码撤销全部 session、策略并发更新，再实现 schema、policy、use case、API 和 UI。

### Task 30: 初始化 UI、CSV 与 Sharing Summary

CLI bootstrap 仍是首位用户唯一创建方式；初始化 UI 只引导部署者运行 CLI，不开放 HTTP bootstrap。CSV 和分享摘要先测试权限、转义、过期与隐私字段。

### Task 31: 设置与外围管理

Task 31 已收口为管理员存储占用与系统信息读取，不恢复 Better Auth/Drizzle 兼容层。SMTP、邮件测试和应用级备份/还原经产品决策移出范围；宿主/NAS 数据保护与活动软删除恢复分别保留在部署文档和既有业务 API 中。

---

## Release Verification

按顺序执行：

```powershell
cargo fmt --manifest-path server/Cargo.toml --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path server/Cargo.toml --all-features
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test:unit
npm --prefix frontend run build
npm --prefix frontend run test:e2e
docker compose build --no-cache
docker compose up -d
```

然后验证：

- fresh install 与已有新 Schema 的 upgrade 均成功。
- app 容器非 root，运行时不存在 Node、Next、Better Auth、Drizzle。
- `/api/*` 404/405 为 JSON，前端深链返回 SPA。
- Chromium 完整矩阵与 WebKit 关键回归通过。
- RC 在真实 iPhone Safari 与 Home Screen PWA 人工验收。
- `git status` 只包含预期源文件与生成 Contract，不包含 secrets、数据库、build artifacts。

## Commit Checkpoints

建议按可独立回滚的阶段提交：

```text
docs: 冻结 Rust 重构设计与实施计划
chore: 建立 Vite Axum OpenAPI SQLx 骨架
feat: 实现 Rust 账务领域与认证活动基础
feat: 实现账单账本与结算 API
feat: 迁移 React Router Query 前端
test: 完成 Phase 1 系统与发布验收
feat: 实现离线同步与完整协作
feat: 完成系统管理与外围功能
```

提交不是阶段通过的替代品；每个 checkpoint 必须保留对应 RED/GREEN 证据和回归结果。
