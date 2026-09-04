# HuddleTab Task 27A 加入审批与最小通知设计

## 1. 目标与范围

Task 27A 实现 Activity 级加入审批、Pending JoinRequest、Owner 审批，以及申请人与 Owner 的最小通知闭环。它是 Phase 2 Task 27 的第一个独立切片，不代表 Task 27 或 Phase 2 完成。

本切片包含：

- Activity `inviteMode` 配置；
- 有效邀请在 `REQUIRE_APPROVAL` 下创建 Pending JoinRequest；
- Owner 查看、通过或拒绝 Pending 申请；
- 申请人读取自己的申请状态；
- `JOIN_APPROVAL_REQUESTED` 与 `JOIN_APPROVAL_RESOLVED` 两类站内通知；
- Activity、Snapshot、OpenAPI、TypeScript client 和现有 React UI 的必要接入。

本切片不包含 ADMIN、多审批人、权限配置、单邀请审批模式、申请撤回、审批评论、批量审批、Guest Binding、其他通知事件、Attachment、Rate Provider、Task 28 E2E 或正式发布。

## 2. Activity 加入模式

Activity 新增 `inviteMode`：

- `DIRECT_JOIN`：有效邀请按现有流程直接创建或恢复 ActivityMember；
- `REQUIRE_APPROVAL`：有效邀请只创建 Pending JoinRequest，不立即产生成员身份。

新 Activity 默认使用 `DIRECT_JOIN`，保持当前 Rust 新栈的直接加入行为。

只有当前 Activity Owner 可以在活动管理 Overlay 修改该字段。修改使用现有 Activity `version` 乐观锁；首次有效变化推进 version 与 revision 各一次并写 Audit，无变化请求不推进。`inviteMode` 进入 Activity read model 和 Activity Snapshot，因此 Task 24 的 weak ETag 会随修改变化。

邀请本身不复制 `inviteMode`。join 事务每次锁定并读取 Activity 当前模式，确保同一 Activity 只有一套实时加入规则。链接邀请与定向邀请都遵循该模式。

从 `REQUIRE_APPROVAL` 切回 `DIRECT_JOIN` 不会自动通过、拒绝或删除已有 Pending。已有申请继续由 Owner 明确 approve 或 reject；后续新的有效邀请 join 则直接加入。若申请人在 Pending 期间通过其他路径成为成员，原申请不能再 approve，但仍可 reject 关闭。

## 3. JoinRequest 模型

JoinRequest 保存：

- `id`；
- `activity_id`；
- `invitation_id`；
- `applicant_user_id`；
- `status`: `PENDING | APPROVED | REJECTED`；
- `decided_by_member_id`、`decided_at`；
- `created_at`。

数据库使用部分唯一索引保证同一 `(activity_id, applicant_user_id)` 最多一个 `PENDING`。并发重复提交在唯一约束冲突后读取并返回已有 Pending，不创建第二条记录，也不重复 Audit、revision 或通知。

Pending 不预占或消耗邀请次数。只有 approve 成功创建成员时，才在同一事务中锁定 Invitation 并增加 `use_count`。reject、重复提交和失效申请都不消耗次数。

JoinRequest 不进入 Activity Snapshot。它有独立授权查询边界，避免离线 Activity 工作台缓存审批或通知数据。

## 4. 加入流程

`POST /api/invitations/{token}/join` 保留现有入口并扩展结果：

- `DIRECT_JOIN` 返回现有 `JOINED` 或 `ALREADY_MEMBER`；
- `REQUIRE_APPROVAL` 首次提交返回 `PENDING_APPROVAL`、`activityId`、`requestId`；
- 已经是成员时仍返回 `ALREADY_MEMBER`；
- 已有 Pending 时幂等返回相同 `requestId`。

在最终写入前，事务必须重新校验 Session 用户、定向邀请用户名、Activity 生命周期、Invitation 撤销时间、过期时间与使用次数。`ENDED`、`ARCHIVED`、已删除 Activity 不允许创建新申请。明文邀请 token 继续只存在于请求内存，不进入 JoinRequest、通知、日志或 Debug。

首次创建 Pending 的同一事务写入：

1. JoinRequest；
2. 发给当前 Owner 的 `JOIN_APPROVAL_REQUESTED` 通知；
3. `JOIN_REQUEST_CREATED` Audit；
4. Activity revision 加一。

任一步失败时全部回滚。

## 5. 审批与失效语义

只有当前 Activity Owner 可以读取待审批队列和提交决定。普通成员不能读取其他申请，申请人只能读取自己的记录。

approve 事务按固定顺序锁定 JoinRequest、Activity、Invitation，并重新校验：

- JoinRequest 仍为 Pending；
- Activity 当前允许加入；
- Invitation 属于该 Activity，未撤销、未过期、未耗尽；
- 定向邀请仍与申请人用户名匹配；
- 申请人尚未拥有该 Activity 的有效成员身份。

首次 approve 原子创建或恢复 ActivityMember、消耗一次邀请、将申请置为 `APPROVED`、写结果通知、Audit 并推进 revision 一次。并发相同 approve 只返回已有 APPROVED 结果，不重复成员或副作用；已由相反决定关闭时返回 `409 JOIN_REQUEST_CLOSED`。

