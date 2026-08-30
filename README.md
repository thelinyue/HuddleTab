# HuddleTab

HuddleTab 是一个支持活动、成员、消费记录、结算、附件和离线访问的多人协作记账应用。

## Docker Compose 部署

这是正式版 `0.0.1` 的直接部署方式。无需克隆源码，无需创建 `.env` 文件：复制下面的完整内容，保存为 `compose.yaml`，然后执行启动命令。

> 默认数据库密码是 `huddletab`，仅适合本机或受控网络。开放公网前，请同时修改 `POSTGRES_PASSWORD` 和 `DATABASE_URL` 中的密码。

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: huddletab
      POSTGRES_USER: huddletab
      POSTGRES_PASSWORD: huddletab
    volumes:
      - ./huddletab-data/postgres:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
      interval: 5s
      timeout: 5s
      retries: 20

  app:
    image: ghcr.io/thelinyue/huddletab:0.0.1
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://huddletab:huddletab@postgres:5432/huddletab
      BETTER_AUTH_URL: http://localhost:5660
      APP_BASE_URL: http://localhost:5660
      DATA_DIR: /data
      TRUST_PROXY: "false"
      TZ: Asia/Shanghai
    ports:
      - "5660:5660"
    volumes:
      - ./huddletab-data:/data
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "fetch('http://127.0.0.1:5660/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))",
        ]
      interval: 10s
      timeout: 5s
      retries: 20
```

启动服务：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

打开 <http://localhost:5660>，按照首次初始化页面创建首位系统管理员。初始化失败或迁移失败时，查看日志：

```bash
docker compose logs -f app
```

首次未初始化启动时，初始化 Token 只会在本次 `app` 容器日志中输出一次。该日志包含敏感信息，只应提供给部署管理员。

应用数据保存在当前目录的 `huddletab-data` 中：

- `huddletab-data/postgres`：PostgreSQL 数据
- `huddletab-data/uploads`：上传附件
- `huddletab-data/backups`：备份归档

## 常用操作

停止服务但保留数据：

```bash
docker compose down
```

升级到新版本时，修改 Compose 文件中的镜像标签，例如 `0.0.2`，然后执行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

容器启动时会自动执行已提交的数据库迁移。升级前请先在管理页面创建完整备份，并阅读 [升级说明](docs/deployment/upgrade.md) 和 [备份恢复说明](docs/deployment/backup-restore.md)。

公网部署建议在 Compose 外配置 HTTPS 反向代理，详见 [HTTPS 与反向代理](docs/deployment/https.md)。

## 源码开发

源码开发和本地构建仍使用仓库中的 `compose.yaml`：

```bash
docker compose up -d --build
```
