# HuddleTab React/Vite + Rust/Axum 迁移交接

更新时间：2026-08-31

## 1. 当前结论

迁移分支已经具备 Phase 1 的核心业务闭环：认证、修改密码、活动、成员、邀请、记账、账本、推荐转账和结算可由 React/Vite 前端调用 Rust/Axum API 完成，同一 Rust 进程可托管 API 与 Vite 构建产物。

当前状态不能描述为“完整迁移完成”。通知、修改密码以外的账户设置、活动编辑与删除、定向邀请、CSV/分享，以及 Phase 2/3 能力仍未实现。

## 2. 代码位置与 Git 状态

| 项目 | 值 |
| --- | --- |
| 主仓库 | `D:\code\HuddleTab` |
| 迁移 worktree | `D:\code\HuddleTab\.worktrees\rust-replatform` |
| 当前分支 | `codex/rust-replatform` |
| UI/代码基线 | 远程 `v0.0.2` |
| 基线提交 | `2f1fad2f3411cc7c448fbc055fb81d4a96fd1dfa` |
| 当前检查点 | 本交接文档所在提交，使用 `git log -1 --oneline` 查看 |
| 远程仓库 | `https://github.com/thelinyue/HuddleTab.git` |

当前 React/Rust 迁移快照、修改密码流程和本文档已形成同一个 Git 检查点。接手时仍应先确认现场；若之后存在未提交改动，不要运行 `git clean`、`git reset --hard`，也不要删除 worktree：

```powershell
Set-Location D:\code\HuddleTab\.worktrees\rust-replatform
git status --short --branch
git diff --stat
```

## 3. 必须继续遵守的约束

- 前端固定为 React + TypeScript、Vite、React Router、TanStack Query。
- 服务端固定为单 Rust crate，使用 Axum、SQLx 和 PostgreSQL。
- PostgreSQL 与 Docker 验证必须在 WSL 环境执行。
- 项目尚未正式发布，不实现旧 Next.js API、Session、数据库或路由兼容层。
- 旧 Next.js 服务端仅可作为只读参考，不再增加功能。
- UI 以远程 `v0.0.2` 源码为唯一基准，不能使用旧版四标签活动页截图。
- 活动工作台只有“流水”和“结算”两个主视图；成员和活动管理由页头 Overlay 打开，不是活动标签。
- 只运行与本次改动相关的测试，不重复执行已经通过且未受影响的重型流程。
- 关键设计和非显然实现补充中文注释；用户可见错误与部署日志使用明确中文。
- 不新增没有具体失败场景支撑的 hash、baseline、contract freeze 或 gate。
- 不把临时账号、密码、Session、CSRF token 或 app secret 写入代码、文档和提交。

## 4. 正确的 UI 基线

远程 `v0.0.2` 中与活动页相关的权威文件：

```text
src/features/activities/components/activity-workspace.tsx
src/features/activities/components/activity-navigation.tsx
src/features/activities/components/activity-page-header.tsx
src/features/expenses/components/expense-feed.tsx
src/features/settlements/components/settlement-page.tsx
```

可以用 `git show v0.0.2:<文件路径>` 查看原始实现。旧的 `activity-desktop.png` 四标签页面已过期，不能作为验收依据。

当前 React Router 路由约定：

| 功能 | 路由 |
| --- | --- |
| 活动列表 | `/activities` |
| 流水 | `/activities/:activityId` |
| 结算 | `/activities/:activityId?tab=settlement` |
| 成员 Overlay | `/activities/:activityId?panel=members` |
| 活动管理 Overlay | `/activities/:activityId?panel=manage` |
| 新增支出 | `/activities/:activityId/expenses/new` |
| 支出详情 | `/activities/:activityId/expenses/:expenseId` |

不要恢复旧的 `/ledger`、`/members` 或 `/settlements` 活动子路由。

## 5. 当前架构

```text
frontend/   React、Vite、Router、TanStack Query、PWA Shell
server/     domain / application / infrastructure / http
contracts/  Rust/utoipa 导出的 OpenAPI
golden/     Rust 与 TypeScript 共用的账务向量
```

关键边界：

- Rust `domain` 负责金额、汇率、分摊、账本、余额和结算规则。
- `application` 负责编排权限、事务、revision、audit 和生命周期。
- `infrastructure` 提供 SQLx repository、Session、密码哈希、Clock 和 app secret。
- `http` 提供 Axum route、DTO、Cookie、CSRF、错误映射和 OpenAPI。
- SQLx row、Domain model、HTTP DTO 保持分离。
- 前端请求路径固定为 generated client -> feature adapter -> TanStack Query -> component。
- TypeScript 不重新计算权威 Ledger、Balance 或 Recommendation。

