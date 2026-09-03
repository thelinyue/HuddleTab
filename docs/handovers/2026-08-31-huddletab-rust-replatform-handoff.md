# HuddleTab React/Vite + Rust/Axum 迁移交接

更新时间：2026-09-03

## 1. 当前结论

迁移分支已经具备 Phase 1 的核心业务闭环：认证、修改密码、活动资料与生命周期、30 天删除恢复、成员、邀请、记账、账本、推荐转账、结算、CSV 导出和受权结算摘要分享均可由 React/Vite 前端调用 Rust/Axum API 完成，同一 Rust 进程可托管 API 与 Vite 构建产物。Phase 1E 的安全、并发、真实浏览器和候选运行镜像结构验收已于 2026-09-01 通过；这只表示 Phase 1 exit gate 通过，可以进入 Phase 2，不表示完整迁移或正式发布已经完成。

Phase 2 Task 24 的 Activity Revision Snapshot/weak ETag、Task 25 的 IndexedDB 隔离、Task 26 的 Expense Create 前台同步队列，以及 Task 27 的加入审批、Guest Binding、图片附件、Rate Provider、站内通知与所有权转让已完成。Task 28 的离线工作台、REJECTED 修正、PWA 更新保护和完整浏览器验收已通过；Phase 3 Task 29 的系统管理员、用户管理、注册策略和管理员密码重置、Task 30 的 CLI 初始化引导/Sharing Summary/CSV、Task 31 的存储占用与系统信息也已完成，Phase 3 exit gate 已通过，可以进入最终 Release Verification。Task 31 明确不包含 SMTP、邮件测试或应用级备份/还原；宿主/NAS 数据保护文档和 Activity 30 天软删除恢复继续保留。当前仍不能描述为正式发布；真机 iPhone Safari/Home Screen PWA 人工验收、后台清理 Job、最终 Release Verification 和正式 `v0.0.3` tag/GHCR 镜像发布仍未完成。正式镜像版本预留为 `0.0.3`、对应 tag 为 `v0.0.3`，当前不得创建 tag、发布镜像或宣称远程镜像可用。

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

当前 React/Rust 迁移快照、Phase 1E 收口修复、Task 24–31 与本文档已形成 Git 检查点。Rate Provider 使用服务端 Frankfurter v2 和 PostgreSQL 缓存，Expense 保存精确来源快照；通知与事实在同一 PostgreSQL 事务提交；Service Worker 仍不执行业务写入。当前正在收口最终自动化 Release Verification；它只构建本地 `0.0.3` 候选，不创建 tag 或发布镜像。接手时仍应先确认现场；若之后存在未提交改动，不要运行 `git clean`、`git reset --hard`，也不要删除 worktree：

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
- UI 以远程 `v0.0.2` 源码和实际运行页面为唯一基准，不能使用旧版四标签活动页截图。任何 UI 功能开发或调整都必须先对照 `v0.0.2` 对应页面，再开始编码；新栈应保持其视觉风格、信息层级和交互习惯统一。
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

后续对接任何可见 UI 功能时，必须先完成以下对照，再进入开发：

1. 在本地 `v0.0.2` 对照环境打开相同或最接近的业务页面，并核对远程 tag 中的对应源码。
2. 记录并沿用页面结构、组件密度、字体与颜色、间距、按钮层级、编辑入口、反馈方式和 Desktop/Mobile 交互习惯。
3. 新功能在 `v0.0.2` 中不存在时，也应复用其现有视觉语言和相邻功能的交互模式，不另起一套界面风格。
4. 若新需求确实需要偏离 `v0.0.2`，编码前先明确说明差异及原因并取得确认。

该规则只约束新栈 UI 的设计与交互一致性，不要求兼容旧 Next.js API、运行时、数据库或路由。

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
| 多付款人、四种分摊、汇率快照 | 可用 | IDENTITY/MANUAL/PROVIDER/CACHE；历史账务不重新取率 |
| Ledger、成员余额、推荐转账 | 可用 | 全部由 Rust 权威计算 |
| Settlement 创建、修改、作废 | 可用 | 删除语义为 VOID，不物理删除 |
| PWA Shell | 可用 | 不缓存 API；Expense Create 使用前台同步队列，Service Worker 不执行业务写入；Task 28 已完成离线 Snapshot 工作台和更新闸门 |
| 加入审批 | 可用 | Task 27A；Activity 级 DIRECT_JOIN/REQUIRE_APPROVAL，Owner 查看并决定 Pending，申请人只能查看自己的结果 |
| 通知页 | 可用 | Task 27；审批、加入、参与账单变化、收款结算、生命周期和所有权通知 |
| “我的”页 | 部分可用 | 用户信息、修改密码和退出登录可用 |
| CSV、结算分享 | 可用 | 有效 ActivityMember 可下载 CSV，并从结算页生成受保护摘要和 1600px PNG |
| Activity Revision Snapshot / weak ETag | 可用 | Task 24；Task 25 已接入按用户隔离的完整 Snapshot 本地存储 |
| IndexedDB Snapshot / Queue stores | 可用 | schema v1 保存 Snapshot、Expense Create mutation 与 Pending Attachment Blob，不持久化 Query cache |
| 离线 Expense Create 同步 | 可用 | Task 26；前台串行、幂等重放、有限重试、REJECTED 和 pending 流水展示 |
| Guest Binding | 可用 | Task 27B；Owner 为 ACTIVE Guest 创建定向单次邀请，目标用户确认后原地绑定账号 |
| 图片附件 | 可用 | Task 27；JPEG/PNG/WebP，最多三张，私有 WebP、离线前台同步、缩略图/大图、ACTIVE 编辑即时删除 |
| 汇率 Provider | 可用 | Task 27；Frankfurter 日参考汇率、PostgreSQL 七天缓存降级、显式获取与 Expense 精确来源快照 |
| 活动所有权转让 | 可用 | Task 27；Owner 转给 ACTIVE 已绑定成员，旧 Owner 降为 MEMBER，事务原子更新 |
| 系统管理、注册策略、管理员重置密码 | 可用 | Phase 3 Task 29；用户删除和外围管理仍未实现 |
| CLI 初始化引导 | 可用 | Phase 3 Task 30；空库页面只显示 CLI 指引，不开放网页初始化写入 |

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

### 7.3 Phase 2 Task 25 IndexedDB 隔离

Task 25 新增 schema version 1 的 `huddletab:<user_id>` IndexedDB，每个用户使用独立数据库。当前只创建 `activity_snapshots` 与 `pending_mutations` 两个 object store；Queue 使用 `by-activity` 索引。项目尚未发布正式版本，因此没有迁移或兼容旧 Next.js IndexedDB 数据，也没有创建未进入本轮范围的 preference 或 attachment store。

