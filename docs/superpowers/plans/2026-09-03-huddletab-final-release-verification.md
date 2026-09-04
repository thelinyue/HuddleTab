# HuddleTab 最终 Release Verification 实施记录

1. 为 Dockerfile/Compose 增加 `APP_VERSION` 候选注入。
2. 在 Axum 全局响应层增加固定安全响应头，并用 HTTP shell 覆盖入口响应。
3. 增加固定 `scripts/verify-release.ps1`，串行执行 Rust、PostgreSQL、合同、Frontend、目录安全和完整浏览器门禁。
4. 扩展 `run-phase1e.ps1` 的 ReleaseVerification 模式，固定 Setup、Phase 1/2、Task 27、Task 29–31 和 WebKit 项目。
5. 将 GHCR workflow 改为 tag-only，发布前先验证，注入 tag 版本并发布版本标签与 `latest`。
6. 增加 iPhone Safari/Home Screen PWA 人工验收清单和交接记录。

自动化命令和实际结果在完成运行后补入交接文档；在真机证据完成前，结论不得写成正式发布完成。
