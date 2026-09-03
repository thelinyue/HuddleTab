# HuddleTab Phase 3 Task 29：系统管理与注册策略设计

## 范围

本任务只覆盖平台系统管理员、用户启用/禁用、管理员角色、管理员直接重置密码和注册策略。用户删除、初始化 UI、SMTP、存储、备份恢复、系统信息及 Task 30–31 不在范围内。

编码前已对照本地 `v0.0.2` 运行环境及远程对应源码的“我的”、系统管理、用户管理和系统设置页面。Rust 新栈沿用紧凑列表、按钮层级、整页 Sheet/返回行为及移动端布局；任何后续 UI 功能也必须先完成同样的 `v0.0.2` 对照。

## 数据与权限

- `users.disabled_at` 实时阻止登录和 Session 读取；禁用事务同时撤销全部 Session。
- `system_roles` 目前只允许 `SYSTEM_ADMIN`。管理员权限是平台权限，不授予任何 Activity 数据权限。
- 禁用账号或撤销管理员角色前，在 PostgreSQL 事务 advisory lock 内确认仍至少有一个未禁用且拥有密码的系统管理员；否则返回 `409 LAST_ACTIVE_ADMIN`。
- `bootstrap-user` 在首位用户事务中同时写入 `SYSTEM_ADMIN`。首位用户仍只能由 CLI 创建。

## 注册策略

`system_settings` 为单例，默认 `INVITE_ONLY`，以递增 `version` 做乐观锁。注册事务先锁定读取策略，再在 `INVITE_ONLY` 下重新校验有效邀请；`OPEN` 允许缺少邀请口令，带口令的注册仍由后续 join 流程校验并消费邀请。缺少或无效邀请统一返回 `403 REGISTRATION_INVITE_REQUIRED`。

## HTTP 与前端

新增管理合同：

- `GET /api/admin/users`
- `PATCH /api/admin/users/{user_id}/status`
- `PATCH /api/admin/users/{user_id}/system-admin`
- `PUT /api/admin/users/{user_id}/password`
- `GET/PUT /api/admin/registration-policy`

所有接口独立验证 Session 和 `SYSTEM_ADMIN`；写操作还要求 CSRF，并使用现有 `SensitiveAuthenticated` 限流桶。Session DTO 增加 `isSystemAdmin` 仅控制入口显示，服务端授权不依赖前端。

前端“我的”页仅管理员显示系统管理入口，管理页在离线时不读取也不提交写操作。密码重置使用既有 Overlay，输入失败保留草稿；自重置成功后撤销当前 Session 并清理认证状态。注册页改为通用“创建账号”，邀请口令可选。

## 非目标

不创建删除用户 API、不增加管理员层级、不进入 IndexedDB、不兼容旧 Next.js 数据或 `0.0.2` 数据库，不创建 `v0.0.3` tag 或发布正式镜像。