reject 只要求申请仍为 Pending、操作者仍为 Owner。它不创建成员、不消耗邀请次数，将申请置为 `REJECTED`，写结果通知、Audit 并推进 revision 一次。Activity 已结束或归档时仍允许 Owner 关闭 Pending；已删除 Activity 不提供审批 UI。重复相同 reject 返回已有结果，相反决定返回 `409 JOIN_REQUEST_CLOSED`。

approve 遇到活动或邀请失效时返回明确 `409`，Pending 保持不变，Owner 可以随后 reject。业务失败不推进 revision，不写 Audit 或通知。

## 6. HTTP 合同

本切片新增或扩展以下合同：

- `PUT /api/activities/{activity_id}`：请求与响应增加 `inviteMode`；
- `POST /api/invitations/{token}/join`：增加 `PENDING_APPROVAL` 结果；
- `GET /api/activities/{activity_id}/join-requests`：Owner 读取 Pending 列表；
- `POST /api/activities/{activity_id}/join-requests/{request_id}`：Owner 提交 `APPROVE | REJECT`；
- `GET /api/join-requests/{request_id}`：申请人读取自己的状态；
- `GET /api/notifications`：当前用户的通知列表与未读数；
- `POST /api/notifications/{notification_id}/read`：幂等标记已读。

所有已认证写请求继续使用现有 Session 与 CSRF 边界。审批决定不是现有限流清单中的敏感操作，本切片不扩展 limiter。错误沿用 JSON envelope，并为无权限、记录不存在、申请已关闭、活动不可加入、邀请失效和存储不可用提供稳定 code 与中文消息。

通知 payload 只保存渲染所需的非敏感定位字段。URL 只能由受控 `target_type`、`target_id` 与 `activity_id` 构造，不能从 payload 拼接。通知已读状态不参与审批事实判断。

## 7. UI 设计

Activity 管理 Overlay 增加“加入方式”选项，由 Owner 在“直接加入”和“需要审批”之间切换。它复用现有 Activity 编辑提交和 version conflict 处理。

成员 Overlay 增加 Owner 专用“加入申请”入口，展示 Pending 申请并提供逐条通过、拒绝。处理成功后刷新成员、申请队列、Activity detail 与 Snapshot；冲突或失效时保留当前列表并显示服务端中文错误。

通知页替换占位内容，只实现本切片需要的两种通知：

- Owner 收到加入申请，链接到对应 Activity 的成员审批面板；
- 申请人收到审批结果，通过后可进入 Activity，拒绝时显示明确结果。

Join 页面在创建或复用 Pending 后显示等待审批状态。通过 `requestId` 读取申请人自己的状态；重复提交保持同一申请。通知读取或已读失败不能改变审批状态。

UI 延续现有两项 Activity 主导航“流水 / 结算”，审批入口不新增活动标签。桌面 `1440 x 1000` 与移动端 `390 x 844` 均不得横向溢出。

## 8. 模块边界

- `domain`：定义 InviteMode、JoinRequestStatus 和允许的决定转换，不接触 SQL 或 HTTP DTO；
- `application`：编排 join、Owner 审批、申请人状态与通知用例，定义 Repository 端口和稳定错误；
- `infrastructure`：在 PostgreSQL 事务中实现锁顺序、唯一约束幂等、Audit、revision 与通知事实；
- `http`：Axum 路由、Session/CSRF、DTO、错误映射和 OpenAPI；
- `frontend`：generated client -> feature adapter -> TanStack Query -> Activity/Member/Notification 页面。

审批与通知可以共享一次 Repository 事务，但通知读取保持独立模块。不得让 HTTP handler 拼 SQL，也不得把通知当作 Pending 队列的权威来源。

## 9. 测试策略

严格使用 TDD，先看到以下行为测试因缺少实现而失败：

- InviteMode 解析与 JoinRequest 状态转换；
- Activity 更新的 version、revision、Audit 与 Snapshot ETag；
- DIRECT_JOIN 与 REQUIRE_APPROVAL 分支；
- 相同用户串行及并发重复申请返回同一 requestId；
- Owner、普通成员、申请人的读取和决定权限；
- 并发 approve 只产生一个成员、一次邀请消耗、一次 Audit/revision/通知；
- 相反决定返回 `JOIN_REQUEST_CLOSED`；
- Activity 生命周期、邀请撤销/过期/耗尽、定向用户名重新校验；
- 任一事务副作用失败时整体回滚；
- 通知列表、未读计数与幂等已读；
- 前端 Activity 更新、Pending 状态、Owner 审批和结果通知交互。

PostgreSQL 集成测试只使用 WSL 可丢弃数据库并强制 `--test-threads=1`。合同变更后重新生成 OpenAPI 与 TypeScript client，验证生成可重复。运行受影响 Rust、Frontend 单元测试、typecheck、production build、fmt 和 clippy。可见 UI 变化使用 Chromium 检查桌面与移动端；完整断网/PWA/审批与附件 E2E 仍留给 Task 28。

## 10. 完成边界

Task 27A 完成时只能声明“加入审批与最小通知切片完成，可以继续 Task 27 的 Guest Binding”。Task 27 的 Attachment、Rate Provider、其余通知事件，Task 28、Phase 3、真机 PWA 验收和最终 Release Verification 仍未完成。

不得创建 `v0.0.3` tag、构建或发布 GHCR 正式镜像，也不得宣称项目达到正式发布状态。