`SnapshotRepository` 保存 Task 24 的 weak ETag、完整 `ActivitySnapshotData` 和 `fetchedAt`；200 条件刷新整体替换记录，304 保留原记录且不改写抓取时间。`MutationRepository` 只保存完整 Expense Create 输入与同步元数据，由 repository 注入当前 `userId`，支持按 ID 读取和按 Activity 确定排序；不生成 mutation ID、不转换状态，也不执行网络同步。所有操作使用短连接，`clearLocalData(userId)` 只显式删除指定用户数据库；logout 和全局 401 继续只清理内存认证状态并保留 pending queue。TanStack Query cache 没有持久化。

本轮实际执行：

```powershell
npm --prefix frontend run test:unit -- src/pwa/indexed-db/database.test.ts
npm --prefix frontend run test:unit -- src/features/activities/snapshot-api.test.ts src/pwa/indexed-db/snapshot-repository.test.ts
npm --prefix frontend run test:unit -- src/pwa/indexed-db
npm --prefix frontend run test:unit -- src/features/auth/api.test.tsx src/app/providers.test.tsx src/pwa/indexed-db
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

精确结果：IndexedDB 专项 3 个文件、10 passed；认证生命周期与 IndexedDB scoped 回归 5 个文件、17 passed；Frontend 全量 19 个文件、88 passed、0 failed。typecheck 与 production build 通过，Query cache 持久化源码/依赖检查 0 命中，`git diff --check` 通过。本轮没有服务端、OpenAPI、可见 UI 或运行镜像变化，因此未重复 Rust/PostgreSQL 与 Phase 1E Playwright/Compose 验收。

### 7.4 Phase 2 Task 26 Expense Create Queue

Task 26 将新增 Expense 的提交成功边界改为“完整输入已写入当前用户 IndexedDB”。记录主键直接使用既有 `clientMutationId`；登录后的受保护应用树、重新联网和新入队事件会触发前台同步。同步器跨 Activity 按 `createdAt`、`id` 串行执行，同一实例的并发 flush 合并；响应丢失后重放同一 payload，由 Rust 已有幂等合同返回同一 Expense。

网络错误、401、429 与 5xx 保留为 `RETRYABLE`；单次 flush 对同一记录最多尝试 3 次，退避为 1 秒、5 秒。其他业务 4xx 写为 `REJECTED`，完整原始输入和中文错误继续保留。每次发送前检查当前前台 Session 用户；旧用户在退避期间退出后立即停止，不能借用随后登录用户的 Session。成功记录写为 `SYNCED` 并刷新 Expense、Ledger、Recommendation、Settlement 和 Activity detail 权威查询。

流水页单独显示 `PENDING`、`SYNCING`、`RETRYABLE` 和 `REJECTED` 行；这些记录不是 `ExpenseAggregate`，不可打开详情，也不进入总消费、人均、外币统计、Ledger、余额或 Recommendation。Task 26 没有实现 REJECTED 修正交互、后台同步或完整断网浏览器矩阵，这些仍属于 Task 28。

本轮实际执行：

```powershell
npm --prefix frontend run test:unit -- src/pwa/indexed-db/mutation-repository.test.ts
npm --prefix frontend run test:unit -- src/features/accounting/expense-queue.test.ts
npm --prefix frontend run test:unit -- src/features/accounting/expense-queue-sync.test.tsx src/features/accounting/expense-queue.test.ts src/features/accounting/api.test.tsx
npm --prefix frontend run test:unit -- src/app/router.test.tsx src/app/providers.test.tsx src/features/auth/api.test.tsx src/features/accounting
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

精确结果：Task 26 最终 scoped 回归 8 个文件、27 passed；Frontend 全量 21 个文件、96 passed、0 failed；typecheck、production build 和 `git diff --check` 通过。另用 production build 和受控 API/IndexedDB 数据在 Chromium `1440 x 1000`、`390 x 844` 检查 pending 行：两种 viewport 均无横向溢出，长标题与金额不重叠，活动导航仍只有“流水 / 结算”，pending 金额不改变权威汇总。Task 26 没有服务端、PostgreSQL、OpenAPI 或运行镜像变化，因此没有重复 Rust/PostgreSQL/OpenAPI 和 Phase 1E Compose 矩阵；断网刷新、PWA 更新不丢 pending、REJECTED 修正和浏览器端到端矩阵保留给 Task 28。

### 7.5 Phase 2 Task 27A 加入审批与最小通知

Activity 新增 `inviteMode`，取值固定为 `DIRECT_JOIN` 或 `REQUIRE_APPROVAL`，默认直接加入。该字段由 Owner 通过现有 Activity version 乐观锁更新；成功变化只推进一次 version/revision 并写 Audit，同值更新没有副作用。邀请本身不复制模式，join 在事务内锁定并读取 Activity 当前值，因此同一活动的所有有效邀请始终遵循同一规则，Snapshot 也能通过 activity 数据和 ETag 感知变化。

`REQUIRE_APPROVAL` 下 join 创建 Pending JoinRequest，不创建成员也不消耗邀请次数。同一 Activity/User 由部分唯一索引保证至多一个 Pending；串行或并发重复提交返回同一个 request。Owner 才能读取活动待审批队列并 approve/reject，申请人只能读取自己的申请，其他成员和用户不能读取或决定。Approve 按 JoinRequest -> Activity -> Invitation 固定锁顺序重新校验生命周期、邀请和成员状态，原子创建/恢复成员、消耗一次邀请、关闭申请并写 Audit/revision/通知；Reject 不创建成员、不消耗邀请。相同决定可幂等 replay，相反决定返回 `409 JOIN_REQUEST_CLOSED`。

新增合同为 `GET /api/activities/{activity_id}/join-requests`、`POST /api/activities/{activity_id}/join-requests/{request_id}`、`GET /api/join-requests/{request_id}`、`GET /api/notifications` 与 `POST /api/notifications/{notification_id}/read`。通知当前只覆盖 Owner 收到申请和申请人收到结果两类；JoinRequest 与 Notification 不进入 Activity Snapshot、IndexedDB 或 TanStack 持久化。

前端 Activity 管理严格对照远程 `v0.0.2`：删除整个“字段权限”区域，不提供统一资料编辑表单；可编辑行点击后进入单字段编辑并显式保存，只提交该字段和 `version`，只读行没有按钮或 Chevron。“加入方式”使用同一单字段编辑模式。成员 Overlay 内仅 Owner 加载待审批队列；Pending join 保持在加入页展示等待状态；通知页展示并独立标记两类通知。Chromium `1440 x 1000` 与 `390 x 844` 已检查 Activity 管理和审批相关状态，两种 viewport 均无横向溢出，活动主导航仍只有“流水 / 结算”。

本轮最终执行：

