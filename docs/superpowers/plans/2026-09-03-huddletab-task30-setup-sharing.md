# HuddleTab Phase 3 Task 30 实施记录

> 历史记录说明：本文件早期以 CLI 初始化为前提；2026-09-04 已由网页初始化修正取代。当前以 `POST /api/setup`、`/setup` 四字段表单和交接文档为准，旧 CLI/stdin 描述不再是操作指引。

## 目标

在不改变产品导航和不进入 Task 31 的前提下，完成网页初始化、Sharing Summary 扩展、CSV 安全合同与固定浏览器验收入口。

## 实际变更

- Rust 提供 `GET /api/setup/status` 与同源 `POST /api/setup`，以 `users` 空表作为唯一初始化依据，并设置 `no-store`；前端 `SetupGuard` 保护所有产品深链，`/setup` 显示四字段网页表单并在成功后自动登录。
- Sharing Snapshot/DTO 增加活动日期、账单数、参与人数、人均最小单位金额、原币种汇总和分类汇总；统计与成员余额、推荐转账共用单次可重复读授权事务。
- Sharing Summary 响应设置 `private, no-store`；前端保持 `v0.0.2` 的结算分享密度，新增概览、复制、系统分享回退和原有 PNG 导出。
- CSV 继续使用固定文件名、BOM/CRLF/双引号和公式注入中和；不增加私有字段。
- `run-phase1e.ps1 -Task30Only` 固定运行 setup 与 summary/CSV Chromium Desktop/Mobile 项目，禁止和其他专项模式组合；重启持久性检查只确认 Task30 活动仍可读。
- 交接文档补充“所有 UI 功能先对照 `v0.0.2`”的硬约束与 Task30 实际证据。

## 验证命令与结果

```powershell
cargo fmt --manifest-path server/Cargo.toml --all -- --check
cargo test --manifest-path server/Cargo.toml --test openapi --test http_shell --test sharing_api -- --test-threads=1
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
npm --prefix frontend run test:unit -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
& ./frontend/e2e/support/run-phase1e-safety.test.ps1
& ./frontend/e2e/run-phase1e.ps1 -Task30Only
git diff --check
```

定向 Rust 测试通过：HTTP shell 6、OpenAPI 12、Sharing API 4 通过且 1 个 PostgreSQL 用例保持 ignored；严格 Clippy 和格式检查通过。前端全量为 31 个文件、184 个测试通过，typecheck 与 production build 通过。OpenAPI/client 连续生成哈希一致。

历史 Task30Only 结果中的 stdin bootstrap 已作废。网页初始化修正后的专项结果以交接文档 7.15 记录为准，必须重新验证 Setup Desktop/Mobile 的真实表单提交、自动登录、凭据脱敏和限定清理。

## 状态

历史状态“Phase 3 Task 30 完成”仍适用于 Sharing Summary/CSV；初始化入口已进入修正验收，不得据此宣称最终 Release Verification 或正式发布。Task 31、真机 iPhone Safari/Home Screen PWA、后台清理 Job 和正式 `v0.0.3` 发布仍未完成；本任务没有创建 tag、发布镜像或宣称正式发布状态。
