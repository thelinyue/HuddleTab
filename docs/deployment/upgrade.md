# 升级

HuddleTab 升级只执行已提交的 SQL Migration。禁止用 `drizzle-kit push` 修改生产数据库。

## 标准流程

1. 使用 NAS / Docker 宿主的备份机制保护 `data/postgres`、`data/app`、Compose 文件、`.env` 和部署密钥。
2. 记录当前应用镜像 ID，保留它作为回退目标。
3. 拉取或构建新版本。按 NAS 宿主用户设置 `PUID`/`PGID`；未设置时保持默认 `10001:10001`。容器入口会在启动阶段修正 `/data`、`app-secret` 和 `uploads` 的属主，不会递归改写未知文件或 PostgreSQL 目录。
4. 启动 Compose。容器入口先完成权限初始化，再以非 root 身份启动服务并自动执行已提交的 SQL migration；迁移失败时应用不会继续启动。
5. 检查 `docker compose ps` 与应用健康检查。
6. 使用具备测试活动和附件权限的会话运行 Smoke。
7. 确认业务访问正常后，再清理旧镜像。

PowerShell 部署者可运行：

```powershell
npm run verify:upgrade
```

脚本会要求显式提供管理员测试会话 Cookie，记录旧镜像、构建并启动新版本，再执行 Smoke。它会输出旧镜像的回退命令，但不会自动回退或删除任何数据。

运行前需要设置以下环境变量：`VERIFY_SESSION_COOKIE`，以及 Smoke 要读取的既有测试记录 `SMOKE_ACTIVITY_ID`、`SMOKE_EXPENSE_ID` 和 `SMOKE_ATTACHMENT_ID`。脚本会将前者复用给 Smoke，并将 `BaseUrl` 传递给 Smoke；不会输出任何 Cookie。

## 回退

迁移失败时，应用容器不会启动。停止新容器后，可用升级脚本打印的旧镜像重新启动应用：

```powershell
docker compose up -d --no-deps app
```

如果迁移已成功执行，是否可以安全回退取决于该版本的 Migration 兼容性。不要在没有宿主恢复演练的情况下覆盖 `./data/postgres` 或 `./data/app`。默认 Compose 将 PostgreSQL 数据保存在 `./data/postgres`，将上传文件和自动生成的认证密钥保存在 `./data/app`；核心 Compose 不使用 Docker 命名卷。
