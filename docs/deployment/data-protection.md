# 数据保护与恢复

HuddleTab 不提供应用级备份与恢复能力。NAS、Docker 宿主或其他基础设施应负责对部署目录和数据库进行定期快照、复制与恢复演练。

## 必须保护的数据

- `compose.yaml` 或实际使用的 Compose 文件
- `.env`、数据库密码、认证密钥等部署密钥
- PostgreSQL 数据目录 `./data/postgres` 或 Docker volume
- 应用数据目录 `./data/app`，包括 `./data/app/uploads` 附件和自动生成的 `./data/app/auth-secret`

Compose 将 `./data/app`（发布 Compose 为 `./huddletab-data/app`）挂载到容器 `/data`，不要只备份 `uploads` 子目录。PostgreSQL 数据由数据库服务使用独立的 `./data/postgres`（发布 Compose 为 `./huddletab-data/postgres`）目录或 volume 持久化。

## 恢复流程

1. 停止 HuddleTab 应用和 PostgreSQL 容器，按照宿主备份工具的流程恢复 Compose 文件、密钥、PostgreSQL 数据目录和应用数据目录。
2. 检查 PostgreSQL 数据目录或 volume 的属主、权限和可读写状态，并确保恢复工具保留 `./data/app` 内已有文件的属主。
3. 如果应用挂载点是在新宿主创建的，先准备其根目录；此命令只调整 `/data` 本身，不会递归改写恢复的数据：

   ```bash
   docker compose pull
   docker compose run --rm --no-deps --user 0:0 --entrypoint sh app -c 'set -eu; chown 10001:10001 /data; chmod 0750 /data; test "$(stat -c "%u:%g:%a" /data)" = "10001:10001:750"'
   ```

4. 启动 Compose 并查看应用日志与健康检查：

   ```bash
   docker compose up -d
   docker compose ps
   docker compose logs -f app
   ```

5. 如果应用版本发生变化，容器入口会在服务监听前自动执行已提交的数据库 migration。migration 失败时应用不会继续启动。
6. 通过登录、活动列表、附件读取和关键业务流程确认恢复结果。

恢复前后的快照和归档由宿主备份体系管理；HuddleTab 不会上传、下载、列出或删除这些备份文件。
