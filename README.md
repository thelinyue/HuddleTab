# HuddleTab

HuddleTab 是一个支持活动、成员、消费记录、结算、附件和离线访问的多人协作记账应用。

## Docker Compose 部署

这是 HuddleTab 的直接部署方式。无需克隆源码，无需创建 `.env` 文件：复制下面的完整内容，保存为 `compose.yaml`，然后执行启动命令。

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
      - ./data/postgres:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", 'pg_isready -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
      interval: 5s
      timeout: 5s
      retries: 20

  app:
    image: ghcr.io/thelinyue/huddletab:0.0.2
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: "postgresql://huddletab:huddletab@postgres:5432/huddletab"
      BETTER_AUTH_URL: "http://localhost:5660"
      DATA_DIR: "/data"
    ports:
      - "5660:5660"
    volumes:
      - ./data/app:/data
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

首次部署或重新创建 `./data/app` 后，先拉取镜像并准备应用数据目录，再启动服务：

```bash
docker compose pull
docker compose run --rm --no-deps --user 0:0 --entrypoint sh app -c 'set -eu; chown 10001:10001 /data; chmod 0750 /data; test "$(stat -c "%u:%g:%a" /data)" = "10001:10001:750"'
docker compose up -d
docker compose ps
```

准备命令只在一次性容器中以 root 调整 `/data` 挂载点本身，不会递归改写已有文件；正式 `app` 服务仍以非 root UID/GID `10001:10001` 运行。bind mount 会隐藏镜像内 `/data` 的属主，新 Linux 主机若跳过这一步，应用将无法创建认证密钥。已有目录正常升级时无需重复准备；从备份恢复时应保留文件属主，并在挂载点属主变化后重新执行。

打开 <http://localhost:5660>，按照首次初始化页面创建首位系统管理员。初始化失败或迁移失败时，查看日志：

```bash
docker compose logs -f app
```

首次启动时请直接打开初始化页面创建系统管理员；初始化失败或迁移失败时，查看 `app` 容器日志。

应用数据保存在 Compose 文件所在目录的相对路径中：

- `./data/postgres`：PostgreSQL 数据
- `./data/app/uploads`：上传附件及其他应用持久化数据
- `./data/app/auth-secret`：自动生成的认证密钥

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

容器启动时会自动执行已提交的数据库迁移。升级前请先使用 NAS / Docker 宿主的备份机制保护 `data/postgres`、`data/app`、Compose 文件和 `.env`，并阅读 [升级说明](docs/deployment/upgrade.md) 与 [数据保护与恢复](docs/deployment/data-protection.md)。

公网部署建议在 Compose 外配置 HTTPS 反向代理，详见 [HTTPS 与反向代理](docs/deployment/https.md)。

## 源码开发

源码开发和本地构建仍使用仓库中的 `compose.yaml`：

```bash
docker compose build app
sh ./scripts/prepare-data-dir.sh
docker compose up -d
```
