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

## AI 配置与运行边界

- AI 默认关闭；启用后由服务端访问管理员配置的 OpenAI-compatible Chat Completions 地址，浏览器不会直连 Provider。
- Base URL 仅接受无凭据、无 query/fragment 的 HTTP(S) 地址；loopback 和 RFC1918 私网地址可用于本地模型。请求禁止重定向并禁用 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 环境代理，避免绕过服务端 DNS/IP 校验。
- 支持 DeepSeek 等支持 JSON Mode 的服务；不兼容 `response_format` 的本地兼容服务请关闭 JSON Mode。`imageModel` 留空时回退到文字 `model`。
- 图片识别只使用服务端安全预处理后的 JPG、PNG 或 WebP（单图最多 10 MiB、最多 4000 万像素，最长边 2048）；默认不保存为账单附件。图片和文字会发送到管理员配置的 Provider，部署者应根据该服务的隐私政策作出选择。
- API Key 只保存在服务端加密设置中，管理接口不会读取它；数据库与 `/data/app-secret` 必须一起备份。更换 app-secret 后，旧密钥需要重新配置。不要把真实 API Key 放进 issue、日志或截图。
- AI 限流是当前进程内、按登录用户共享文字/图片额度的固定窗口；单实例有效，服务重启后计数重置，本阶段不提供 Redis 分布式计数。
- 认证、活动权限和 Provider 配置通过后才消耗 AI 配额；全局 Semaphore 覆盖图片解码和 Provider 请求，等待或取消会释放 Permit。
- AI 失败、取消、离线或 Provider 不可用时只保留当前页面草稿，不创建 Expense、Settlement、Allocation，不推进 revision，也不会触发附件上传；用户可安全改用手动记账。系统不会自动重试 Provider 请求。
- 日志只保留 request ID、操作类型、成功/失败、稳定错误码和耗时；不记录 API Key、密文、nonce、app-secret、账单输入、图片、base64、Prompt、完整响应、文件名或私有 Base URL。