```powershell
cargo test --manifest-path server/Cargo.toml --test domain_activity --test domain_join_request
cargo test --manifest-path server/Cargo.toml --test schema_constraints join_requests_enforce_mode_pending_uniqueness_and_activity_identity -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test activity_api --test collaboration_api --test notification_api --test snapshot_api -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test openapi
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

精确结果：Domain 7 passed；JoinRequest schema 约束专项 1 passed；PostgreSQL API 共 26 passed（Activity 10、Collaboration 11、Notification 2、Snapshot 3）；OpenAPI 6 passed；Frontend 24 个文件、110 passed。Rust fmt、严格 Clippy、Frontend typecheck、production build 和 `git diff --check` 均通过。相对 Task 27A 基准 `e1abe6e543d07f442de4009916cb1f1e446bcebd` 的范围扫描确认：没有组件直接 `fetch`、没有审批或通知 IndexedDB 持久化、没有 ADMIN、Guest Binding、Attachment、Rate Provider、tag 或发布实现；敏感词命中仅为 OpenAPI CSRF header 合同与测试固定值，没有真实凭据。

### 7.6 Phase 2 Task 27B Guest Binding

Guest Binding 复用 `activity_invites`，以 nullable `guest_member_id` 区分普通加入与绑定邀请，不增加第二套邀请表或重复的 purpose 存储。只有 Owner 能为 ACTIVE Activity 下仍为 ACTIVE、`user_id IS NULL` 的 Guest 创建定向、单次、七天有效邀请。目标用户必须显式确认；绑定时直接更新既有 ActivityMember 的 `user_id`，member ID、昵称和所有历史账务引用保持不变。绑定邀请读取 Activity 当前状态，但不受 `inviteMode` 影响，也不创建 JoinRequest。

确认事务锁定邀请、Activity、目标 Guest 和确认者已有成员记录后再次校验条件，再原子完成成员绑定、邀请消费、`MEMBER_GUEST_BOUND` Audit 和 revision 推进。首次成功返回 `BOUND`；同一用户重复确认返回 `ALREADY_BOUND`，不重复推进 revision 或 Audit；并发确认只有一次产生事实。确认者在该 Activity 已有 ACTIVE 或 LEFT membership 时返回 `409 GUEST_BINDING_CONFLICT`，不会合并或改写任一成员记录。

新增合同为 `POST /api/activities/{activity_id}/members/{member_id}/binding-invitations`，沿用 Session、CSRF 和敏感已认证限流。既有邀请创建/列表/预览响应增加 `purpose`，并按可见范围增加 `guestMemberId`、`guestDisplayName`；公共预览不暴露目标用户名。前端只经 generated client 和 feature adapter 调用：Owner 在 ACTIVE Guest 行使用“绑定账号”，失败时保留目标用户名，成功后一次性明文口令只保存在当前组件内存；邀请确认页使用“绑定临时成员身份”“确认绑定/注册并绑定”文案。

本轮最终执行：

```powershell
# TEST_DATABASE_URL 由 Debian WSL 的可丢弃 PostgreSQL 容器环境注入，未输出连接值
cargo test --manifest-path server/Cargo.toml --test migrations --test schema_constraints --test collaboration_api --test snapshot_api --test rate_limit_routes -- --ignored --test-threads=1
cargo test --manifest-path server/Cargo.toml --test openapi
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
git diff --exit-code -- contracts/openapi.json frontend/src/api/generated/openapi.ts
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

精确结果：受影响 PostgreSQL 共 28 passed（Collaboration 15、Migration 1、Rate limit 5、Schema constraints 3、Snapshot 4）；OpenAPI 7 passed；Frontend 24 个文件、123 passed。Rust fmt、严格 Clippy、Frontend typecheck、production build、OpenAPI/client 可重复生成和 `git diff --check` 均通过。

真实 Chromium 在 Desktop `1440 x 1000` 与 Mobile `390 x 844` 完成 Owner 登录、创建活动和 Guest、创建绑定邀请、目标用户注册确认、Snapshot 验证同一 member ID 获得 userId、Owner 刷新后显示正式成员的完整流程；两种 viewport 的活动导航均只有“流水 / 结算”且无横向溢出。成功态截图位于 `frontend/artifacts/task27b-desktop.png` 与 `frontend/artifacts/task27b-mobile.png`，成员姓名已脱敏，截图不含邀请 token、用户名或密码。临时数据库、服务、日志、凭据和浏览器脚本已清理。

相对 Task 27B 设计基准 `48d5e9d` 的范围审查确认：没有第二邀请表、`member_type`、成员 merge SQL、新通知类型、邀请 IndexedDB 持久化、Attachment、Provider、tag 或发布改动；组件没有直接 `fetch`，合同发布了 CSRF header，adapter 只精确失效邀请列表，绑定口令只存在前端组件内存。测试中的固定 token/CSRF 字符串不是真实凭据。

### 7.7 Phase 2 Task 27 Attachment

Attachment 只属于未删除 Expense。上传只接受 JPEG、PNG、WebP，单张原图最多 10 MiB、每笔最多三张；服务端校验声明 MIME、Magic Bytes、解码和 4000 万像素上限，应用 EXIF orientation、最长边 2048px，丢弃原元数据并统一编码为私有 WebP。存储键完全由服务端 UUID 构造，图片位于 `DATA_DIR/uploads`，PostgreSQL 只保存公开元数据和内部 `storage_key`；HTTP DTO、Snapshot、日志和 Audit 不暴露内部路径。

上传、下载和删除合同为同一嵌套路由下的 `POST`、`GET`、`DELETE`。上传使用 `clientAttachmentId` 幂等，Expense 行锁串行化三张上限；首次上传和删除各推进 revision 一次并写 Audit。ACTIVE 正式成员可上传和删除，历史成员可按现有可见性读取；错误资源组合使用私有 404。删除在 ACTIVE 编辑页确认后立即生效，不等待账单保存；文件删除失败由每 24 小时运行且不跟随 symlink 的孤立文件清理器最终收敛。

创建表单只允许选择上述图片类型，选择后显示固定缩略图，右上角 X 只移除本地待上传图片；点击缩略图在当前页面打开原图，关闭按钮、遮罩和 Escape 均可返回原表单且草稿不变。Expense 与全部 Blob 在同一个 IndexedDB 事务中入队，Expense 确认后再串行上传附件。两条仅读本地数据的 TanStack mutation/query 使用 `networkMode: "always"`，真实发送仍由前台同步器和 `navigator.onLine` 门控；不增加 Service Worker 写队列、对象存储、hash 或未发布 schema 的兼容分支。

本次 UI/运行时收口最终执行：

```powershell
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
& ./frontend/e2e/support/run-phase1e-safety.test.ps1
& ./frontend/e2e/run-phase1e.ps1 -AttachmentOnly
```

精确结果：Frontend `25 files / 149 tests`；typecheck 与 production build 通过；runner 安全专项通过。最终 Chromium Desktop `1440x1000` 与 Mobile `390x844` 为 `2/2`，覆盖缩略图、页面内大图、离线待同步、恢复联网、私有 WebP 响应头、即时删除和无横向溢出。Compose 还通过 fresh migration、stdin bootstrap、SPA 深链、非 root/运行镜像边界、app/PostgreSQL 重启后账单与剩余附件可读、中文冷启动数据库错误、artifact 脱敏和 finally 清理。

