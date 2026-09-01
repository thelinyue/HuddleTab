# HuddleTab React/Vite + Rust/Axum 迁移交接

更新时间：2026-09-01

## 1. 当前结论

迁移分支已经具备 Phase 1 的核心业务闭环：认证、修改密码、活动资料与生命周期、30 天删除恢复、成员、邀请、记账、账本、推荐转账、结算、CSV 导出和受权结算摘要分享均可由 React/Vite 前端调用 Rust/Axum API 完成，同一 Rust 进程可托管 API 与 Vite 构建产物。Phase 1E 的安全、并发、真实浏览器和候选运行镜像结构验收已于 2026-09-01 通过；这只表示 Phase 1 exit gate 通过，可以进入 Phase 2，不表示完整迁移或正式发布已经完成。

Phase 2 Task 24 的 Activity Revision Snapshot 与 weak ETag 已完成，可以进入 Task 25。当前状态仍不能描述为“完整迁移完成”或“达到正式发布状态”；Phase 2 Task 25–28、Phase 3 Task 29–31、最终 Release Verification 和真机 iPhone Safari/Home Screen PWA 人工验收仍未完成。活动过期删除记录暂不物理清理，后台清理 Job 另立后续任务。正式镜像版本预留为 `0.0.3`、对应 tag 为 `v0.0.3`，当前不得创建 tag、发布镜像或宣称远程镜像可用。

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

当前 React/Rust 迁移快照、Phase 1E 收口修复、Task 24 与本文档已形成 Git 检查点。Task 24 增加授权后的一致性 Snapshot、weak ETag 条件请求和 Frontend adapter，但没有增加 IndexedDB 或离线 UI。接手时仍应先确认现场；若之后存在未提交改动，不要运行 `git clean`、`git reset --hard`，也不要删除 worktree：

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
| 结算分享摘要 | `/share-summary/:activityId`；受保护的独立 Shell，不渲染全局导航 |

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
server/src/application/snapshot.rs
server/src/infrastructure/snapshot_repository.rs
server/src/http/snapshot.rs
frontend/src/app/router.tsx
frontend/src/features/activities/pages.tsx
frontend/src/features/activities/snapshot-api.ts
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
| 敏感入口限流 | 可用 | 单实例进程内 fixed-window；Auth、匿名邀请、已认证敏感写操作分别共享类别配额 |
| 邀请注册、邀请预览、加入活动 | 可用 | 注册和加入都会重新验证邀请 |
| 修改密码 API 与页面 | 可用 | `/me/password`；成功后轮换 Session 并清理旧 CSRF token |
| 活动列表、详情、创建、资料编辑 | 可用 | 名称、地点、日期由 Owner 管理；存在历史 Expense 或 Settlement 后主币种永久锁定 |
| 活动生命周期、删除与恢复 | 可用 | ACTIVE/ENDED/ARCHIVED 封闭状态机；删除覆盖原状态，30 天内 Owner 可恢复 |
| 成员列表、临时成员 | 可用 | 成员是唯一账务身份 |
| 链接与定向邀请创建、列表、撤销 | 可用 | 定向邀请按用户名绑定且固定单次使用；明文口令只保留在当前组件内存 |
| Expense CRUD | 可用 | 支持幂等、版本冲突、软删除和双金额事实 |
| 多付款人、四种分摊、手工汇率 | 可用 | IDENTITY/MANUAL；Provider 属于 Phase 2 |
| Ledger、成员余额、推荐转账 | 可用 | 全部由 Rust 权威计算 |
| Settlement 创建、修改、作废 | 可用 | 删除语义为 VOID，不物理删除 |
| PWA Shell | 可用 | 不缓存 API；没有业务离线队列 |
| 通知页 | 占位 | Phase 2 尚未实现通知域 |
| “我的”页 | 部分可用 | 用户信息、修改密码和退出登录可用 |
| CSV、结算分享 | 可用 | 有效 ActivityMember 可下载 CSV，并从结算页生成受保护摘要和 1600px PNG |
| Activity Revision Snapshot / weak ETag | 可用 | Task 24；完整 Snapshot 条件读取，尚未接 IndexedDB |
| IndexedDB、离线 Expense Queue | 未实现 | Task 25 及后续 Phase 2 任务 |
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

