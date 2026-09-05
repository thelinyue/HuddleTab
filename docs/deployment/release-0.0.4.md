# HuddleTab 0.0.4

## 发布内容

- 增加 `PUID`/`PGID` 环境变量，适配 NAS 宿主目录的数字 UID/GID。
- 容器入口只在权限初始化阶段使用 root，Rust 服务以配置后的非 root 身份运行。
- 自动迁移 `app-secret` 和 `uploads` 的属主；不修改 PostgreSQL 目录或 `/data` 中未知文件。
- 发布 GHCR 镜像 `ghcr.io/thelinyue/huddletab:0.0.4`，并更新 `latest`。

## 验收说明

自动化 Release Verification 覆盖 Rust、PostgreSQL、OpenAPI、Frontend、Docker、Compose、浏览器矩阵、默认与自定义 PUID/PGID、非 root capabilities、目录权限迁移和重启持久性。

本次只修改容器权限模型，不涉及 UI/PWA。真实 iPhone Safari/Home Screen PWA 验收未重复执行，属于已知发布例外；WebKit 模拟结果不代表真实 iPhone 验收通过。

## 升级提示

未设置 `PUID`/`PGID` 时继续使用 `10001:10001`；NAS 部署可将其设置为宿主用户的数字 UID/GID。使用 `ghcr.io/thelinyue/huddletab:0.0.4` 启动后，容器会执行已提交的数据库迁移。