收口过程保留真实失败记录：首轮在环境创建前被遗留 Vite `4174` 进程锁住 Rolldown 原生文件；明确终止对应 PID 后，E2E 暴露离线本地 mutation/query 被 TanStack 默认在线模式暂停；修复后 trace 证明待同步行已经出现，剩余失败是 E2E 将组合状态文案误写成独立精确文本断言。最终改为定位目标 pending 行并断言包含状态，完整 runner 退出 `0`。每次失败均执行 artifact 脱敏和 finally 清理，最终复查没有本次 Compose project 或 `/tmp/huddletab-phase1e-*` 临时目录残留。

范围审查边界：没有 Rate Provider、新通知类型、对象存储、Service Worker 业务写入、IndexedDB v2、hash、旧版本兼容、tag 或发布改动。Task 27 Attachment 完成，可以继续 Task 27 Rate Provider 与其余通知事件。

### 7.8 Phase 2 Task 27 Rate Provider

新增授权后的 `GET /api/activities/{activity_id}/exchange-rate`。服务端固定访问 Frankfurter v2，三秒总超时；先读精确日期缓存，上游失败时仅回退请求日期之前七天内的最近缓存。所有 rate 先作为十进制字符串进入现有 `ExchangeRate` 校验，不经过浮点账务计算。未来日期、同币种和非法输入返回 `422 INVALID_EXCHANGE_RATE_QUERY`；上游与合格缓存均不可用时返回 `503 EXCHANGE_RATE_UNAVAILABLE` 和“暂时无法获取参考汇率，请手动输入。”

Expense 合同和数据库支持 `IDENTITY/MANUAL/PROVIDER/CACHE`，并保存可选的参考日期和固定 Provider。数据库约束四种合法组合；Create、Update、幂等 replay、Snapshot 和离线 Expense Queue 都保存同一快照，Ledger 不重新请求或重算历史汇率。外币表单继续保持 v0.0.2 的字段顺序、密度、手工输入和失败草稿，仅在汇率输入同层增加次级“获取参考汇率”按钮；自动值被编辑后立即转为 MANUAL。

本轮执行了 Provider/service/OpenAPI 非数据库测试 16 项；真实 PostgreSQL 的 fresh migration、exchange rate repository/API、schema、Snapshot 和 accounting 共 24 项；Frontend `25 files / 152 tests`。Rust `fmt --check`、严格 Clippy、Frontend typecheck、production build、OpenAPI/client 重生成一致和 `git diff --check` 均通过。Frankfurter 官方端点做了一次非阻断结构 smoke，返回 `date/base/quote/rate` 结构和十进制数值；确定性验收仍全部使用本地 fake Provider。

编码前已运行本地 `v0.0.2`，并审查远程 `v0.0.2` 源码；实际记账高级设置在 Desktop `1440x1000` 与 Mobile `390x844` 均为纵向单列表单、汇率直接编辑、来源相邻和单一主保存按钮。实现后 Chromium 两种 viewport `2/2` 通过显式获取、Provider 失败保留草稿、成功填入、创建后编辑、活动导航仅“流水 / 结算”和无横向溢出；HTTP 建议请求由 Playwright 路由固定响应，未依赖公网。临时 Rust/Vite 进程与凭据已清理，v0.0.2 对照环境仍按本交接第 8 节保留。

范围仍不包含其余通知事件、Task 28、IndexedDB v2、Provider 配置后台、tag、镜像发布或 Release Verification。Task 27 Rate Provider 完成，可以继续其余通知事件。

### 7.9 Phase 2 Task 27 Notification 与所有权转让

通知类型现为 `JOIN_APPROVAL_REQUESTED/RESOLVED`、`MEMBER_JOINED`、`PARTICIPATING_EXPENSE_CHANGED/DELETED`、`SETTLEMENT_RECEIVED`、`ACTIVITY_STATUS_CHANGED` 和 `OWNERSHIP_CHANGED`。直接加入只通知 Owner；审批通过不重复生产成员加入通知；Expense 更新/删除只通知修改前付款或分摊中的其他 ACTIVE 已绑定账号；Settlement 首次创建只通知非 Guest、非自己的收款账号；生命周期变化通知其他 ACTIVE 已绑定成员。失败、无变化、冲突、replay、Settlement 更新/VOID 均不产生额外通知。通知与事实、Audit、revision 在同一事务提交。

新增 `POST /api/activities/{activity_id}/ownership`，只允许 Owner 将 ACTIVE、已绑定账号的同活动普通成员设为新 Owner。旧 Owner 降为 `MEMBER`；活动 owner 指针、两个角色、version/revision、一次 `OWNER_TRANSFERRED` Audit 和新 Owner 通知原子更新，并发转让恰好一个成功。自身、Guest、LEFT 和跨活动目标均拒绝，不恢复 `ADMIN` 或复杂角色。

`GET /api/notifications` 最多返回 50 条，未读优先、组内时间倒序；`unreadCount` 是当前用户全部未读数，并返回部署 `timeZone`。时间字段固定输出 RFC 3339。前端对齐 `v0.0.2` 的“全部 / 未读 / 邀请 / 结算 / 系统”筛选、“未读 / 今天 / 昨天 / 更早”分组、图标、逐条/全部已读及加入审批内联操作；底部通知入口复用用户隔离 query 显示未读圆点。受控深链不会读取 payload URL。所有权转让使用既有活动管理 Sheet 子视图，失败保留选择，成功刷新 Activity detail、成员、列表、Snapshot 和通知。

编码前已启动 `http://127.0.0.1:5682` 的 `huddletab-v002-reference`，并审查远程 `v0.0.2` 的通知页、Activity More、服务与测试源码；实现沿用其页面密度、筛选、时间分组、图标、按钮层级和移动端习惯。Chromium Desktop `1440x1000` 与 Mobile `390x844` 真实 Compose 场景 `2/2` 通过，覆盖直接加入通知、未读角标、五类筛选、审批申请与内联通过、申请人结果、全部已读、所有权转让、活动导航仅“流水 / 结算”和无横向溢出。

最终验证：受影响 PostgreSQL 测试 55 passed（Accounting 14、Activity 13、Collaboration 15、Notification API 3、Notification schema 1、Rate limit 5、Snapshot 4）；OpenAPI 10 passed；Rust lib 6 passed；Frontend 26 个文件、159 passed。Rust fmt、严格 Clippy、typecheck、production build、OpenAPI/client 二次生成一致、runner 安全测试和 `git diff --check` 均通过。专项 runner 还通过 fresh migration、stdin bootstrap、SPA 深链、非 root/无 Node runtime、app/PostgreSQL 两轮重启持久性、中文冷启动错误、artifact 脱敏和 finally 清理，复查无本次 Compose project 或 `/tmp/huddletab-phase1e-*` 残留。

真实浏览器首轮发现 `OffsetDateTime::to_string()` 不是浏览器稳定解析的 RFC 3339，Mobile 通知页出现 `Invalid time value`；已补 API 回归并统一格式化。随后 UI `2/2` 通过。runner 后半段又暴露 Windows Node 24 在 fetch 后立即 `process.exit(0)` 的 libuv 断言；改为自然结束后完整命令退出 `0`。HTML 报告保留在 `frontend/artifacts/playwright-report/index.html`。

