# HuddleTab Task 31 实施记录

## 已完成

1. 新增 Rust 系统信息 application probe port 与 PostgreSQL/本地上传目录 adapter。
2. 新增管理员只读接口 `/api/admin/storage` 和 `/api/admin/system-information`，包含授权、`no-store` 响应头及 OpenAPI/TypeScript client。
3. 新增 React 系统信息管理页，沿用 `v0.0.2` 紧凑布局，使用 `BigInt` 显示十进制字节数并提供离线提示。
4. 删除旧 Next.js SMTP 路由、邮件测试路由、SMTP 配置字段和 Nodemailer 依赖；注册策略仍保留。应用级备份/还原未实现且不再列为产品待办。
5. 增加固定 `Task31Only` Playwright 项目和 Compose runner 模式。

## 验证命令

```powershell
cargo fmt --manifest-path server/Cargo.toml --all -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path server/Cargo.toml --test openapi --test http_shell --test system_information -- --test-threads=1
npm --prefix frontend run test:unit
npm --prefix frontend run typecheck
npm --prefix frontend run build
pwsh -NoProfile -File frontend/e2e/support/run-phase1e-safety.test.ps1
& ./frontend/e2e/run-phase1e.ps1 -Task31Only
git diff --check
```

OpenAPI/client 生成命令连续执行两次并比较无差异：

```powershell
cargo run --manifest-path server/Cargo.toml -- openapi --output contracts/openapi.json
npm --prefix frontend run api:generate
```

## 状态边界

完成结论严格为：“Phase 3 Task 31 完成，Phase 3 exit gate 通过，可以进入最终 Release Verification。”真机 iPhone Safari/Home Screen PWA、后台清理 Job、最终 Release Verification 和正式 `v0.0.3` 发布仍未完成。
