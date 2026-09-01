# Phase 1E Task 4 报告：React/Vite Playwright 与临时 WSL Compose

## Status

PASS。React/Vite 独立 Playwright、单一 PowerShell 入口、完整浏览器矩阵和发布镜像检查均已由真实生产 Compose 运行验证。

## 文件与职责

- `frontend/playwright.config.ts`：独立于根目录旧 Next.js E2E 的 Playwright 配置；固定单 worker、零重试、HTML report、失败 trace/截图，以及 Chromium Desktop `1440x1000`、Mobile `390x844` 和 WebKit smoke 三个 project。
- `frontend/e2e/core.spec.ts`：Chromium Desktop/Mobile 共用的完整核心矩阵，使用真实 UI 与真实 API，不使用 mock。
- `frontend/e2e/smoke.spec.ts`：WebKit 登录、创建活动、打开流水与结算的最小 smoke。
- `frontend/e2e/support/product.ts`：登录、创建活动、横向溢出断言和 Chromium 成功态截图 helper；凭据只从环境读取，无默认值。
- `frontend/e2e/support/persistence-check.mjs`：app/PostgreSQL 重启后通过真实 CSRF、登录和活动列表 API 验证测试数据仍可读。
- `frontend/e2e/run-phase1e.ps1`：唯一入口；负责依赖和浏览器安装、WSL 临时目录、唯一 Compose project/空闲端口、生产 build/health、migration、stdin bootstrap、Playwright、发布检查、重启持久性、中文冷启动错误和 `finally` 清理。
- `frontend/package.json`、`frontend/package-lock.json`：固定 `@playwright/test@1.55.1` 并提供 `test:e2e` 脚本。
- `frontend/vite.config.ts`：保留 Vitest 默认排除项并额外排除 `e2e/**`，避免单测 runner 导入 Playwright spec。
- `.gitignore`：仅新增 `frontend/artifacts/`，使 HTML report、trace、截图留在 Windows 仓库路径但不进入提交。

## 验收矩阵映射

| 验收项 | 可执行映射 |
| --- | --- |
| Chromium Desktop `1440x1000` | `chromium-desktop` project 执行 `core.spec.ts` 全流程 |
| Chromium Mobile `390x844` | `chromium-mobile` project 执行同一 `core.spec.ts` 全流程 |
| 登录、活动、成员 | UI 登录；UI 创建活动；成员 Overlay 创建临时成员并断言列表更新 |
| 单币种均摊 | UI 快速记账创建 CNY 100.00 均摊账单 |
| 外币手工汇率 | UI 创建 USD 100.00、手工汇率 7 的账单，断言 CNY 汇总与外币展示 |
| 多付款、非均摊 | 两名成员分别付款 60/40，按金额分摊 30/70 |
| 部分结算到归零 | 从真实推荐转账先结算 CNY 100.00，断言剩余 160.00，再结算至“全部已结清” |
| Expense 双上下文冲突 | 两个独立 browser context 同时打开同一账单；首个保存成功，第二个得到 409，并断言失败端标题草稿仍保留 |
| Settlement 双上下文冲突 | 两个独立 browser context 同时修改同一结算；第二个失败后金额草稿仍为未保存值 |
| summary/CSV | 在已登录 browser context 中访问真实 `/summary` 与 `/export.csv`；手算断言成员数、总额 80000、CSV 类型及两笔标题 |
| 双主导航 | 主导航断言 3 个产品入口；活动导航精确断言只含“流水/结算” |
| 无横向溢出 | 活动列表、核心流水完成态、结算/API 完成态均断言 `scrollWidth <= clientWidth`，两套 Chromium viewport 都执行 |
| Chromium 成功态截图 | 两个 Chromium project 均生成并附加 `core-success.png`；截图前回到不展示临时账号标识的活动列表 |
| WebKit smoke | `webkit-smoke` 登录、创建活动、打开“全部流水”和“推荐转账”主视图 |
| fresh migration | 空 WSL 数据目录启动后查询 `_sqlx_migrations` 的成功记录数不少于 3 |
| SPA 深链 | 生产容器访问 `/activities/deep-link-release-check`，断言 200 和 React root |
| 非 root/无旧运行栈 | 容器 UID 精确为 10001；运行容器无 `node/npm/npx/next` 命令，`/app`、`/usr/local` 无 Node modules、Next、Drizzle、Better Auth 目录 |
| 数据库不可用中文错误 | 停止 app/postgres 后 `run --no-deps --rm app` 必须失败，且输出包含明确中文 PostgreSQL 连接上下文 |
| 重启持久性 | 分别重启 app、再重启 PostgreSQL+app；每次 health 后用真实认证 API 读取 Chromium 测试活动 |