范围不包含 Task 28 之前的后续通知扩展、WebSocket、Web Push、批量已读 API、邀请 token 站内投递、Phase 3、tag、镜像发布或 Release Verification。Task 27 Notification 与所有权转让完成，可以进入 Task 28 Phase 2 E2E。

### 7.10 Phase 2 Task 28 离线工作台、REJECTED 修正与 PWA 更新保护

编码前已重新对照本地运行的 `v0.0.2` 和远程对应源码，沿用其当前标签页 Session、单一活动工作台、Sheet、表单密度、按钮层级和移动端交互；没有引入新的活动导航。在线打开 Activity 时，Snapshot 通过现有 weak ETag 条件读取并整体替换当前用户缓存；断网时只从 `huddletab:<user_id>` 的指定 Activity Snapshot 渲染 Activity、Member、Expense、Settlement、Ledger 和 Recommendation，并明确显示离线/缓存状态。Activity 列表、通知、邀请和管理数据没有扩展进 Snapshot。pending Expense 单独显示，不叠加到权威统计；断网仅保留 Expense Create 入队，更新/删除账单、Settlement、活动、成员、邀请、审批和所有权写入口均关闭，联网后由既有前台同步器恢复。

REJECTED 本地账单可在现有记账 Sheet 中完整回填字段和待传图片，沿用原 `clientMutationId`，在一个 IndexedDB readwrite 事务中原子替换 payload 与附件集合并重置为 `PENDING`；保留图片沿用 `clientAttachmentId`，新增图片生成新 ID，错误、服务端 ID、尝试次数和自动汇率失效元数据清空。仅仍为 REJECTED 的记录可修正；丢弃操作二次确认后在同一事务删除 mutation 与附件 Blob，不影响任何服务端 Expense。

PWA waiting worker 更新提示监听既有队列变化事件，当前用户 Mutation 或 Attachment 为 `PENDING`、`SYNCING`、`RETRYABLE` 或 `REJECTED` 时显示“有新版本可用，完成同步后更新”并禁用立即刷新；点击刷新前再次读取 IndexedDB，全部为空或 `SYNCED` 后才调用既有 Service Worker 激活入口。Service Worker 不执行业务写入。

Task 28 新增固定 `Phase2Only` runner 和 Chromium Phase 2 Desktop/Mobile 项目，复用 Phase 1E 的安全 Compose 编排并同时执行附件、通知/所有权关键流程与 WebKit smoke。实际命令：

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
& ./frontend/e2e/support/run-phase1e-safety.test.ps1
& ./frontend/e2e/run-phase1e.ps1 -Phase2Only
git diff --check
```

Frontend 全量为 29 个测试文件、174 个测试通过；PWA 更新组件、策略、Session、Snapshot、队列和 REJECTED 专项均通过，typecheck、production build、runner 安全专项和 `git diff --check` 通过。最终 `Phase2Only` 单一 Compose 入口以单 worker、零重试通过 7 个浏览器测试：Chromium Phase 2 Desktop/Mobile（`1440x1000`、`390x844`）、Attachment Desktop/Mobile、Notification/Ownership Desktop/Mobile 和 WebKit smoke。覆盖在线 Snapshot 200/304、Service Worker 控制、断网刷新读取与恢复联网单笔同步、服务端提交后响应丢失重放、422 REJECTED 修正、附件/审批/所有权、无横向溢出和活动导航仅“流水 / 结算”，以及 fresh migration、stdin bootstrap、SPA 深链、非 root/无 Node runtime、双容器重启持久性、中文冷启动错误、artifact 脱敏和 finally 清理。临时 Compose project 与 `/tmp/huddletab-phase1e-*` 均已删除，HTML 报告保留在 `frontend/artifacts/playwright-report/index.html`。

结论严格为：“Phase 2 Task 28 完成，可以进入 Phase 3。”Tasks 29–31、iPhone Safari/Home Screen PWA 真机人工验收、最终 Release Verification、后台清理 Job 和正式 `v0.0.3` Git tag/GHCR 镜像发布仍未完成；本轮没有创建 tag、推送 GHCR 或宣称达到发布状态。

### 7.11 Phase 3 Task 29 系统管理、用户管理与注册策略

编码前已启动本地 `v0.0.2` 对照环境 `http://127.0.0.1:5682`，并审查远程对应 tag 的“我的”、系统管理、用户管理和系统设置源码。新栈保留紧凑移动优先列表、按钮层级、Sheet/返回行为和注册表单密度；后续任何 UI 功能仍必须先完成同样的 `v0.0.2` 对照。

Task 29 新增 `users.disabled_at`、仅含 `SYSTEM_ADMIN` 的 `system_roles` 和单例 `system_settings`。首位用户由 `bootstrap-user` 在同一事务中创建并授予系统管理员；登录与 Session 实时拒绝禁用账号，禁用或撤销管理员角色会撤销全部 Session。禁用/撤权操作在 PostgreSQL 事务 advisory lock 内重新检查至少一个未禁用且拥有有效密码的系统管理员，最后管理员操作返回 `409 LAST_ACTIVE_ADMIN`。系统管理员只拥有平台管理权限，不获得任何 Activity 权限；本轮没有用户删除。

注册策略默认 `INVITE_ONLY`，支持 `OPEN`，以递增 `version` 做乐观锁。注册事务锁定读取策略并重新校验邀请；开放策略允许无邀请创建账号，带邀请仍进入原 join 流程；仅邀请策略缺失或无效口令返回 `403 REGISTRATION_INVITE_REQUIRED`。管理员密码重置直接设置 8–128 字符新密码，使用现有 Argon2id，原子撤销目标全部 Session；自重置同样清理当前认证状态并返回登录页，明文密码不进入 Debug 或日志。

新增管理合同：`GET /api/admin/users`、`PATCH /api/admin/users/{user_id}/status`、`PATCH /api/admin/users/{user_id}/system-admin`、`PUT /api/admin/users/{user_id}/password`、`GET/PUT /api/admin/registration-policy`。所有写接口要求 Session、CSRF、`SensitiveAuthenticated` 限流；Session DTO 增加 `isSystemAdmin` 仅用于前端入口隔离。前端新增系统管理首页、用户管理、注册策略页和密码重置 Overlay；离线时不读取或提交管理数据。

增加固定 `frontend/e2e/run-phase1e.ps1 -Task29Only`，仅运行 Chromium Desktop `1440x1000` 与 Mobile `390x844` 管理矩阵，禁止注入任意 Playwright 参数。专项覆盖管理员入口、普通用户越权回退、OPEN/INVITE_ONLY 注册、密码重置撤销旧 Session、最后管理员保护和无横向溢出。实际命令：

```powershell
cargo fmt --manifest-path server/Cargo.toml --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path server/Cargo.toml --all-targets --no-run
cargo test --manifest-path server/Cargo.toml --test openapi --test http_shell --test sensitive_input_debug
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
pwsh -NoProfile -File frontend/e2e/support/run-phase1e-safety.test.ps1
& ./frontend/e2e/run-phase1e.ps1 -Task29Only
git diff --check
```