定向邀请前端流程已按真实 OpenAPI DTO 接入：Owner 在 `ACTIVE` 活动的成员 Overlay 中进入邀请子面板，选择“定向邀请”并输入目标用户名；adapter 固定映射为 `DIRECT`、`maxUses: 1`。普通成员和非活动状态不会发起必然返回 403 的邀请列表请求；已撤销、已过期或已用尽的邀请不会显示在“有效邀请”中。服务端定向邀请注册、加入和撤销仍由既有 `collaboration_api` 集成测试覆盖，本轮未修改 Rust 或 OpenAPI。

活动管理闭环已连接真实 Rust、React 与 PostgreSQL 在 Chromium 中走通：

```text
登录 -> 创建完整活动 -> 编辑资料 -> 添加临时成员 -> 创建账单
-> 确认主币种锁定 -> END -> Settlement 新增/修改/作废
-> ARCHIVE 后 Expense/Settlement 只读 -> UNARCHIVE -> REOPEN
-> 删除 -> 已删除活动 Overlay -> 恢复到删除前 ACTIVE 状态
```

浏览器流程还验证了 Activity 管理 Overlay 子视图焦点、删除二次确认、回收列表懒加载，以及 accounting mutation 后立即刷新服务端字段权限。`ENDED` 仅保留 Settlement 写入，`ARCHIVED` 关闭全部账务写入口；非 ACTIVE Expense 详情仍显示分类、原始/折算金额、汇率、付款事实、分摊方式和成员份额。

CSV 与结算分享闭环已在真实 Chromium 中走通：

```text
未登录访问分享页 -> 跳转登录 -> 登录后活动导航仍只有“流水 / 结算”
-> ActivityManagement 原生下载 CSV -> 结算页生成分享摘要
-> 独立分享页预览 -> 导出 huddletab-settlement-summary.png
```

摘要和 CSV API 均在一次 `REPEATABLE READ READ ONLY` 事务中完成成员权限校验与账务装载。CSV 使用 UTF-8 BOM、固定中文表头、CRLF、全字段双引号和公式注入防护；分享图片只捕获固定 800px 的 `#share-summary-card`，`pixelRatio: 2`，最终 PNG 宽度为 1600px，不包含按钮或导航。ACTIVE、ENDED、ARCHIVED 均只读可见，软删除活动和 LEFT 成员不可访问。

已检查桌面与移动端尺寸：

```text
1440 x 1000
390 x 844
```

活动导航读取结果为 `['流水', '结算']`。相关截图位于：

```text
C:\Users\林樾\.codex\visualizations\2026\08\31\01a05631-f9b2-7cf1-8bc3-d299acfdcdb3\huddletab-rust-v002
C:\Users\林樾\.codex\visualizations\2026\08\31\01a05834-e7c5-76e3-b28f-d9030154f213\password-e2e-output
C:\Users\林樾\.codex\visualizations\2026\08\31\01a05883-1c70-7162-b722-d65070b30e4b\direct-invite-implementation
C:\Users\林樾\.codex\visualizations\2026\08\31\01a058ab-62c3-7141-be71-7df4385d4e93\activity-management-e2e
C:\Users\林樾\.codex\visualizations\2026\09\01\01a05aaa-8d7f-75b3-9ced-1653555239e8\final-77247d7-browser-evidence.json
C:\Users\林樾\.codex\visualizations\2026\09\01\01a05aaa-8d7f-75b3-9ced-1653555239e8\final-77247d7-huddletab-settlement-summary.png
```

### 7.1 Phase 1E 候选运行镜像结构验收

以下命令均在 `D:\code\HuddleTab\.worktrees\rust-replatform` 新鲜运行。标记为数据库测试的命令通过进程环境注入 `TEST_DATABASE_URL`，连接指定的 WSL 可丢弃 PostgreSQL；连接值未写入本文档。

```powershell
cargo test --manifest-path server/Cargo.toml --all-targets --all-features
cargo test --manifest-path server/Cargo.toml --all-targets --all-features -- --ignored --test-threads=1
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
git diff --exit-code -- contracts/openapi.json frontend/src/api/generated/openapi.ts
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
cargo fmt --manifest-path server/Cargo.toml --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
& ./frontend/e2e/support/run-phase1e-safety.test.ps1
wsl.exe -d Debian -- sh -lc "cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && sh frontend/e2e/support/prepare-data-dir-arguments.test.sh"
wsl.exe -d Debian -- sh -lc "cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && sh frontend/e2e/support/prepare-data-dir-paths.test.sh"
wsl.exe -d Debian -- sh -lc "cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && sh frontend/e2e/support/data-directory-permissions.test.sh"
& ./frontend/e2e/run-phase1e.ps1
```