入口和关键文件：

```text
server/src/main.rs
server/src/http/router.rs
server/src/application/activity.rs
server/src/application/expense.rs
server/src/application/accounting.rs
server/src/application/settlement.rs
frontend/src/app/router.tsx
frontend/src/features/activities/pages.tsx
frontend/src/features/accounting/pages.tsx
frontend/src/api/generated/openapi.ts
contracts/openapi.json
```

Rust 二进制提供三个子命令：

```text
huddletab serve
huddletab bootstrap-user
huddletab openapi
```

## 6. 功能完成度

| 范围 | 当前状态 | 说明 |
| --- | --- | --- |
| 登录、退出、Session、CSRF | 可用 | 同源 Cookie；首位用户只能由 CLI 创建 |
| 邀请注册、邀请预览、加入活动 | 可用 | 注册和加入都会重新验证邀请 |
| 修改密码 API 与页面 | 可用 | `/me/password`；成功后轮换 Session 并清理旧 CSRF token |
| 活动列表、详情、创建 | 可用 | 管理 Overlay 当前只读 |
| 成员列表、临时成员 | 可用 | 成员是唯一账务身份 |
| 链接邀请创建、列表、撤销 | 可用 | 定向邀请表单未迁移 |
| Expense CRUD | 可用 | 支持幂等、版本冲突、软删除和双金额事实 |
| 多付款人、四种分摊、手工汇率 | 可用 | IDENTITY/MANUAL；Provider 属于 Phase 2 |
| Ledger、成员余额、推荐转账 | 可用 | 全部由 Rust 权威计算 |
| Settlement 创建、修改、作废 | 可用 | 删除语义为 VOID，不物理删除 |
| PWA Shell | 可用 | 不缓存 API；没有业务离线队列 |
| 通知页 | 占位 | Phase 2 尚未实现通知域 |
| “我的”页 | 部分可用 | 用户信息、修改密码和退出登录可用 |
| 活动改名、地点、日期、状态、删除 | 未实现 | 后端和前端均需按真实 API 补齐 |
| CSV、结算分享 | 未实现 | 不应提前宣称 v0.0.2 全功能等价 |
| 离线 Snapshot、Expense Queue | 未实现 | 属于 Phase 2 |
| 审批、附件、汇率 Provider | 未实现 | 属于 Phase 2 |
| 系统管理、注册策略、管理员重置密码 | 未实现 | 属于 Phase 3 |

## 7. 已验证的核心流程

最近一次已实际在浏览器走通：

```text
快速记账 -> 流水出现 -> 打开支出详情 -> 删除 -> Query 刷新后流水移除
```

修改密码流程也已在独立 WSL Compose 项目中走通：

```text
旧密码登录 -> 错误当前密码保留表单和 Session -> 正确改密并轮换 Session Cookie
-> 立即退出成功 -> 旧密码登录失败 -> 新密码登录成功
```

前端全局 401 中间件对 `/api/me/password` 做了明确豁免：该接口的 401 同时可能表示“当前密码错误”和“Session 已失效”，当前页面优先保留表单并展示服务端中文错误。成功改密只调用 `clearCsrfToken()`，不清空 TanStack Session cache；下一次写操作会在新 Session 上下文获取 CSRF token。

已检查桌面与移动端尺寸：

```text
1440 x 1000
390 x 844
```

活动导航读取结果为 `['流水', '结算']`。相关截图位于：

```text
C:\Users\林樾\.codex\visualizations\2026\08\31\01a05631-f9b2-7cf1-8bc3-d299acfdcdb3\huddletab-rust-v002
C:\Users\林樾\.codex\visualizations\2026\08\31\01a05834-e7c5-76e3-b28f-d9030154f213\password-e2e-output
```

最近已知通过的检查：

- Frontend Vitest：6 个测试文件、14 个测试通过。
- Frontend TypeScript typecheck 通过。
- Frontend production build 通过。
- Rust `cargo test --all-targets --all-features`：34 个测试通过；12 个需要 `TEST_DATABASE_URL` 的用例按显式条件跳过。
- Rust `cargo fmt --check` 通过。
- Rust clippy `--all-targets --all-features -D warnings` 通过。
- WSL Compose 完成生产镜像构建和启动验收。
- `/api/health` 返回 `{"data":{"status":"ok"}}`。
- SPA 深链返回 HTTP 200。
- 运行容器为 `uid=10001(huddletab)`。
- 运行镜像无 Node.js 命令，`/app` 中无 Next、Drizzle、Better Auth runtime。

