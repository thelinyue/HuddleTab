# HuddleTab

 HuddleTab 是一个面向活动、成员、消费记录和结算的多人协作记账应用，当前正式版为 `0.0.14`，运行栈为 React/Vite 与 Rust/Axum。

## 当前源码运行

正式镜像为 `ghcr.io/thelinyue/huddletab:0.0.14`，对应 Git tag `v0.0.14`。该版本使用 Rust/Axum 运行栈。

## Compose 直接部署

不需要创建 `.env` 文件。将下面的内容复制保存为 `compose.yaml`，并在该文件所在目录执行命令：

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
      - ./postgres:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \"$$POSTGRES_USER\" -d \"$$POSTGRES_DB\""]
      interval: 5s
      timeout: 5s
      retries: 20

  app:
    container_name: huddletab
    image: ghcr.io/thelinyue/huddletab:0.0.14
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://huddletab:huddletab@postgres:5432/huddletab
      APP_BASE_URL: http://localhost:5660
      ADMIN_USERNAME: ${ADMIN_USERNAME:-}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}
      DATA_DIR: /data
      PUID: "1000"
      PGID: "1000"
      TRUST_PROXY: "false"
      TZ: Asia/Shanghai
    ports:
      - "5660:5660"
    volumes:
      - ./data:/data
    healthcheck:
      test: ["CMD-SHELL", "exec gosu \"$$PUID:$$PGID\" curl --fail --silent http://127.0.0.1:5660/api/health"]
      interval: 10s
      timeout: 5s
      retries: 20
```

首次部署前请修改配置中的 `POSTGRES_PASSWORD`，并同步修改 `DATABASE_URL` 中的数据库密码。然后执行：

```bash
docker compose up -d
docker compose ps
docker compose logs -f app
```

部署数据保存在 Compose 文件所在目录的 `./postgres` 和 `./data` 中。应用容器名称为 `huddletab`，可使用该名称进行 Docker 管理。完成初始化后访问 <http://localhost:5660>。

Task 31 只提供管理员存储占用和系统信息读取；SMTP、邮件测试及应用级备份/还原不属于当前产品范围。宿主/NAS 数据保护责任见[数据保护与恢复](docs/deployment/data-protection.md)，活动软删除恢复仍是独立的业务功能。

系统信息中的应用与 PWA 版本共用 `APP_VERSION`，未设置时显示 `dev`；这不是正式版本号。

在当前 Rust 迁移源码 checkout 中使用仓库自带的 `compose.yaml` 构建候选运行镜像：

```bash
docker compose build app
docker compose up -d --wait
docker compose ps
```

默认数据库密码是 `huddletab`，仅适合本机或受控网络。开放公网前，必须修改 Compose 配置中的 `POSTGRES_PASSWORD`，并同步修改 `DATABASE_URL` 中的数据库密码。公开访问地址通过 `APP_BASE_URL` 设置；HTTPS 和可信代理边界见[HTTPS 与反向代理](docs/deployment/https.md)。

当前源码中的账号初始化与修改用户名功能尚未发布，请使用源码构建的镜像验证。

首次启动时，服务会在开放 HTTP 端口前创建管理员。可通过环境变量 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 指定账号密码；用户名留空默认使用 `admin`，密码留空则安全随机生成。昵称默认为“管理员”。

仅自动生成的密码会在首次创建成功后打印到应用日志；请登录后在“我的 → 账户与安全”修改用户名或密码。手动配置的密码不会打印。已有用户时跳过初始化，重启或改变环境变量不会覆盖网页修改后的凭据。当前没有网页初始化入口。

完成后打开 <http://localhost:5660>。初始化、迁移或数据库连接失败时查看中文日志：

```bash
docker compose logs -f app
```

自动化发布门禁流程见[最终 Release Verification](docs/deployment/release-verification.md)。本次 `0.0.14` 发布跳过真实 iPhone Safari/Home Screen 验收，属于已知发布例外。

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

本次安装起点仅支持全新安装，不支持从此前版本原地升级或导入旧数据。请使用新的 PostgreSQL 和应用数据目录，重新初始化管理员；不要将新镜像指向旧数据目录。同域名重新安装还需清理浏览器站点数据与旧 PWA 缓存，未同步草稿不会迁移。旧部署及备份应单独保留，恢复时使用匹配的旧版本。具体操作见 [全新安装与旧部署保留](docs/deployment/upgrade.md) 和 [数据保护与恢复](docs/deployment/data-protection.md)。

前端热更新要求 Rust API 已运行在 `127.0.0.1:5660`：

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```
