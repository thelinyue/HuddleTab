# HuddleTab Task 27B Guest Binding 设计

## 1. 目标与范围

Task 27B 允许 Activity Owner 为一个现有临时成员创建定向绑定邀请。目标用户登录或注册后主动确认，将自己的账号绑定到该临时成员；`ActivityMember ID`、昵称、角色、状态和全部历史账务引用保持不变。

本轮只实现 Guest Binding。Task 27 的 Attachment、Rate Provider、其余 Notification 事件和 Task 28 不在本轮范围；不创建 `v0.0.3` tag，不构建或发布正式镜像。

项目尚未正式发布，不增加旧 Next.js 数据、API、Session 或路由兼容层。UI 继续以远程 `v0.0.2` 为基准，活动工作台只保留“流水 / 结算”。

## 2. 已冻结的产品语义

- Guest Binding 必须由 Owner 创建定向邀请，并由目标用户确认；Owner 不能直接替目标用户完成绑定。
- 绑定邀请已表达 Owner 对指定账号和指定 Guest 的批准，因此不受 Activity `inviteMode` 影响，也不创建 JoinRequest。
- 目标用户确认后只设置原 Guest 的 `user_id` 并推进成员 version。不得新建成员、替换 member ID 或迁移 Expense、Payment、Share、Settlement 等账务事实。
- 绑定后保留 Guest 原昵称，不用账号显示名覆盖，避免历史流水中的参与者名称无意变化。
- 若目标用户在该 Activity 已有任何 ActivityMember，包括 `LEFT`，返回冲突；本轮不合并两个账务身份。
- Activity 必须为未删除的 `ACTIVE`，目标成员必须为 `ACTIVE` 且 `user_id IS NULL`。创建和最终确认时都重新校验。
- 同一 Guest 可以存在多个尚未使用的绑定邀请。第一个成功确认者获胜，其他 token 随后失效；不为低频误操作新增独立状态机。
- 创建绑定邀请沿用现有 Invitation 的 Audit/revision 行为。首次成功绑定写一次 `MEMBER_GUEST_BOUND` Audit，并让 Activity revision 恰好增加一次。
- 本轮不新增 Guest Binding 通知类型。

## 3. 数据模型

在 `activity_invites` 增加 nullable `guest_member_id UUID`：

- 使用 `(activity_id, guest_member_id)` 复合外键引用 `activity_members(activity_id, id)`，从数据库层阻止跨 Activity 绑定。
- `guest_member_id IS NULL` 表示现有普通加入邀请。
- `guest_member_id IS NOT NULL` 表示 Guest Binding 邀请，并要求 `kind = 'DIRECT'`、`target_username IS NOT NULL`、`max_uses = 1`。
- 邀请用途由 `guest_member_id` 派生为 `JOIN | GUEST_BINDING`，不再保存一列重复的 purpose。

当前 Rust schema 已经使用 `user_id IS NULL` 表示 Guest，不增加 `member_type` 列。Guest 是否仍可绑定必须在持有行锁时通过 `user_id IS NULL` 与 `status = 'ACTIVE'` 判断，不能只依赖创建邀请时的旧状态。

## 4. 应用与事务

### 4.1 创建绑定邀请

Owner 调用专用 use case，输入 `activity_id`、`guest_member_id`、`target_username`。应用层复用现有 Username 校验、七天邀请有效期和安全 token codec，并固定：

```text
kind = DIRECT
max_uses = 1
guest_member_id = path member_id
```

Repository 在一个事务中：

1. 锁定并验证未删除的 ACTIVE Activity 和当前 Owner。
2. 锁定同 Activity 的目标成员，要求其为 ACTIVE 且 `user_id IS NULL`。
3. 插入只保存 token hash 的绑定邀请。
4. 写现有 `INVITATION_CREATED` Audit 并按现有语义推进 Activity revision。
5. 提交后仅在本次响应返回明文 token。

该入口沿用 `SensitiveAuthenticated` 限流。请求通过 Session/CSRF 后、进入业务验证前计数。

### 4.2 确认绑定

现有 `POST /api/invitations/{token}/join` 根据邀请的 `guest_member_id` 分流。绑定分支不读取 `inviteMode`，也不创建或决定 JoinRequest。

Repository 在一个事务中：

1. 按 token hash 锁定邀请、Activity 和目标 Guest，验证未撤销、未过期、目标用户名匹配且 Activity 仍可加入。
2. 若该邀请已经由同一用户成功绑定，返回 `ALREADY_BOUND`，不重复任何副作用。
3. 验证目标 Guest 仍为 ACTIVE 且尚未绑定。
4. 锁定并检查确认者在该 Activity 是否已有任意成员记录；存在则返回 `GUEST_BINDING_CONFLICT`。
5. 在原 Guest 行设置 `user_id`，并将成员 `version + 1`；保留 id、display_name、role、status 和 joined_at。
6. 将邀请 `use_count + 1`，写 `MEMBER_GUEST_BOUND` Audit，并将 Activity revision 恰好增加一次。
7. 提交并返回 `BOUND`、原 member ID 和新 revision。

两个账号并发确认指向同一 Guest 的不同 token 时，Guest 行锁串行化最终校验。恰好一个事务成功；失败事务不修改邀请使用次数，不写 Audit，也不推进 revision。

### 4.3 幂等重放

为覆盖成功响应丢失，同一 token、同一用户在邀请仍未过期且未撤销时再次确认，返回 `ALREADY_BOUND`。识别条件必须同时满足：

