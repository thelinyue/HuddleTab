# CSV 与结算分享 Final Fix Report

日期：2026-09-01
基线：`cc91574`（`codex/rust-replatform`）

## 结果

最终审查提出的四类问题均已处理：

1. 摘要在进入领域 Ledger 前，对 `totalExpenseMinor`、付款事实合计和分摊事实合计做 checked 三方一致性校验；任一合计溢出或三方不一致均返回 `SharingError::Integrity`。
2. CSV 的 13 个固定表头单元格全部复用 `quote_csv`，保留 UTF-8 BOM 与 CRLF；历史浏览器报告中的表头和字节数同步更新。
3. 前端不再把总消费为零推断为“没有账单”：展示状态由 `empty` 改为 `zero`，文案为“结算金额为零 / 当前总消费为零，无需转账。”，布局与 warning 色保持不变。
4. PostgreSQL 集成覆盖 ACTIVE、ENDED、ARCHIVED 有效成员读取摘要/CSV，软删除活动禁止读取，并继续独立验证 LEFT 成员禁止读取；前端覆盖 ENDED/ARCHIVED 的结算分享入口和真实管理 Overlay 中的 CSV 入口。

公开 API DTO、OpenAPI 和 generated client 均未改变；未新增 migration、contract gate 或 baseline。

## 设计边界

摘要校验使用 application 层的 `SnapshotLedgerEntry`。仓储装载快照事实，application 完成 checked 三方校验后才转换成领域 `LedgerEntry`，因此没有扩大 `domain::ledger` 的接口，也没有复制或改变 Ledger 算法。

## RED 证据

### Rust 摘要完整性与 CSV 表头

```powershell
$env:CARGO_TARGET_DIR='<dedicated-target>'
cargo test --manifest-path server/Cargo.toml --test sharing_api
```

结果：退出码 `101`；`2 passed, 2 failed, 1 ignored`。

- `summary_rejects_balanced_facts_that_do_not_match_expense_total` 按预期失败：原实现接受总消费 1200、付款/分摊各 800 的矛盾快照。
- `csv_has_fixed_columns_crlf_bom_and_neutralizes_formulas` 按预期失败：原表头未逐字段引用。
- 溢出映射用例在 RED 阶段已通过，证明领域 Ledger 原有防线存在；修复仍在摘要三方校验处显式使用 checked sum。

### 前端零金额语义

```powershell
npm exec vitest run src/features/sharing/adapter.test.ts src/features/sharing/card.test.tsx src/features/sharing/page.test.tsx src/features/accounting/pages-ui.test.tsx src/features/activities/pages.test.tsx
```

结果：退出码 `1`；`3 failed, 36 passed`（5 files 中 3 failed、2 passed）。

- adapter 仍返回 `empty` 而不是 `zero`。
- card 和 page 均缺少新的零金额文案。
- ACTIVE/ENDED/ARCHIVED 分享与 CSV 入口覆盖直接通过，证明它们是现有正确行为的生命周期回归测试，而非生产行为改动。

## GREEN 与最终验证

### Focused Rust

```powershell
$env:CARGO_TARGET_DIR='<dedicated-target>'
cargo test --manifest-path server/Cargo.toml --test sharing_api
```

结果：退出码 `0`；`4 passed, 0 failed, 1 ignored`。

### Disposable PostgreSQL sharing integration

运行前确认：

- WSL Docker 中一次性 PostgreSQL 监听 `127.0.0.1:55432`。
- `git diff --quiet -- server/migrations` 返回 0，migration diff 为 NONE。
- 测试连接仅在进程内由一次性容器环境构造，未写入报告或 Git。
- 数据库未出现 migration checksum 错误，因此未清理 schema。

```powershell
cargo test --manifest-path server/Cargo.toml --test sharing_api summary_and_csv_use_one_private_authorized_snapshot -- --ignored --exact
```

结果：退出码 `0`；`1 passed, 0 failed, 4 filtered out`。该单一夹具覆盖 ACTIVE、ENDED、ARCHIVED、软删除和 LEFT 成员边界。

### Frontend affected suites

```powershell
npm exec vitest run src/features/sharing src/features/accounting src/features/activities src/app/router.test.tsx
```

结果：退出码 `0`；`10 passed files, 57 passed tests`。

### Full non-database regression suites

```powershell
cargo test --manifest-path server/Cargo.toml --all-targets --all-features
npm run test:unit -- --run
```

结果：

- Rust：退出码 `0`；`41 passed, 0 failed, 28 ignored`。
- Frontend：退出码 `0`；`13 passed files, 67 passed tests`。

### Static checks and production build

```powershell
cargo fmt --manifest-path server/Cargo.toml --check
cargo check --manifest-path server/Cargo.toml --all-targets --all-features
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
npm run typecheck
npm run build
```

结果：全部退出码 `0`。Vite production build 转换 `1655 modules`，PWA precache `10 entries`。

clippy 首轮曾因扩展后的单一 PostgreSQL 生命周期场景达到 120 行而触发 `too_many_lines`；该场景必须共享一次种子并顺序验证状态，按同文件既有模式添加局部 `#[allow(clippy::too_many_lines)]` 后复跑通过，未屏蔽生产代码告警。

### Contract and diff checks

- `contracts/openapi.json` 与 generated client 无差异，未运行无意义的合同再生成。
- `server/migrations` 无差异。
- `server/src/domain/ledger.rs` 无差异。
- `git diff --check`：见提交前最终命令，退出码 `0`。

## 修改范围

- Rust：`server/src/application/sharing.rs`、`server/src/infrastructure/sharing_repository.rs`、`server/tests/sharing_api.rs`。
- Frontend：sharing adapter/card/page tests and implementation、accounting/activity lifecycle entry tests、零金额状态 CSS。
- 报告：修正 `task-3-report.md` 中旧未引用表头及其 CSV 字节数，并新增本报告。

## 关注点

无已知未解决问题。数据库、认证和应用密钥值未输出、未写入报告、未提交。
