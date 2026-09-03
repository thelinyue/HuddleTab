# HuddleTab 最终 Release Verification 设计记录

## 边界

最终验证只收口 Rust/Axum 新栈的自动化发布门禁和 `0.0.3` 本地候选镜像。它不创建 Git tag、不推送 GHCR、不替代真实 iPhone Safari/Home Screen PWA 验收。后台 Activity 物理清理 Job 在正式发布后另立任务，不作为本轮发布阻塞项。

## 候选运行时

Dockerfile 的 `APP_VERSION` 由 build arg 注入 runtime，Compose 默认使用 `dev`；固定最终入口使用 `0.0.3`。应用与 PWA 版本由同一服务端环境变量返回。HTTP 总入口增加 CSP、`nosniff`、`X-Frame-Options`、`Referrer-Policy` 和最小 Permissions Policy，不覆盖业务 handler 已设置的 Cache-Control。

## 固定验收链

`scripts/verify-release.ps1` 要求干净工作区，使用一次性 PostgreSQL 容器执行串行数据库测试，把 OpenAPI/client 生成写到临时目录，并调用固定 `ReleaseVerification` 浏览器矩阵。所有临时容器、目录和 Compose project 都通过前缀或项目名校验后清理；Playwright 报告保留且经过脱敏。

正式 GHCR workflow 只由语义版本 Git tag 触发，发布前执行 Rust、PostgreSQL、Frontend 和合同漂移检查，tag 版本同时写入镜像 `APP_VERSION`。正式发布产生版本标签和 `latest`；本轮不触发 workflow。