- 邀请是该 Guest 的绑定邀请；
- Guest 当前 `user_id` 等于确认者；
- 该邀请 `use_count = 1`。

其他 token 即使指向已由该用户绑定的同一 Guest，也不视为该次操作的 replay。

## 5. HTTP 合同

新增：

```text
POST /api/activities/{activity_id}/members/{member_id}/binding-invitations
```

请求：

```json
{
  "targetUsername": "alice"
}
```

成功返回 `201`，复用现有创建邀请 envelope，并增加：

```json
{
  "data": {
    "purpose": "GUEST_BINDING",
    "guestMemberId": "...",
    "token": "仅本次响应出现"
  }
}
```

现有 Invitation 创建、列表和预览 DTO 增加：

- `purpose: JOIN | GUEST_BINDING`
- `guestMemberId: string | null`
- 公共预览对绑定邀请增加 `guestDisplayName: string | null`

公共预览不返回 `targetUsername`。普通加入邀请的 `guestMemberId` 与 `guestDisplayName` 均为 `null`。

现有确认响应状态扩展为：

- `BOUND`：首次成功绑定。
- `ALREADY_BOUND`：同一 token、同一用户的无副作用重放。

现有 `JOINED | ALREADY_MEMBER | PENDING_APPROVAL` 语义保持不变。

## 6. 错误合同

- 创建时目标不存在、不是 ACTIVE Guest 或已经绑定：`404 GUEST_NOT_FOUND`，消息“该临时成员不存在或已绑定账号。”
- 确认者在 Activity 已有任意成员身份：`409 GUEST_BINDING_CONFLICT`，消息“你已是该活动成员，无法绑定另一个临时成员。”
- token 过期、撤销、用户名不匹配、Activity 不再可加入、Guest 已被其他账号绑定：`404 INVALID_INVITATION`。
- 非 Owner 创建、Session/CSRF 和限流继续使用现有 `403`、`401`、`429` 合同。
- 存储异常使用现有中文通用错误 envelope，日志不得输出明文 token、Session、CSRF 或密码。

## 7. Frontend 交互

成员 Overlay 保持现有结构：

- 仅 ACTIVE Activity 的 Owner 在 `userId == null` 的成员行看到“绑定账号”。
- 点击后针对该成员打开单一目标用户名表单；不新增成员管理页面或活动导航标签。
- 创建成功后显示一次性 token 和及时发送提示。创建失败保留目标用户名草稿。
- “有效邀请”将绑定邀请显示为“绑定「昵称」给 @用户名”，并复用现有撤销操作。

邀请页根据 `purpose` 调整文案：

- 标题说明“绑定临时成员身份”，展示 `guestDisplayName`。
- 已登录按钮为“确认绑定”。
- 未登录入口为“注册并绑定 / 登录”。注册完成后仍回到同一邀请页进行最终确认。
- `BOUND` 或 `ALREADY_BOUND` 后导航到 Activity；失败留在邀请页并展示服务端中文错误。

成功后失效当前用户的 Activity 列表缓存。Owner 创建或撤销绑定邀请时失效邀请列表；Owner 观察到绑定结果依赖正常查询刷新和 Snapshot revision，不增加推送或额外轮询。

## 8. Snapshot 与离线边界

Invitation 继续不进入 Snapshot 或 IndexedDB。绑定成功改变 Snapshot 中成员的 `userId`，并由同一事务推进 Activity revision，因此下一次 weak ETag 刷新整体替换 Snapshot。

本轮不修改 Expense Queue 格式、不增加离线 Guest Binding、不让 Service Worker 执行业务写入。

## 9. 测试与验收

严格按测试先行实施：

1. Migration 约束测试证明绑定目标只能引用同 Activity 成员，且绑定邀请只能是 DIRECT、单次邀请；目标成员是否仍为 Guest 由持锁事务测试覆盖。
2. PostgreSQL API 测试覆盖创建、匿名预览、邀请注册、确认绑定、member ID/昵称/历史账务引用不变、成员 version 与 Activity revision/Audit 单次推进。
3. 验证 `REQUIRE_APPROVAL` 不创建 JoinRequest；非 Owner、非 ACTIVE Activity、用户名不匹配、目标用户已有成员、撤销、过期和 Guest 已绑定均返回冻结错误。
4. 幂等测试证明同 token replay 返回 `ALREADY_BOUND` 且无额外副作用。
5. 并发测试让两个账号使用不同 token 竞争同一 Guest，证明只有一个成功且只有一次绑定 Audit/revision。
6. 限流专项测试证明新创建入口加入 `SensitiveAuthenticated` 共享桶。
7. 重新生成 OpenAPI 和 TypeScript client，并验证生成结果可重复。
8. Frontend 测试覆盖 adapter 请求/缓存失效、成员行表单、失败草稿、有效邀请展示、绑定预览文案和成功导航。
9. 运行相关 PostgreSQL 测试（`--test-threads=1`）、frontend focused/full unit、typecheck、production build、Rust fmt 和 strict clippy。
10. Chromium `1440x1000` 与 `390x844` 验证完整 Guest Binding 流程和无横向溢出；不重复 Phase 1E 全矩阵。

## 10. 完成边界

Task 27B 完成后只能声明 Guest Binding 已完成，可以继续 Task 27 Attachment。Task 27 Rate Provider、其余 Notification、Task 28、Phase 3、真机 iPhone Safari/Home Screen PWA 验收和最终 Release Verification 仍未完成；`0.0.3` 仍只是全部迁移完成后的预留正式版本。
