# HuddleTab Task 27 Notification 与所有权转让实施记录

实现扩展了未发布的通知 migration、application/repository/HTTP DTO 与 OpenAPI 枚举，并在 Activity、Collaboration、Expense、Settlement 的既有事务中写入精确接收人通知。加入审批完成会同步关闭 Owner 的可操作通知；列表使用独立全局未读计数与 50 条读取上限。所有 payload 仅包含标题、金额、币种、状态、显示名或 requestId 等最小字符串字段。

所有权转让复用 Session、CSRF、Owner 授权、Activity version 乐观锁和 `SensitiveAuthenticated` 限流。repository 按稳定顺序锁定 Activity 和成员，原子更新两个角色、owner 指针、version/revision、Audit 与通知；未增加角色框架、幂等表或分布式锁。

前端 generated client 之上的 adapter 负责精确 cache invalidation。通知页对齐 `v0.0.2` 的筛选、分组、图标、全部已读和审批操作；底部导航复用用户隔离的通知 query 显示未读圆点。所有权编辑保持在活动管理 Sheet 内，成功整体刷新活动读模型，失败保留草稿。

确定性验收覆盖通知约束、隔离、排序、上限、事件矩阵、审批状态、生命周期与所有权并发；Chromium Desktop/Mobile 使用独立 Compose 环境走真实注册、直接加入、审批、全部已读和转让流程。首次浏览器运行发现通知时间不是 RFC 3339，已补 API 回归测试并修复；持久性脚本也改为等待 fetch 自然结束，避免 Windows Node 24 强制退出时的 libuv 断言。

完成结论只能是：“Task 27 Notification 与所有权转让完成，可以进入 Task 28 Phase 2 E2E。”