精确结果：

- Rust 非数据库全量为 55 passed、39 个显式 PostgreSQL 用例 ignored、0 failed；fmt 与 clippy 均通过。
- WSL 真实 PostgreSQL 全量为 39 passed、0 failed，均以 `--test-threads=1` 运行；其中 Auth 6、Accounting 11、Activity 9、Bootstrap 3、Collaboration 3、Rate limit 4、Migration 1、Schema 1、Sharing 1。
- Frontend Vitest 为 15 个文件、71 passed、0 failed；其中 deferred-promise 回归证明迟到 Session 与 CSRF 请求不能跨越登录失效边界回写缓存；typecheck 通过，production build 转换 1655 modules 并生成 PWA service worker。
- Rust OpenAPI 与 TypeScript client 重新生成后 `git diff --exit-code` 为 0，没有需要提交的生成变化。
- runner 安全专项测试通过；目录参数与路径测试证明自定义 Compose 参数、根目录、越界相对路径和 `app` symlink escape 均在容器操作前被拒绝；真实目录权限测试证明 root:root `0755` 下 UID 10001 不可写，准备后挂载点为 `10001:10001`、`0750` 且可写。

浏览器矩阵由单 worker、零重试运行：

| Project | 视口 | 用例 | 结果 |
| --- | --- | --- | --- |
| Chromium Desktop | `1440 x 1000` | 核心账务、双上下文 Expense/Settlement 冲突、summary/CSV、双主导航、无横向溢出 | 1 passed |
| Chromium Mobile | `390 x 844` | 与 Desktop 相同的核心矩阵及移动布局 | 1 passed |
| WebKit | `1440 x 1000` | 登录、创建活动、打开流水与结算 | 1 passed |

单一入口 `frontend/e2e/run-phase1e.ps1` exit code 为 0，并提供以下 Phase 1 候选运行结构证据：

- 从当前源码 fresh build Rust release binary、Vite 静态产物和独立 WSL Compose 候选镜像；runner 从 `0755` host 目录调用受限的数据目录准备脚本，不依赖 `0777`；空 PostgreSQL 完成 fresh migration，首位用户只经 stdin bootstrap。
- `/activities/deep-link-release-check` 返回包含 React root 的 HTTP 200；运行容器 UID 为非 root `10001`。
- 运行镜像找不到 `node`、`npm`、`npx`、`next`，`/app` 与 `/usr/local` 无 `node_modules`、Next、Drizzle ORM 或 Better Auth runtime 目录。
- app 单独重启后、PostgreSQL 与 app 一起重启后，浏览器创建的测试活动均仍可读取。
- PostgreSQL 不可用时 app 冷启动按预期失败，并输出“无法连接 PostgreSQL，请检查 DATABASE_URL 和数据库状态”的中文部署错误。
- HTML report 保留在 `frontend/artifacts/playwright-report/index.html`；Desktop/Mobile 成功截图保留在 `frontend/artifacts/test-results/` 对应 project 目录。
- artifact 脱敏处理成功，敏感扫描 0 命中；`frontend/artifacts/` 被 Git ignore 且无文件被 tracking。
- finally 已关闭独立 Compose、删除限定前缀临时数据目录；复查无 `/tmp/huddletab-phase1e-*`、同前缀 Compose project、容器或网络残留。

此前五项 review 修复的 RED/GREEN 与完整命令证据记录在 ignored `.superpowers/sdd/2026-09-01-huddletab-phase1e/final-fix-report.md`，该文件不纳入 Git tracking。本次收口新增的认证竞态与目录安全证据已记录在上述 tracked 测试和实际命令结果中。

### 7.2 Phase 2 Task 24 Activity Revision Snapshot

Task 24 新增 `GET /api/activities/{activity_id}/snapshot`。Repository 在单个 `REPEATABLE READ READ ONLY` 事务中完成 ACTIVE ActivityMember 授权、revision 读取和 Activity、成员、未删除 Expense 及 Payment/Share、Settlement 的完整装载；application 层使用同一批事实计算 Ledger 与 Recommendation。Snapshot 不包含 Invitation、Audit、CSV、分享数据或敏感 token。