Task 29 完成时的结论严格为：“Phase 3 Task 29 完成，可以进入 Task 30。”随后 Task 30 已在第 7.12 节完成记录；Task 31 已收口为存储与系统信息，SMTP、邮件测试和应用级备份/还原已取消。

Task 29 实际验证：Rust 非数据库全量 `cargo test --all-targets -- --test-threads=1` 通过 53 个测试，数据库相关 84 个用例保持 ignored；OpenAPI 11、HTTP shell 5、敏感输入 5 通过，系统管理 PostgreSQL 集成用例 3 个已编译但需 `TEST_DATABASE_URL` 才执行。Frontend 全量 30 个文件、178 个测试通过，typecheck、production build、fmt、严格 Clippy 和 `git diff --check` 通过。固定 Task29Only Compose/Playwright 在 Chromium Desktop `1440x1000` 与 Mobile `390x844` 为 `2/2` 通过，并完成 fresh migration、stdin bootstrap、SPA 深链、非 root/无 Node runtime、双容器重启管理用户持久性、中文冷启动错误、artifact 脱敏和限定清理；报告保留在 `frontend/artifacts/playwright-report/index.html`。

### 7.12 Phase 3 Task 30 初始化引导、Sharing Summary 与 CSV 收口

编码前已再次对照本地运行的 `v0.0.2` 初始化页、结算分享页和远程对应源码。新栈保留其独立页面、紧凑卡片、结算上下文入口和现有 PNG 导出；浏览器不接收管理员凭据，也没有恢复旧版网页初始化写接口。后续所有 UI 功能仍必须先完成 `v0.0.2` 对照后再编码，并保持其视觉风格、信息层级与交互习惯统一。

新增公开只读 `GET /api/setup/status`，严格以 `users` 是否为空作为 `setupRequired` 唯一依据，并返回 `Cache-Control: no-store`。React Router 外层 `SetupGuard` 保护登录、注册、邀请、活动和所有深链：空库统一进入 `/setup`，页面只展示并可复制 `docker compose exec app huddletab bootstrap-user --username your-username`；初始化状态读取失败停留在中文错误页并提供重试，已初始化直接访问 `/setup` 重定向 `/login`。CLI 结束后重新检查即可进入登录，初始化状态不写入 IndexedDB 或 Service Worker。

Sharing Summary 在同一 `REPEATABLE READ READ ONLY` 授权事务内扩展 `startDate`、`endDate`、`expenseCount`、`participatingMemberCount`、整数最小单位四舍五入的 `averageExpenseMinor`、稳定排序的 `originalCurrencyTotals` 与 `categoryTotals`；所有金额继续十进制字符串，响应为 `private, no-store`。前端结算分享页新增活动概览、复制摘要、系统分享及不支持时的复制回退；取消系统分享不报错，真实失败保留页面并显示中文错误，PNG 文件名仍为 `huddletab-settlement-summary.png`。CSV 路径和固定安全合同保持不变。

Task30Only runner 固定执行空库初始化引导与摘要/CSV 的 Chromium Desktop `1440x1000`、Mobile `390x844` 项目，不接受任意 Playwright 或 Compose 参数。实际验证命令：

```powershell
cargo fmt --manifest-path server/Cargo.toml --all -- --check
cargo test --manifest-path server/Cargo.toml --test openapi --test http_shell --test sharing_api -- --test-threads=1
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
npm --prefix frontend run test:unit -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
& ./frontend/e2e/support/run-phase1e-safety.test.ps1
& ./frontend/e2e/run-phase1e.ps1 -Task30Only
git diff --check
```

结果：Rust HTTP shell 6、OpenAPI 12、Sharing API 4 通过且 1 个 PostgreSQL 用例保持 ignored；前端 31 个文件、184 个测试通过；OpenAPI/client 连续生成无差异；格式、严格 Clippy、typecheck、production build 和 runner 安全测试通过。Task30Only 最终一次运行中 setup Chromium Desktop/Mobile `2/2`、摘要/复制/分享回退/PNG/CSV Chromium Desktop/Mobile `2/2`；fresh migration、stdin bootstrap、SPA 深链、非 root/无 Node runtime、app 与 PostgreSQL 重启持久性、中文冷启动错误、artifact 脱敏和 finally 清理均通过。报告保留在 `frontend/artifacts/playwright-report/index.html`，独立 Compose project 和 `/tmp/huddletab-phase1e-*` 已删除。

Task 30 完成结论严格为：“Phase 3 Task 30 完成，可以进入 Task 31。”Task 31、真机 iPhone Safari/Home Screen PWA 人工验收、最终 Release Verification、后台清理 Job 和正式 `v0.0.3` tag/GHCR 镜像发布仍未完成；本轮没有创建 tag、发布镜像或宣称达到发布状态。

### 7.13 Phase 3 Task 31 存储占用与系统信息

编码前再次对照了本地 `v0.0.2` 系统管理/系统信息页面及远程对应源码，沿用紧凑单列分组、图标、返回层级和移动端密度。Task 31 范围按收口决策缩减为两个管理员只读接口：`GET /api/admin/storage` 与 `GET /api/admin/system-information`。接口仅允许未禁用的 `SYSTEM_ADMIN`，返回 `Cache-Control: private, no-store`；普通用户即使拥有 Activity 权限也返回 403。

存储统计通过 `pg_database_size(current_database())` 读取数据库大小，并递归统计 `DATA_DIR/uploads` 下的普通文件，忽略符号链接，目录缺失按零处理。响应中的 `databaseBytes`、`uploadsBytes`、`totalBytes` 始终为十进制字符串，前端使用 `BigInt` 格式化。系统信息返回 `APP_VERSION`（本地默认 `dev`，同时作为 app/PWA 版本）、PostgreSQL 版本和数据目录。探针失败只记录不含连接串和宿主路径的中文固定日志，并返回统一 500 envelope。

前端系统管理首页新增“系统信息”入口；页面显示存储使用与运行信息分组，离线时显示“系统信息需要联网后使用”，不读取 IndexedDB 或陈旧管理缓存。活动主导航仍严格只有“流水 / 结算”。旧 Next.js SMTP 路由、测试邮件路由、SMTP 字段与 Nodemailer 依赖已删除；应用级备份/还原没有实现且不再列为产品能力，`docs/deployment/data-protection.md` 与 Activity 软删除恢复保持不变。

新增固定 `frontend/e2e/run-phase1e.ps1 -Task31Only`，只执行 Chromium Desktop `1440x1000` 与 Mobile `390x844` 的系统信息项目，不接受任意 Playwright 或 Compose 参数。专项浏览器覆盖管理员入口、存储/运行信息、普通用户 403、离线提示和无横向溢出；runner 继续执行 fresh migration、stdin bootstrap、非 root/无 Node runtime、重启持久性、中文冷启动错误、artifact 脱敏和 finally 限定清理。

实际验证命令：