这些结果是当前交接证据，不代表未实现的完整 Phase 1 E2E 矩阵已经通过。相关源文件修改后，只重跑受影响的检查。

## 8. 当前本地运行现场

交接时以下服务可访问：

| 服务 | 地址/名称 |
| --- | --- |
| 应用 | 已停止；提交前经授权终止占用构建产物的本地 `huddletab.exe` |
| 健康检查 | `5661` 当前不可用 |
| WSL PostgreSQL 容器 | `huddletab-rust-dev-postgres-6831` |
| PostgreSQL 主机端口 | `127.0.0.1:55432` |

`5661` 和容器名属于当前开发现场，不是产品固定配置。WSL PostgreSQL 现场仍保留；标准 Compose 对外端口默认是 `5660`。不要把现场数据库中的临时账号密码写入文档或提交。

## 9. 启动方式

### 9.1 使用 WSL Compose

从 PowerShell 启动标准双服务环境：

```powershell
wsl.exe bash -lc 'cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && docker compose up -d --build'
```

首次空数据库需要交互式创建首位用户：

```powershell
wsl.exe bash -lc 'cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && docker compose exec app huddletab bootstrap-user --username <用户名>'
```

查看状态与日志：

```powershell
wsl.exe bash -lc 'cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && docker compose ps'
wsl.exe bash -lc 'cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && docker compose logs --tail=100 app'
```

停止标准 Compose：

```powershell
wsl.exe bash -lc 'cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && docker compose down'
```

不要附加 `-v`，除非明确要删除 PostgreSQL 和 `/data` 持久数据。

### 9.2 前端热更新

前置条件是 Rust API 运行在 `127.0.0.1:5660`，因为 Vite proxy 当前指向该端口：

```powershell
npm --prefix frontend ci
npm --prefix frontend run dev
```

Vite 默认地址为 `http://127.0.0.1:5173`。

## 10. Contract 更新流程

Rust route 或 DTO 改动后，按顺序重新生成：

```powershell
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
npm --prefix frontend run typecheck
```

不要在组件中手写重复 DTO，也不要直接调用 `fetch`。当前 API 合同覆盖 Auth、Activity、Member、Guest、Invitation、Expense、Ledger、Recommendation 和 Settlement。

## 11. 按改动范围验证

避免无目的地反复运行全套测试。建议按以下映射执行：

| 改动范围 | 最小有效验证 |
| --- | --- |
| 活动流水排序/渲染 | `npm --prefix frontend test -- --run src/features/accounting/pages.test.ts` |
| 活动两视图路由 | `npm --prefix frontend test -- --run src/app/router.test.tsx` |
| 一般前端类型改动 | `npm --prefix frontend run typecheck` |
| 前端构建/PWA 配置 | `npm --prefix frontend run build` |
| 账务 API | `cargo test --manifest-path server/Cargo.toml --test accounting_api` |
| 成员与邀请 API | `cargo test --manifest-path server/Cargo.toml --test collaboration_api` |
| Rust 格式 | `cargo fmt --manifest-path server/Cargo.toml --check` |
| Rust 警告边界 | `cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings` |
| Dockerfile/Compose/runtime 改动 | 在 WSL 中重建镜像并做 health、非 root、无 Node runtime 验收 |

PostgreSQL integration tests 会清理测试表，只能指向可丢弃数据库。`frontend/package.json` 当前没有 `lint` 或 `test:e2e` 脚本，不要直接照搬旧计划中的对应命令。

## 12. 下一步优先级

1. 为成员 Overlay 增加定向邀请入口与 adapter。
2. 设计并实现活动编辑、生命周期和删除 API，再接入管理 Overlay；不要只做前端假交互。
3. 补齐 CSV 与结算分享，完成 `v0.0.2` 明确范围内的外围功能。
4. 完成 Phase 1 仍缺少的真实安全/并发/E2E 验收后，再进入 Phase 2。
5. Phase 2 再实现 Snapshot、IndexedDB、离线 Expense Queue、审批、通知、附件和汇率 Provider。

每完成一项，只运行对应测试和一个真实浏览器核心流程。视觉修改至少检查 `1440 x 1000` 与 `390 x 844`，并确认活动主导航仍只有“流水 / 结算”。

## 13. 相关设计文档

- `docs/superpowers/specs/2026-08-31-huddletab-rust-replatform-design.md`
- `docs/superpowers/plans/2026-08-31-huddletab-rust-replatform.md`

两份文档描述目标架构和完整阶段计划；本交接文档描述 2026-08-31 的实际落地状态。发生冲突时，以当前源码、OpenAPI 和本交接文档中的“功能完成度”为准，不得把计划项当成已完成功能。
