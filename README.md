# HuddleTab

HuddleTab 是一个面向活动、成员、消费记录和结算的多人协作记账应用，当前正式版为 `0.0.4`，运行栈为 React/Vite 与 Rust/Axum。

## 当前源码运行

正式镜像为 `ghcr.io/thelinyue/huddletab:0.0.4`，对应 Git tag `v0.0.4`。该版本使用 Rust/Axum 运行栈。

Task 31 只提供管理员存储占用和系统信息读取；SMTP、邮件测试及应用级备份/还原不属于当前产品范围。宿主/NAS 数据保护责任见[数据保护与恢复](docs/deployment/data-protection.md)，活动软删除恢复仍是独立的业务功能。

系统信息中的应用与 PWA 版本共用 `APP_VERSION`，未设置时显示 `dev`；这不是正式版本号。

在当前 Rust 迁移源码 checkout 中使用仓库自带的 `compose.yaml` 构建候选运行镜像：

```bash
docker compose build app
docker compose up -d --wait
docker compose ps
```

默认数据库密码是 `huddletab`，仅适合本机或受控网络。开放公网前，必须通过 `.env` 修改 `POSTGRES_PASSWORD`；仓库 Compose 会使用同一个变量构造 `DATABASE_URL`。公开访问地址通过 `APP_BASE_URL` 设置；HTTPS 和可信代理边界见[HTTPS 与反向代理](docs/deployment/https.md)。

首次空数据库打开网页会进入独立的管理员初始化页，按“管理员昵称、用户名、密码、确认密码”的顺序填写并点击“完成初始化”。成功后页面会自动登录并进入活动列表；失败时表单草稿会保留。初始化请求使用同源 CSRF/Origin 校验、认证限流和数据库事务锁，首个成功提交者成为系统管理员。

由于当前没有 Setup Token 或其他无界面初始化入口，首次初始化完成前必须限制实例的网络访问，不要把未初始化的地址暴露给不可信网络；部署者应在受控网络内立即完成初始化。已初始化的实例访问 `/setup` 会回到登录页。

完成后打开 <http://localhost:5660>。初始化、迁移或数据库连接失败时查看中文日志：

```bash
docker compose logs -f app
```

自动化发布门禁流程见[最终 Release Verification](docs/deployment/release-verification.md)。本次 `0.0.4` 发布跳过真实 iPhone Safari/Home Screen 验收，属于已知发布例外；本次只修改容器权限模型，不涉及 UI/PWA。

容器支持可选的 `PUID`/`PGID` 环境变量，默认值为 `10001`。将它们设置为 NAS 宿主用户的数字 UID/GID 后，入口会短暂以 root 修正 `/data`、`app-secret` 和 `uploads` 的属主，然后立即以该非 root 身份运行 Rust 服务；不会处理 PostgreSQL 目录，也不会递归改写 `/data` 中未知文件。切换 UID/GID 时，旧 app-secret 和附件会自动迁移属主。`PUID`/`PGID` 不能设置为 `0`，也不要在 Compose 中额外设置 `user:`。

例如 NAS 用户 UID/GID 为 `1000:1000` 时，在 `.env` 中设置：

```dotenv
PUID=1000
PGID=1000
```

应用数据保存在 Compose 文件所在目录的相对路径中：

- `./data/postgres`：PostgreSQL 数据
- `./data/app/app-secret`：自动生成的认证密钥

## 常用操作

停止服务但保留数据：

```bash
docker compose down
```

当前迁移阶段更新源码后重新构建并启动：

```bash
docker compose build app
docker compose up -d
docker compose ps
```

容器启动时会自动执行已提交的数据库迁移。升级前请先使用 NAS / Docker 宿主的备份机制保护 `data/postgres`、`data/app`、Compose 文件和 `.env`，并阅读 [升级说明](docs/deployment/upgrade.md) 与 [数据保护与恢复](docs/deployment/data-protection.md)。

前端热更新要求 Rust API 已运行在 `127.0.0.1:5660`：

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```