响应使用 `ETag: W/"<revision>"` 与 `Cache-Control: private, no-store`。合法 `If-None-Match` 在授权和 revision 读取后判断：命中返回带相同响应头、无 body 的 304；过期或非法条件头返回完整 200 JSON。Frontend `fetchActivitySnapshot()` 只允许 200 整体替换或 304 复用原对象；无本地 Snapshot 却收到 304 时只做一次无条件 GET，协议异常使用明确中文错误。Task 24 没有创建 IndexedDB store、持久化 Query cache 或离线页面切换。

本轮实际执行：

```powershell
cargo test --manifest-path server/Cargo.toml --test snapshot_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test activity_api lifecycle_delete_and_restore_follow_the_frozen_state_machine -- --ignored --exact --test-threads=1
cargo test --manifest-path server/Cargo.toml --test collaboration_api owner_can_add_guest_and_invite_a_user_into_the_activity -- --ignored --exact --test-threads=1
cargo test --manifest-path server/Cargo.toml --test accounting_api expense_crud_keeps_double_amount_facts_idempotency_and_versions -- --ignored --exact --test-threads=1
cargo test --manifest-path server/Cargo.toml --test accounting_api expense_noop_ -- --ignored --test-threads=1
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path server/Cargo.toml
```

精确结果：Task 24 scoped PostgreSQL 共 7 passed，包括 Snapshot 2 个、Activity 生命周期/协作 revision/Expense 与 Settlement 完整生命周期 3 个，以及 Expense noop 边界 2 个。其中 Expense/Settlement 同值 PUT 均保持 version、revision、Audit 不变，Expense Payment/Share fact ID 也保持不变；额外覆盖零主币金额的逆序与重复付款事实，以及 PostgreSQL 2000 epoch 前后的纳秒时间精度。Rust 非数据库 53 passed、0 failed；OpenAPI 5 passed；Frontend 16 个文件、76 passed、0 failed，typecheck 与 production build 通过；fmt 与 clippy 通过。OpenAPI 和 TypeScript client 连续生成两次后 SHA-256 均保持一致。本轮没有 UI 或运行镜像变化，因此未重复 Phase 1E Playwright/Compose 矩阵。

## 8. 当前本地运行现场

交接时没有启动 Rust API 或 Vite 开发服务器，不应直接宣称 `5660` 或 `5173` 可访问。以下 WSL PostgreSQL 测试现场仍在运行：

| 服务 | 地址/名称 |
| --- | --- |
| Rust API | 未启动 |
| Vite 前端 | 未启动 |
| WSL PostgreSQL 容器 | `huddletab-rust-dev-postgres-6831` |
| PostgreSQL 主机端口 | `127.0.0.1:55432` |

端口和容器名属于当前开发现场，不是产品固定配置。该 PostgreSQL 实例是会被集成测试清表的可丢弃数据库，不能存放开发或生产数据；标准 Compose 对外端口默认是 `5660`。浏览器验收账号只用于专用可丢弃数据库，临时密码未写入代码、文档或提交。

## 9. 启动方式

### 9.1 使用 WSL Compose

从 PowerShell 启动标准双服务环境：

```powershell
wsl.exe bash -lc 'cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && docker compose build app && sh ./scripts/prepare-data-dir.sh && docker compose up -d'
```

`prepare-data-dir.sh` 固定校验仓库 `compose.yaml`，只接受可选的 `--project-name`，并在一次性 root 容器启动前解析和校验真实 `DATA_HOST_DIR/app`；随后仅把 app 挂载点设置为 `10001:10001`、`0750`。app 服务仍以 UID/GID `10001:10001` 运行。新建挂载目录或迁移到新宿主时不可跳过；已有目录且属主未变化时无需重复执行。

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

不要在组件中手写重复 DTO，也不要直接调用 `fetch`。当前 API 合同覆盖 Auth、Activity、Member、Guest、Invitation、Expense、Ledger、Recommendation、Settlement 和 Sharing Summary；CSV 由原生同源下载链接调用。

Activity 管理合同：

| 方法与路径 | 用途 |
| --- | --- |
| `POST /api/activities` | 创建完整活动资料 |
| `GET /api/activities?view=current\|deleted` | 当前活动或 Owner 恢复窗口列表 |
| `PUT /api/activities/{id}` | 按 version 更新获准字段，返回 warnings |
| `POST /api/activities/{id}/lifecycle` | END/REOPEN/ARCHIVE/UNARCHIVE |
| `DELETE /api/activities/{id}` | 保留原生命周期的软删除 |
| `POST /api/activities/{id}/restore` | 在 `now < purgeAfter` 时恢复 |
| `GET /api/activities/{id}/summary` | 当前成员的实时结算摘要；`private, no-store` |
| `GET /api/activities/{id}/snapshot` | 授权后的完整 Activity Snapshot；weak ETag 条件读取；`private, no-store` |
| `GET /api/activities/{id}/export.csv` | UTF-8 BOM CSV；固定下载名 `activity-export.csv` |