```powershell
cargo fmt --manifest-path server/Cargo.toml --all -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path server/Cargo.toml --lib system_information -- --test-threads=1
cargo test --manifest-path server/Cargo.toml --test openapi --test http_shell -- --test-threads=1
npm --prefix frontend run test:unit -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm run typecheck
npm run build
pwsh -NoProfile -File frontend/e2e/support/run-phase1e-safety.test.ps1
& ./frontend/e2e/run-phase1e.ps1 -Task31Only
git diff --check
```

OpenAPI/client 生成命令已连续执行两次并确认无差异：

```powershell
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
```

实际结果：Rust `system_information` 单元 1 个通过；HTTP shell 6 个、OpenAPI 13 个通过，`cargo test --all-targets --no-run` 和严格 Clippy 通过。Frontend 全量 31 个文件、186 个测试通过，typecheck、production build 通过；根目录 legacy unit 122 个文件、498 个测试通过（1 个跳过），根目录 typecheck 和旧 Next 构建也通过。`Task31Only` Compose/Playwright 在 Chromium Desktop `1440x1000` 与 Mobile `390x844` 为 `2/2` 通过；普通用户访问管理接口得到 403，系统信息/存储响应的 `private, no-store`、离线提示、无横向溢出、fresh migration、stdin bootstrap、非 root/无 Node runtime、app 与 PostgreSQL 重启持久性、中文冷启动错误、artifact 脱敏和 finally 限定清理均通过。OpenAPI/client 连续生成无差异；旧 SMTP 路由、测试邮件、Schema 字段、Nodemailer 依赖和 stale 运行时测试已删除，旧生成的 `public/sw.js` 不再保留。报告保留在 `frontend/artifacts/playwright-report/index.html`。

完成结论严格为：“Phase 3 Task 31 完成，Phase 3 exit gate 通过，可以进入最终 Release Verification。”真机 iPhone Safari/Home Screen PWA、后台清理 Job、最终 Release Verification 和正式 `v0.0.3` 发布仍未完成；本轮没有创建 tag、发布镜像或宣称正式镜像可用。

### 7.14 最终 Release Verification 自动化收口（进行中）

最终验证固定使用 `APP_VERSION=0.0.3` 的本地候选镜像，不接受任意 Compose 文件、测试路径或版本参数；不创建 `v0.0.3` tag、不登录 GHCR、不推送镜像。Dockerfile/Compose 将版本注入运行时，统一返回应用与 PWA 版本；Rust HTTP 入口增加 CSP、`nosniff`、`X-Frame-Options`、`Referrer-Policy` 和 Permissions Policy，同时保留各业务接口已有的 `Cache-Control`。

新增单一入口：

```powershell
pwsh -NoProfile -File scripts/verify-release.ps1
```

入口要求干净 Git 工作区，依次运行 Rust fmt、严格 Clippy、非数据库测试、一次性 PostgreSQL 容器中的 84 个串行 ignored 测试、临时目录 OpenAPI/client 漂移检查、Frontend 单测/typecheck/build、目录安全测试和 `frontend/e2e/run-phase1e.ps1 -ReleaseVerification`。ReleaseVerification 浏览器矩阵固定包含 Setup Desktop/Mobile、Chromium 核心/Phase 2/附件/通知与所有权/Task 29/Task 30/Task 31 Desktop/Mobile，以及 WebKit smoke；完成 fresh migration 9 条、SPA 深链、JSON 404/405、安全头、PWA 控制、版本 0.0.3、非 root/无 Node runtime、双容器重启持久性、中文冷启动错误、artifact 脱敏和限定清理。

GHCR workflow 已收紧为仅语义版本 Git tag 触发，发布前执行 Rust/PostgreSQL/Frontend/合同检查，并从 tag 注入 `APP_VERSION`；正式发布时生成固定版本标签和 `latest`。本轮不会触发该 workflow。

最终自动化通过后仍需按 [最终 Release Verification](../deployment/release-verification.md) 完成真实 iPhone Safari/Home Screen PWA；在获得真机证据前，不得把 Release Verification 标记为完成。超过恢复窗口的 Activity 物理清理 Job 不阻塞 `0.0.3`，列为发布后的独立任务。

## 8. 当前本地运行现场

交接时没有启动 Rust API 或 Vite 开发服务器，不应直接宣称 `5660` 或 `5173` 可访问。以下 WSL PostgreSQL 测试现场仍在运行：

| 服务 | 地址/名称 |
| --- | --- |
| Rust API | 未启动 |
| Vite 前端 | 未启动 |
| `v0.0.2` UI 对照环境 | `http://127.0.0.1:5682`；Compose project `huddletab-v002-reference`，仅用于 UI 对照 |
| WSL PostgreSQL 容器 | `huddletab-postgres` |
| PostgreSQL 主机端口 | `127.0.0.1:5432` |

端口和容器名属于当前开发现场，不是产品固定配置。该 PostgreSQL 实例是会被集成测试清表的可丢弃数据库，不能存放开发或生产数据；标准 Compose 对外端口默认是 `5660`。浏览器验收账号只用于专用可丢弃数据库，临时密码未写入代码、文档或提交。

## 9. 启动方式

### 9.1 使用 WSL Compose

从 PowerShell 启动标准双服务环境：

```powershell
wsl.exe bash -lc 'cd /mnt/d/code/HuddleTab/.worktrees/rust-replatform && docker compose build app && sh ./scripts/prepare-data-dir.sh && docker compose up -d'
```

`prepare-data-dir.sh` 固定校验仓库 `compose.yaml`，只接受可选的 `--project-name`，并在一次性 root 容器启动前解析和校验真实 `DATA_HOST_DIR/app`；随后仅把 app 挂载点设置为 `10001:10001`、`0750`。app 服务仍以 UID/GID `10001:10001` 运行。新建挂载目录或迁移到新宿主时不可跳过；已有目录且属主未变化时无需重复执行。

首次空数据库需要在服务器终端交互式创建首位用户；浏览器空库只显示 CLI 指引，不收集凭据：

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
| `GET /api/activities/{id}/exchange-rate?from=JPY&date=YYYY-MM-DD` | ACTIVE 成员显式获取日参考汇率；Provider/七天缓存来源可追溯 |
| `POST /api/activities/{id}/ownership` | Owner 以 version 乐观锁转让所有权；接入敏感操作限流 |
| `GET /api/activities/{id}/export.csv` | UTF-8 BOM CSV；固定下载名 `activity-export.csv` |

通知合同为 `GET /api/notifications`、`POST /api/notifications/{notification_id}/read`；加入审批仍使用 `GET /api/activities/{id}/join-requests`、`POST /api/activities/{id}/join-requests/{request_id}` 与申请人自己的 `GET /api/join-requests/{request_id}`。

初始化状态合同为公开只读 `GET /api/setup/status`，返回 `{ data: { setupRequired } }` 并设置 `Cache-Control: no-store`；不提供浏览器初始化写接口。分享摘要新增日期、账单数、参与人数、人均金额、原币种汇总和分类汇总，响应设置 `Cache-Control: private, no-store`。

