# 数据保护与恢复

HuddleTab 不提供应用级备份与恢复能力。NAS、Docker 宿主或其他基础设施应负责对部署目录和数据库进行定期快照、复制与恢复演练。

## 必须保护的数据

- `compose.yaml` 或实际使用的 Compose 文件
- `.env`、数据库密码、认证密钥等部署密钥
- PostgreSQL 数据目录 `./data/postgres` 或 Docker volume
- 应用数据目录 `./data/app`，包括 `./data/app/uploads` 附件和自动生成的 `./data/app/auth-secret`

Compose 将 `./data/app`（发布 Compose 为 `./huddletab-data/app`）挂载到容器 `/data`，不要只备份 `uploads` 子目录。PostgreSQL 数据由数据库服务使用独立的 `./data/postgres`（发布 Compose 为 `./huddletab-data/postgres`）目录或 volume 持久化。

## 恢复流程

1. 确认备份对应的应用版本，并使用该版本的镜像；停止 HuddleTab 应用和 PostgreSQL 容器，按照宿主备份工具的流程成套恢复 Compose 文件、密钥、PostgreSQL 数据目录和应用数据目录。本次全新安装不支持恢复此前版本的数据，旧备份只能用于独立的旧版本部署，不能覆盖新安装目录。
2. 检查 PostgreSQL 数据目录或 volume 的属主、权限和可读写状态，并确保恢复工具保留 `./data/app` 内已有文件的属主。
3. 如果应用挂载点是在新宿主创建的，设置与 NAS 宿主用户匹配的 `PUID`/`PGID`（未设置时默认 `10001:10001`）。容器首次启动会自动准备 `/data`、`app-secret` 和 `uploads`；不会修改 PostgreSQL 目录或 `/data` 中未知文件。

   ```bash
   docker compose pull
   docker compose up -d
   ```

4. 启动 Compose 并查看应用日志与健康检查：

   ```bash
   docker compose up -d
   docker compose ps
   docker compose logs -f app
   ```

5. 服务在监听前检查 SQLx 迁移记录；匹配版本的已初始化数据库不会重复建表。校验失败时应用不会继续启动，不要删除迁移记录强行启动，也不要改用新版本镜像尝试恢复旧备份。
6. 通过登录、活动列表、附件读取和关键业务流程确认恢复结果。

恢复前后的快照和归档由宿主备份体系管理；HuddleTab 不会上传、下载、列出或删除这些备份文件。
