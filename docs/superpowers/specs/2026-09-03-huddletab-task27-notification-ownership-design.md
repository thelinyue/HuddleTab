# HuddleTab Task 27 Notification 与所有权转让设计

本切片完成站内通知事件，并补齐通知依赖的活动所有权转让。通知仍只保存在 PostgreSQL，不进入 Snapshot、IndexedDB 或 Service Worker；邀请明文 token 继续由创建者外部发送，因此不生产 `ACTIVITY_INVITATION`。

通知类型固定为 `JOIN_APPROVAL_REQUESTED/RESOLVED`、`MEMBER_JOINED`、`PARTICIPATING_EXPENSE_CHANGED/DELETED`、`SETTLEMENT_RECEIVED`、`ACTIVITY_STATUS_CHANGED` 和 `OWNERSHIP_CHANGED`。Expense 只通知修改前付款/分摊中的其他已绑定 ACTIVE 用户；Settlement 只在首次创建时通知非 Guest、非自己的收款账号；生命周期变化通知其他 ACTIVE 已绑定成员。通知、事实、Audit 和 revision 在同一 PostgreSQL 事务提交，失败、冲突、无变化和幂等 replay 不产生额外通知。

`POST /api/activities/{activity_id}/ownership` 只允许当前 Owner 调用。目标必须是同活动 ACTIVE、已绑定账号的普通成员；旧 Owner 降为 `MEMBER`，新 Owner 升为 `OWNER`。活动指针、version、revision、一次 `OWNER_TRANSFERRED` Audit 和新 Owner 的通知原子提交，并发请求由现有 version 乐观锁保证恰好一个成功。

通知列表最多返回 50 条，未读优先且组内按时间倒序；`unreadCount` 是当前用户的全局未读总数，`timeZone` 由部署配置提供。前端只根据受控 kind/target 构造深链，并提供“全部 / 未读 / 邀请 / 结算 / 系统”筛选、“未读 / 今天 / 昨天 / 更早”分组、逐条/全部已读与加入审批内联操作。活动管理在既有 Sheet 子视图中转让所有权，失败保留选择和 Overlay。

UI 编码前后均对照本地运行与远程源码 `v0.0.2` 的通知页和活动管理页，沿用其页面密度、筛选、时间分组、图标、按钮层级和移动端行为。新栈不恢复 `ADMIN`、旧 API 或旧数据库兼容；活动主导航继续只有“流水 / 结算”。

本切片不包含 Task 28、Phase 3、WebSocket、Web Push、批量已读 API、复杂角色、tag 或镜像发布。