Task 31 管理合同为 `GET /api/admin/storage` 与 `GET /api/admin/system-information`，仅未禁用的 `SYSTEM_ADMIN` 可访问，响应设置 `Cache-Control: private, no-store`。字节字段以十进制字符串返回；系统版本使用 `APP_VERSION`，默认 `dev`。旧 SMTP/邮件 API、应用级备份/还原 API 均不存在。

## 11. 按改动范围验证

避免无目的地反复运行全套测试。建议按以下映射执行：

| 改动范围 | 最小有效验证 |
| --- | --- |
| 活动流水排序/渲染 | `npm --prefix frontend test -- --run src/features/accounting/pages.test.ts` |
| 活动两视图路由 | `npm --prefix frontend test -- --run src/app/router.test.tsx` |
| 成员与邀请前端 | `npm --prefix frontend test -- --run src/features/activities/api.test.ts src/features/activities/pages.test.tsx` |
| Activity/Accounting 生命周期 UI | `npm --prefix frontend test -- --run src/features/activities/api.test.ts src/features/activities/pages.test.tsx src/features/accounting/api.test.tsx src/features/accounting/pages-ui.test.tsx` |
| CSV/分享前端 | `npm --prefix frontend test -- --run src/features/sharing src/features/accounting/pages-ui.test.tsx src/features/activities/pages.test.tsx src/app/router.test.tsx` |
| 初始化守卫与 CLI 指引 | `npm --prefix frontend test -- --run src/features/setup src/app/router.test.tsx`；服务端运行 `cargo test --manifest-path server/Cargo.toml --test http_shell setup_status_is_read_only_and_has_a_json_route` |
| 一般前端类型改动 | `npm --prefix frontend run typecheck` |
| 前端构建/PWA 配置 | `npm --prefix frontend run build` |
| 账务 API | `cargo test --manifest-path server/Cargo.toml --test accounting_api` |
| 活动管理 API | `cargo test --manifest-path server/Cargo.toml --test activity_api` |
| 成员与邀请 API | `cargo test --manifest-path server/Cargo.toml --test collaboration_api` |
| 通知与所有权 | 设置可丢弃 `TEST_DATABASE_URL` 后运行 `cargo test --manifest-path server/Cargo.toml --test activity_api --test collaboration_api --test accounting_api --test notification_api --test notification_schema --test rate_limit_routes --test snapshot_api -- --ignored --test-threads=1`；前端运行通知、活动和底部导航专项 |
| CSV/分享 API | `cargo test --manifest-path server/Cargo.toml --test sharing_api`；数据库用例设置 `TEST_DATABASE_URL` 后运行 `cargo test --manifest-path server/Cargo.toml --test sharing_api summary_and_csv_use_one_private_authorized_snapshot -- --ignored --exact --test-threads=1` |
| Activity Revision Snapshot | 设置可丢弃 `TEST_DATABASE_URL` 后运行 `cargo test --manifest-path server/Cargo.toml --test snapshot_api -- --ignored --test-threads=1` |
| Rust 格式 | `cargo fmt --manifest-path server/Cargo.toml --check` |
| Rust 警告边界 | `cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings` |
| Dockerfile/Compose/runtime 改动 | 在 WSL 中重建镜像并做 health、非 root、无 Node runtime 验收 |

PostgreSQL integration tests 会清理测试表，只能指向可丢弃数据库。`frontend/package.json` 当前没有 `lint` 脚本；`test:e2e` 依赖由单一入口创建的临时环境变量与 Compose，必须通过 `& ./frontend/e2e/run-phase1e.ps1` 运行。

## 12. 下一步优先级

1. 在干净工作区执行 `pwsh -NoProfile -File scripts/verify-release.ps1`，完成 Rust/PostgreSQL/Frontend/Compose/Playwright 自动化门禁。
2. 按 `docs/deployment/release-verification.md` 在真实 iPhone Safari/Home Screen PWA 完成人工验收；在此之前不能创建 `v0.0.3` tag 或发布镜像。
3. `0.0.3` 发布后另立后台清理 Job 处理超过恢复窗口的 Activity 物理清理；当前只隐藏并禁止恢复，不会物理删除记录。

每完成一项，只运行对应测试；涉及 UI 或运行镜像时再运行对应真实浏览器核心流程。视觉修改至少检查 `1440 x 1000` 与 `390 x 844`，并确认活动主导航仍只有“流水 / 结算”。

## 13. 相关设计文档

- `docs/superpowers/specs/2026-08-31-huddletab-rust-replatform-design.md`
- `docs/superpowers/plans/2026-08-31-huddletab-rust-replatform.md`
- `docs/superpowers/specs/2026-09-01-huddletab-task25-indexeddb-design.md`
- `docs/superpowers/plans/2026-09-01-huddletab-task25-indexeddb.md`
- `docs/superpowers/specs/2026-09-01-huddletab-task26-expense-queue-design.md`
- `docs/superpowers/plans/2026-09-01-huddletab-task26-expense-queue.md`
- `docs/superpowers/specs/2026-09-01-huddletab-task27a-join-approval-design.md`
- `docs/superpowers/plans/2026-09-01-huddletab-task27a-join-approval.md`
- `docs/superpowers/specs/2026-09-02-huddletab-task27b-guest-binding-design.md`
- `docs/superpowers/plans/2026-09-02-huddletab-task27b-guest-binding.md`
- `docs/superpowers/specs/2026-09-02-huddletab-task27-attachment-design.md`
- `docs/superpowers/plans/2026-09-02-huddletab-task27-attachment.md`
- `docs/superpowers/specs/2026-09-02-huddletab-task27-rate-provider-design.md`
- `docs/superpowers/plans/2026-09-02-huddletab-task27-rate-provider.md`
- `docs/superpowers/specs/2026-09-03-huddletab-task27-notification-ownership-design.md`
- `docs/superpowers/plans/2026-09-03-huddletab-task27-notification-ownership.md`
- `docs/superpowers/specs/2026-09-03-huddletab-task28-phase2-e2e-design.md`
- `docs/superpowers/plans/2026-09-03-huddletab-task28-phase2-e2e.md`
- `docs/superpowers/specs/2026-09-03-huddletab-task29-admin-design.md`
- `docs/superpowers/plans/2026-09-03-huddletab-task29-admin.md`
- `docs/superpowers/specs/2026-09-03-huddletab-task30-setup-sharing-design.md`
- `docs/superpowers/plans/2026-09-03-huddletab-task30-setup-sharing.md`
- `docs/superpowers/specs/2026-09-03-huddletab-task31-system-information-design.md`
- `docs/superpowers/plans/2026-09-03-huddletab-task31-system-information.md`
- `docs/deployment/release-verification.md`

这些文档描述目标架构和完整阶段计划；本交接文档描述截至 2026-09-03 的实际落地状态。发生冲突时，以当前源码、OpenAPI 和本交接文档中的“功能完成度”为准，不得把计划项当成已完成功能。Task 31 已完成并通过 Phase 3 exit gate，但不代表最终 Release Verification、真机验收或正式发布完成。