## TDD / Characterization 证据

1. RED：在 runner 和生产服务尚不存在时先建立 config/spec/support，Playwright 成功枚举 3 个测试；真实执行 `chromium-desktop` 访问未启动地址时以 `net::ERR_UNSAFE_PORT` 失败，并产生截图和 trace，证明用例会捕获启动边界而非检查源码文本。
2. RED：首次完整入口依次暴露并实证 WSL Windows 路径转换、bind mount 非 root 写权限、bootstrap stdin 引用、可访问名称歧义、推荐结算预填和运行镜像 shell 检查问题；每个失败都由真实命令/浏览器/容器行为产生。
3. GREEN：逐项使用最小修改修复 runner 或测试操作，最终同一入口两次连续完成 `3 passed` 和全部发布检查。
4. 回归 RED/GREEN：`npm run test:unit` 首次显示 67 个既有测试通过，但 Vitest 误导入 2 个 Playwright suite；在保留 `configDefaults.exclude` 基础上增加 `e2e/**` 后变为 13 files / 67 tests 全绿。

## 单一入口与精确结果

命令（仓库 worktree 根目录）：

```powershell
& ./frontend/e2e/run-phase1e.ps1
```

最终结果：退出码 0；自动 `npm ci`（460 packages，audit 0 vulnerabilities）、自动安装/确认 Chromium 与 WebKit、生产镜像构建成功、app/postgres Healthy、fresh migration 与 stdin bootstrap 通过；Playwright `3 passed (11.2s)`；SPA 深链、UID/镜像边界通过；app 与 PostgreSQL 重启后的两次持久性检查通过；数据库不可用中文冷启动错误通过；`finally` 清理验证通过。

相关回归：

- `npm run test:unit`：13 files / 67 tests passed。
- `npm run typecheck`：退出码 0。
- `npm run build`：退出码 0，1655 modules transformed，`built in 2.85s`，生产 PWA 产物生成成功。

## 清理与报告留存证据

- 每次 runner 运行均使用唯一 `huddletab-phase1e-*` Compose project 和 `/tmp/huddletab-phase1e-*` 数据目录。
- WSL 临时路径在创建后通过 `readlink -f` 解析；`finally` 删除前再次解析并执行严格前缀正则校验。
- `compose down --remove-orphans` 必须退出 0；PostgreSQL 收紧所有权的数据只通过绑定到本次已校验目录的一次性 root 容器清空，随后删除父目录并用 `test ! -e` 验证不存在。
- 最终输出明确为：`清理验证通过：本次 Compose 已关闭，限定前缀临时目录已删除；Windows 测试报告已保留。`
- 运行后检查未发现 `/tmp/huddletab-phase1e-*` 或同前缀容器残留。
- HTML report 保留在 `frontend/artifacts/playwright-report/index.html`；两套 Chromium 成功截图保留在 `frontend/artifacts/test-results/`。最终 artifacts 无失败 trace，凭据模式扫描无命中。

## 凭据边界

- 临时账号、账号密码和 PostgreSQL 密码均在父 PowerShell 进程运行时随机生成，只存于该进程环境；源码没有默认凭据。
- WSL Compose 通过 `WSLENV` 继承环境，不把值拼入主机命令行。
- bootstrap 的一次性 shell 与临时值整体进入容器 stdin；密码继续通过 CLI `--password-stdin` 进入应用，CLI 成功回显被丢弃。
- bootstrap 失败诊断会在内存中替换三项临时值后再输出；Playwright 与持久性 checker 只从环境读取。
- 本报告、命令输出、最终 HTML report 和截图均不记录凭据值。

## 自审与 Concerns

- `git diff` 确认根 `playwright.config.ts` 与根 `tests/e2e` 无修改；新 E2E 全部位于 `frontend/`，唯一根级修改是 `.gitignore`。
- 未新增或重命名产品 API，未修改 React 组件中的 fetch 边界，未进入 Phase 2；未增加 hash、视觉 baseline、contract freeze 或 gate。
- `git diff --check` 通过；PowerShell AST 解析通过；关键临时目录权限、stdin 凭据和 root-owned PostgreSQL 清理逻辑有中文注释，用户可见错误为中文。
- 唯一非阻塞 concern：`npm ci` 会显示来自既有 `vite-plugin-pwa -> workbox-build -> glob@11.1.0` 的 deprecated 警告；`npm audit` 为 0 vulnerabilities，本任务未升级无关依赖链。
