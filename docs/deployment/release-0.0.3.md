# HuddleTab 0.0.3

## 发布内容

- React/Vite 前端与 Rust/Axum 服务端正式合并。
- 完成活动、成员、记账、结算、附件、离线队列、通知、管理员和分享能力。
- 发布 GHCR 镜像 `ghcr.io/thelinyue/huddletab:0.0.3`，并更新 `latest`。

## 验收说明

自动化 Release Verification 在合并后的发布提交上执行，覆盖 Rust、PostgreSQL、OpenAPI、Frontend、Docker、Compose、浏览器矩阵、非 root 运行和数据持久化。

真实 iPhone Safari/Home Screen PWA 验收按发布决定跳过，属于已知发布例外；WebKit 模拟结果不代表真实 iPhone 验收通过。

## 升级提示

升级前请备份 PostgreSQL 数据、`DATA_HOST_DIR` 和部署配置。使用 `ghcr.io/thelinyue/huddletab:0.0.3` 启动后，容器会执行已提交的数据库迁移。
