# Phase 9 Admin 历史规划（已被 Rust 新栈方案取代）

> 本文件保留原计划编号，避免旧链接失效；其中 SMTP、邮件测试、应用级备份/还原、维护模式和备份管理均已取消，不得按本文实施。

## 当前有效边界

Phase 3 Task 29 已在 Rust/Axum 新栈完成平台管理员、用户状态、System Admin、注册策略和管理员密码重置。Task 31 只实现管理员存储占用与系统信息读取：

- `GET /api/admin/storage`
- `GET /api/admin/system-information`

两个接口仅允许未禁用的 `SYSTEM_ADMIN`，返回 `private, no-store`；上传目录统计只包含普通文件并忽略符号链接。当前版本由源码本地构建，正式 `0.0.3` 尚未发布。

## 不再实施的旧能力

- SMTP 配置、加密、测试邮件和邮件通知；旧 Next.js 路由、字段与 Nodemailer 依赖已清理。
- 应用级备份、备份列表/下载/删除、数据库恢复、定时备份和维护模式。

宿主/NAS 数据保护与升级前快照属于部署者责任，见 `docs/deployment/data-protection.md` 和 `docs/deployment/upgrade.md`。Activity 软删除及 30 天恢复是独立业务能力，继续保留。

## 参考记录

- Task 29：`docs/superpowers/plans/2026-09-03-huddletab-task29-admin.md`
- Task 31：`docs/superpowers/plans/2026-09-03-huddletab-task31-system-information.md`
- 当前交接：`docs/handovers/2026-08-31-huddletab-rust-replatform-handoff.md`