## 11. 按改动范围验证

避免无目的地反复运行全套测试。建议按以下映射执行：

| 改动范围 | 最小有效验证 |
| --- | --- |
| 活动流水排序/渲染 | `npm --prefix frontend test -- --run src/features/accounting/pages.test.ts` |
| 活动两视图路由 | `npm --prefix frontend test -- --run src/app/router.test.tsx` |
| 成员与邀请前端 | `npm --prefix frontend test -- --run src/features/activities/api.test.ts src/features/activities/pages.test.tsx` |
| Activity/Accounting 生命周期 UI | `npm --prefix frontend test -- --run src/features/activities/api.test.ts src/features/activities/pages.test.tsx src/features/accounting/api.test.tsx src/features/accounting/pages-ui.test.tsx` |
| CSV/分享前端 | `npm --prefix frontend test -- --run src/features/sharing src/features/accounting/pages-ui.test.tsx src/features/activities/pages.test.tsx src/app/router.test.tsx` |
| 一般前端类型改动 | `npm --prefix frontend run typecheck` |
| 前端构建/PWA 配置 | `npm --prefix frontend run build` |
| 账务 API | `cargo test --manifest-path server/Cargo.toml --test accounting_api` |
| 活动管理 API | `cargo test --manifest-path server/Cargo.toml --test activity_api` |
| 成员与邀请 API | `cargo test --manifest-path server/Cargo.toml --test collaboration_api` |
| CSV/分享 API | `cargo test --manifest-path server/Cargo.toml --test sharing_api`；数据库用例设置 `TEST_DATABASE_URL` 后运行 `cargo test --manifest-path server/Cargo.toml --test sharing_api summary_and_csv_use_one_private_authorized_snapshot -- --ignored --exact --test-threads=1` |
| Activity Revision Snapshot | 设置可丢弃 `TEST_DATABASE_URL` 后运行 `cargo test --manifest-path server/Cargo.toml --test snapshot_api -- --ignored --test-threads=1` |
| Rust 格式 | `cargo fmt --manifest-path server/Cargo.toml --check` |
| Rust 警告边界 | `cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings` |
| Dockerfile/Compose/runtime 改动 | 在 WSL 中重建镜像并做 health、非 root、无 Node runtime 验收 |

PostgreSQL integration tests 会清理测试表，只能指向可丢弃数据库。`frontend/package.json` 当前没有 `lint` 脚本；`test:e2e` 依赖由单一入口创建的临时环境变量与 Compose，必须通过 `& ./frontend/e2e/run-phase1e.ps1` 运行。

## 12. 下一步优先级

1. Phase 2 Task 25–28：实现 IndexedDB 隔离、离线 Expense Queue、审批、Guest Binding、通知、附件、汇率 Provider 和 Phase 2 E2E；Task 24 Revision Snapshot/ETag 已完成。
2. Phase 3 Task 29–31：实现 System Admin、Registration Policy、初始化引导、其余账户设置和外围管理。
3. 完成最终 Release Verification 与真机 iPhone Safari/Home Screen PWA 人工验收后，才可创建 `v0.0.3` 并发布 `ghcr.io/thelinyue/huddletab:0.0.3`；本轮不执行这些操作。
4. 另立后台清理 Job 处理超过恢复窗口的 Activity 物理清理；当前只隐藏并禁止恢复，不会物理删除记录。

每完成一项，只运行对应测试；涉及 UI 或运行镜像时再运行对应真实浏览器核心流程。视觉修改至少检查 `1440 x 1000` 与 `390 x 844`，并确认活动主导航仍只有“流水 / 结算”。

## 13. 相关设计文档

- `docs/superpowers/specs/2026-08-31-huddletab-rust-replatform-design.md`
- `docs/superpowers/plans/2026-08-31-huddletab-rust-replatform.md`

两份文档描述目标架构和完整阶段计划；本交接文档描述截至 2026-09-01 的实际落地状态。发生冲突时，以当前源码、OpenAPI 和本交接文档中的“功能完成度”为准，不得把计划项当成已完成功能。
