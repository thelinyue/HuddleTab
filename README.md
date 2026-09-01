# HuddleTab

HuddleTab 是一个面向活动、成员、消费记录和结算的多人协作记账应用。当前分支正在把运行栈迁移到 React/Vite 与 Rust/Axum；Phase 2 的离线队列、审批、通知、附件和汇率 Provider，以及 Phase 3 的系统管理能力尚未完成。

## 当前源码运行

Rust 新栈的正式镜像版本预留为 `0.0.3`，对应未来的 Git tag `v0.0.3`。该版本必须等 Phase 2、Phase 3 和最终 Release Verification 全部完成后才能发布；当前不存在可供正式部署的 `0.0.3` 镜像。`ghcr.io/thelinyue/huddletab:0.0.2` 是旧 Node/Next.js 运行栈，不能用于验证当前 Rust 源码。

在当前 Rust 迁移源码 checkout 中使用仓库自带的 `compose.yaml` 构建候选运行镜像：

```bash
docker compose build app
sh ./scripts/prepare-data-dir.sh
docker compose up -d --wait
docker compose ps
```

默认数据库密码是 `huddletab`，仅适合本机或受控网络。开放公网前，必须通过 `.env` 修改 `POSTGRES_PASSWORD`；仓库 Compose 会使用同一个变量构造 `DATABASE_URL`。公开访问地址通过 `APP_BASE_URL` 设置；HTTPS 和可信代理边界见[HTTPS 与反向代理](docs/deployment/https.md)。

首次空数据库只允许通过 CLI 创建用户。命令会在终端中读取密码，不要把密码写入命令行、脚本或日志：

```bash
docker compose exec app huddletab bootstrap-user --username your-username
```

完成后打开 <http://localhost:5660>。初始化、迁移或数据库连接失败时查看中文日志：

```bash
docker compose logs -f app
```

`prepare-data-dir.sh` 只接受仓库固定 Compose 文件，可选参数仅为 `--project-name`。它会先解析和校验真实的 `DATA_HOST_DIR/app`，再由一次性 root 容器把挂载点本身设置为 `10001:10001`、`0750`；不会递归改写已有文件。实际 `app` 服务仍以 UID/GID `10001:10001` 运行。

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
