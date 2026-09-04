# HuddleTab Phase 3 Task 29 实施记录

> 当前初始化已由 2026-09-04 修正为网页 `/setup` 与 `POST /api/setup`；下文历史结果中出现的 CLI/stdin bootstrap 仅作追溯，不能作为当前操作指引或验收依据。

## 已完成

1. 新增 `disabled_at`、`system_roles`、`system_settings` migration；首位用户与 `SYSTEM_ADMIN` 在同一事务创建（当前由网页初始化调用）。
2. 登录/Session 实时排除禁用账号；禁用账号和管理员撤权撤销全部 Session；事务 advisory lock 保护最后管理员不变量。
3. 新增六个系统管理 HTTP 合同、OpenAPI schema 和 TypeScript client；管理写操作接入现有敏感操作限流。
4. 注册事务读取单例策略并重新校验邀请；支持 `OPEN` 无邀请注册及 `INVITE_ONLY` 的 `REGISTRATION_INVITE_REQUIRED`。
5. 前端新增系统管理首页、用户管理、注册策略页和管理员密码重置 Overlay；“我的”页按 `isSystemAdmin` 隔离入口，离线禁用管理操作。
6. 新增固定 `Task29Only` Playwright 项目和 Compose runner 模式；保留 Chromium Desktop `1440x1000`、Mobile `390x844` 的 UI 对照与无横向溢出检查。

## 验证命令

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

实际结果：Rust 非数据库全量 `cargo test --all-targets -- --test-threads=1` 通过 53 个测试，数据库相关 84 个用例保持 ignored；OpenAPI 11、HTTP shell 5、敏感输入 5、系统管理集成用例 3 个均可编译，其中数据库集成需要 `TEST_DATABASE_URL` 才执行。Frontend 全量 30 个文件、178 个测试通过，typecheck、production build、fmt、严格 Clippy 和 `git diff --check` 通过。Task29Only runner 的 Chromium Desktop `1440x1000` 与 Mobile `390x844` 为 `2/2` 通过，并通过 fresh migration、stdin bootstrap、SPA 深链、非 root/无 Node runtime、双容器重启后的管理用户持久性、中文冷启动错误、artifact 脱敏和限定清理。E2E 报告保留在 `frontend/artifacts/playwright-report/index.html`，临时 Compose project 与 `/tmp/huddletab-phase1e-*` 数据在 `finally` 清理。

## 状态边界

完成结论严格为：“Phase 3 Task 29 完成，可以进入 Task 30。”Task 30 已完成；Task 31 已收口为存储与系统信息，SMTP 和应用级备份/还原已移出产品范围。iPhone Safari/Home Screen PWA 人工验收、最终 Release Verification 和正式 `v0.0.3` 发布仍未完成。
