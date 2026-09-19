# AI 智能录入测试

自然语言和小票图片智能录入使用确定性的 Playwright route interception，不连接真实 AI Provider，也不需要 API Key。

在 `frontend/` 目录执行：

```powershell
npm run test:e2e:ai-expense
```

该入口会构建生产前端，并在 Chromium Desktop 与 390×844 移动视口运行 `e2e/ai-expense-entry.spec.ts`。测试不会保存用户输入、Prompt、模型响应或凭据；失败 artifact 仅用于本地诊断。

需要可丢弃 PostgreSQL 时，集成测试必须串行执行，避免共享数据库夹具互相干扰：

```powershell
cargo test --manifest-path server/Cargo.toml --all -- --include-ignored --test-threads=1
```

如果 Windows PATH 没有 PostgreSQL 工具，阶段一至阶段三使用的是 Debian
WSL 中的临时 PostgreSQL 容器；仍应通过 `TEST_DATABASE_URL` 指向一次性测试库，
不要连接生产数据库。完整的连接与清理说明见 `server/tests/README.md`。
