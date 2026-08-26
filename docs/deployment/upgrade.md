# 升级

HuddleTab 升级只执行已提交的 SQL Migration。禁止用 `drizzle-kit push` 修改生产数据库。

## 标准流程

1. 在当前版本的管理页面创建完整备份，并保存归档校验值。
2. 记录当前应用镜像 ID，保留它作为回退目标。
3. 拉取或构建新版本，并启动 Compose。容器入口会先执行 `npm run db:migrate`；迁移失败时应用不会继续启动。
4. 检查 `docker compose ps` 与应用健康检查。
5. 使用具备测试活动和附件权限的会话运行 `npm run smoke`。
6. 确认业务访问正常后，再清理旧镜像。

PowerShell 部署者可运行：

```powershell
npm run verify:upgrade
```

脚本会要求显式提供管理员测试会话 Cookie，先请求备份、记录旧镜像、构建并启动新版本，再执行 Smoke。它会输出旧镜像的回退命令，但不会自动回退或删除任何数据。

运行前需要设置以下环境变量：`VERIFY_SESSION_COOKIE`，以及 Smoke 要读取的既有测试记录 `SMOKE_ACTIVITY_ID`、`SMOKE_EXPENSE_ID` 和 `SMOKE_ATTACHMENT_ID`。脚本会将前者复用给 Smoke，并将 `BaseUrl` 传递给 Smoke；不会输出任何 Cookie。

## 回退

迁移失败时，应用容器不会启动。停止新容器后，可用升级脚本打印的旧镜像重新启动应用：

```powershell
docker compose up -d --no-deps app
```

如果迁移已成功执行，是否可以安全回退取决于该版本的 Migration 兼容性。不要在没有验证过恢复演练的情况下覆盖 `./data`。PostgreSQL 数据、上传文件、备份和自动生成的认证密钥都位于默认 `./data`；核心 Compose 不使用 Docker 命名卷。
