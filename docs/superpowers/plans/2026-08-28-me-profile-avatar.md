# HuddleTab “我的”模块与头像预设 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按确认设计重构“我的”主页与二级账户页面，并让六张本地头像支持用户选择、跨设备持久化及正式成员全局一致展示。

**Architecture:** `user_profiles.avatar_preset` 是唯一账户头像选择来源，历史用户的 `NULL` 保留稳定哈希，新注册和初始化用户显式写入 `2`。活动 API 只读投影正式成员的头像编号，`MemberAvatar` 统一执行 `imageUrl → avatarPreset → stable hash` 优先级；“我的”模块使用真实二级路由和既有账户 API，不复制业务能力。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript 6、Tailwind CSS 4、Radix/shadcn、Lucide、Drizzle/PostgreSQL、Vitest/Testing Library、Playwright、WSL Docker Compose。

**Spec:** `docs/superpowers/specs/2026-08-28-me-profile-avatar-design.md`

## Global Constraints

- 六张头像固定为 `public/member-avatars/avatar-01.webp` 至 `avatar-06.webp`，不新增上传或外部 URL 能力。
- 新注册用户和首次初始化管理员默认 `avatar-02`；历史用户保持 `avatar_preset = NULL`，直到主动选择。
- 正式成员读取账户头像，临时成员继续按 ActivityMember ID 稳定哈希。
- Synthetic Email 永不展示；绑定状态与验证状态必须分别读取，不能互相推断。
- 头像变化不增加 Activity Revision，不写账务 Audit，不修改离线 Mutation。
- 不改变账务算法、权限矩阵、邀请 Token 生命周期、活动生命周期或数据库中的 ActivityMember 身份语义。
- 关键类与兼容规则补充中文设计注释；用户可见错误使用清楚中文，日志不得输出敏感资料。
- 写 Next.js 代码前阅读 `node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`、`04-linking-and-navigating.md`、`02-guides/forms.md` 以及对应 Vitest/Playwright 指南。
- 每个行为变化严格执行 RED → GREEN；只格式化本轮修改文件。

---

## File Map

**数据与资料契约**

- `src/server/db/schema/system.ts`：声明可空 `avatarPreset` 与数据库范围约束。
- `drizzle/0012_profile_avatar_preset.sql`：历史兼容迁移，不回填旧用户。
- `src/features/me/avatar-presets.ts`：六个允许值、默认值、类型与本地资源路径。
- `src/server/services/registration-service.ts`、`src/server/bootstrap/initialize-setup.ts`：新用户显式写入默认值。
- `src/server/services/me-service.ts`：资料读取、脱敏邮箱、资料原子更新。
- `src/app/api/me/profile/route.ts`：资料 GET/PATCH 输入输出边界。

**头像渲染与活动投影**

- `src/components/design-system/member-avatar.tsx`：统一头像优先级。
- `src/app/api/activities/[activityId]/members/route.ts`：成员页头像投影。
- `src/server/services/expense-service.ts`、`src/features/expenses/api.ts`：快速记账成员头像投影。
- `src/server/services/settlement-service.ts`、`src/features/settlements/api.ts`：结算成员头像投影。
- `src/server/repositories/expense-repository.ts`：消费详情付款/承担头像投影。
- 现有成员、记账、结算和账单组件：向 `MemberAvatar` 传递 `avatarPreset`。

**“我的”模块**

- `src/features/me/api.ts`：共享 Profile DTO 与账户请求函数。
- `src/features/me/components/me-subpage-header.tsx`：二级页面返回标题栏。
- `src/features/me/components/avatar-preset-picker.tsx`：六头像单选语义。
- `src/features/me/components/profile-page.tsx`：昵称、只读用户名和头像保存。
- `src/features/me/components/email-page.tsx`：邮箱状态与绑定/更换。
- `src/features/me/components/password-page.tsx`：密码更新与确认值校验。
- `src/features/me/components/theme-page.tsx`：三种主题偏好。
- `src/features/me/components/me-page.tsx`：参考图主页。
- `src/app/(product)/me/{profile,email,password,theme}/page.tsx`：真实二级路由。
- `src/app/admin/page.tsx`：只展示现有四个管理入口。

**测试与验收**

- 现有 auth/API/UI 测试文件按各任务更新。
- `tests/e2e/core-ui/authenticated-product-flow.spec.ts`：头像持久化和跨活动展示主流程。
- `tests/e2e/core-ui/product-visual-matrix.spec.ts`：将旧 Me 截图替换为确认的 14 张模块矩阵。

---

### Task 1: 头像预设模型与新用户默认值

**Files:**
- Create: `src/features/me/avatar-presets.ts`
- Modify: `src/server/db/schema/system.ts`
- Create: `drizzle/0012_profile_avatar_preset.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0012_snapshot.json`
- Modify: `src/server/services/registration-service.ts`
- Modify: `src/server/bootstrap/initialize-setup.ts`
- Test: `tests/integration/auth/auth-schema.test.ts`
- Test: `tests/integration/auth/registration-service.test.ts`

**Interfaces:**
- Produces: `type AvatarPreset = 1 | 2 | 3 | 4 | 5 | 6`
- Produces: `AVATAR_PRESETS`, `DEFAULT_AVATAR_PRESET = 2`, `avatarPresetPath(preset)`
- Produces: nullable database column `user_profiles.avatar_preset`

- [ ] **Step 1: 写失败的 Schema 与注册默认值测试**

在 `auth-schema.test.ts` 增加历史行不传头像时为 `NULL`、非法值 `7` 被数据库拒绝的测试；在 `registration-service.test.ts` 将读取改为：

```ts
const [profile] = await harness.sql`
  select email_kind, avatar_preset
  from user_profiles where user_id = 'new-user'`;
expect(profile).toMatchObject({ email_kind: "SYNTHETIC", avatar_preset: 2 });
```

- [ ] **Step 2: 运行 RED**

Run in WSL: `npm exec vitest run tests/integration/auth/auth-schema.test.ts tests/integration/auth/registration-service.test.ts --maxWorkers=1`

Expected: FAIL，数据库不存在 `avatar_preset`。

- [ ] **Step 3: 添加允许值与 Drizzle 字段**

`src/features/me/avatar-presets.ts` 使用固定 tuple，路径必须由受控编号构造：

```ts
export const AVATAR_PRESETS = [1, 2, 3, 4, 5, 6] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];
export const DEFAULT_AVATAR_PRESET: AvatarPreset = 2;
export const avatarPresetPath = (preset: AvatarPreset) =>
  `/member-avatars/avatar-${String(preset).padStart(2, "0")}.webp`;
```

在 Drizzle Schema 中添加 `integer("avatar_preset")` 与 `check("user_profiles_avatar_preset_check", sql\`...\`)`，保持 nullable 且无 default。

- [ ] **Step 4: 生成并审查迁移**

Run: `npm exec drizzle-kit generate -- --name profile_avatar_preset`

迁移必须生成 `drizzle/0012_profile_avatar_preset.sql`，且只添加可空列与 `1..6` 检查约束，不包含历史回填或数据库默认值；journal 和 snapshot 由 Drizzle Kit 同步生成，不手工伪造。

- [ ] **Step 5: 新建账户显式写入默认头像**

普通注册与初始化管理员的 `userProfiles` insert 都增加：

```ts
avatarPreset: DEFAULT_AVATAR_PRESET,
```

- [ ] **Step 6: 运行 GREEN**

Run in WSL: `npm exec vitest run tests/integration/auth/auth-schema.test.ts tests/integration/auth/registration-service.test.ts --maxWorkers=1`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/features/me/avatar-presets.ts src/server/db/schema/system.ts drizzle src/server/services/registration-service.ts src/server/bootstrap/initialize-setup.ts tests/integration/auth/auth-schema.test.ts tests/integration/auth/registration-service.test.ts
git commit -m "feat(profile): persist avatar presets"
```

---

### Task 2: 资料 API、邮箱脱敏与头像保存

**Files:**
- Create: `src/features/me/api.ts`
- Modify: `src/server/services/me-service.ts`
- Modify: `src/app/api/me/profile/route.ts`
- Test: `tests/unit/auth/me-service.test.ts`
- Test: `tests/api/me-routes.test.ts`

**Interfaces:**
- Consumes: `AvatarPreset`
- Produces: `MeProfileDto` with `avatarPreset`, `maskedEmail`, `emailVerified`
- Produces: `getMeProfile()` and `updateMeProfile({ nickname, avatarPreset? })`

- [ ] **Step 1: 写失败的资料服务测试**

覆盖 Synthetic Email 完全隐藏，以及真实邮箱只返回首字符与域名：

```ts
expect(await service.getProfile("user-1")).toEqual({
  username: "alice",
  nickname: "Alice",
  emailBound: true,
  maskedEmail: "a***@example.com",
  emailVerified: true,
  avatarPreset: 4,
  themePreference: "SYSTEM",
  isSystemAdmin: false,
});
```

再验证 `updateProfile("user-1", { nickname: "新昵称" })` 不覆盖原有头像，传入 `avatarPreset: 5` 时同时更新。

- [ ] **Step 2: 写失败的 Route 输入测试**

在 `me-routes.test.ts` 增加：旧 `{ nickname }` 请求仍成功；`{ nickname, avatarPreset: 7 }` 被拒绝；合法 `5` 原样交给 `MeService.updateProfile`。

- [ ] **Step 3: 运行 RED**

Run: `npm exec vitest run tests/unit/auth/me-service.test.ts tests/api/me-routes.test.ts`

Expected: FAIL，缺少新字段和 `updateProfile`。

- [ ] **Step 4: 实现最小资料契约**

`MeService.getProfile` 只在 `email_kind = 'REAL'` 时读取并脱敏认证邮箱；Synthetic Email 返回 `maskedEmail: null` 和 `emailVerified: false`。脱敏规则固定为本地部分首字符加 `***`，不把完整邮箱写入日志。

`PATCH` Schema：

```ts
z.object({
  nickname: z.string().trim().min(1).max(40),
  avatarPreset: z
    .union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ])
    .optional(),
});
```

- [ ] **Step 5: 运行 GREEN**

Run: `npm exec vitest run tests/unit/auth/me-service.test.ts tests/api/me-routes.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/features/me/api.ts src/server/services/me-service.ts src/app/api/me/profile/route.ts tests/unit/auth/me-service.test.ts tests/api/me-routes.test.ts
git commit -m "feat(profile): expose safe editable profile"
```

---

### Task 3: 统一头像渲染优先级

**Files:**
- Modify: `src/components/design-system/member-avatar.tsx`
- Test: `tests/unit/foundation/component-accessibility.test.ts`
- Test: `tests/unit/foundation/visual-assets.test.ts`

**Interfaces:**
- Consumes: `AvatarPreset`, `avatarPresetPath`
- Produces: `MemberAvatar({ memberId, displayName, imageUrl?, avatarPreset?, className? })`

- [ ] **Step 1: 写失败的优先级测试**

```tsx
render(<MemberAvatar memberId="member-42" displayName="小王" avatarPreset={4} />);
expect(screen.getByLabelText("小王的头像").querySelector("img"))
  .toHaveAttribute("src", "/member-avatars/avatar-04.webp");
```

补充同一调用同时传 `imageUrl` 时真实图片仍优先；`avatarPreset={null}` 仍走稳定哈希。

- [ ] **Step 2: 运行 RED**

Run: `npm exec vitest run tests/unit/foundation/component-accessibility.test.ts tests/unit/foundation/visual-assets.test.ts`

Expected: FAIL，组件不接受 `avatarPreset`。

- [ ] **Step 3: 最小实现优先级**

```ts
const source = imageUrl ??
  (avatarPreset ? avatarPresetPath(avatarPreset) : avatarPaths[colorIndex]);
```

保留现有可访问名称、稳定颜色索引和真实图片 `unoptimized` 行为，并补充中文注释说明三层优先级。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm exec vitest run tests/unit/foundation/component-accessibility.test.ts tests/unit/foundation/visual-assets.test.ts`

```bash
git add src/components/design-system/member-avatar.tsx tests/unit/foundation/component-accessibility.test.ts tests/unit/foundation/visual-assets.test.ts
git commit -m "feat(ui): support selected member avatars"
```

---

### Task 4: 成员与快速记账头像投影

**Files:**
- Modify: `src/app/api/activities/[activityId]/members/route.ts`
- Modify: `src/server/services/expense-service.ts`
- Modify: `src/features/expenses/api.ts`
- Modify: `src/features/members/components/member-list.tsx`
- Modify: `src/features/members/components/member-management-sheet.tsx`
- Modify: `src/features/expenses/components/quick-expense-form.tsx`
- Modify: `src/features/expenses/components/split-editor.tsx`
- Test: `tests/api/members.test.ts`
- Test: `tests/api/expenses/expense-routes.test.ts`
- Test: `tests/unit/ui/quick-expense-form.test.tsx`

**Interfaces:**
- Produces: member DTO field `avatarPreset?: AvatarPreset | null`

- [ ] **Step 1: 写失败的正式/临时成员 API 测试**

成员查询 fixture 同时包含 USER 与 GUEST，断言：

```ts
expect(body.data).toEqual([
  expect.objectContaining({ id: "member-user", avatarPreset: 5 }),
  expect.objectContaining({ id: "member-guest", avatarPreset: null }),
]);
```

快速记账上下文同样断言该只读字段，不改变 preference 与 permissions。

- [ ] **Step 2: 运行 RED**

Run: `npm exec vitest run tests/api/members.test.ts tests/api/expenses/expense-routes.test.ts tests/unit/ui/quick-expense-form.test.tsx`

Expected: FAIL，DTO 不含头像字段。

- [ ] **Step 3: 服务端只读 Join**

成员查询使用 `left join user_profiles profile on profile.user_id = member.user_id` 并投影 `profile.avatar_preset`。不得把头像复制到 ActivityMember，也不得返回邮箱。

- [ ] **Step 4: UI 传递头像编号**

所有对应 `MemberAvatar` 调用增加：

```tsx
avatarPreset={member.avatarPreset}
```

不改变成员选择、分摊和付款业务逻辑。

- [ ] **Step 5: 运行 GREEN 并提交**

Run: `npm exec vitest run tests/api/members.test.ts tests/api/expenses/expense-routes.test.ts tests/unit/ui/quick-expense-form.test.tsx`

```bash
git add src/app/api/activities/[activityId]/members/route.ts src/server/services/expense-service.ts src/features/expenses/api.ts src/features/members src/features/expenses/components/quick-expense-form.tsx src/features/expenses/components/split-editor.tsx tests/api/members.test.ts tests/api/expenses/expense-routes.test.ts tests/unit/ui/quick-expense-form.test.tsx
git commit -m "feat(profile): project avatars into member flows"
```

---

### Task 5: 结算与账单详情头像投影

**Files:**
- Modify: `src/server/services/settlement-service.ts`
- Modify: `src/features/settlements/api.ts`
- Modify: `src/features/settlements/components/settlement-page.tsx`
- Modify: `src/server/repositories/expense-repository.ts`
- Modify: `src/features/expenses/api.ts`
- Modify: `src/features/expenses/components/expense-detail.tsx`
- Modify: `src/features/expenses/components/expense-split-detail.tsx`
- Test: `tests/api/settlements/ledger-routes.test.ts`
- Test: `tests/api/expenses/expense-routes.test.ts`
- Test: `tests/unit/ui/settlement-page.test.tsx`
- Test: `tests/unit/ui/expense-detail.test.tsx`
- Test: `tests/unit/ui/expense-split-detail.test.tsx`

**Interfaces:**
- Consumes: `avatarPreset?: AvatarPreset | null`
- Produces: consistent avatar projection for settlement members, expense creator, payments and shares

- [ ] **Step 1: 写失败的结算与账单 DTO 测试**

在真实响应断言正式成员为指定预设、临时成员为 `null`；在 UI 测试通过 `img src` 验证选择值实际传到 `MemberAvatar`，不只检查 mock 是否存在。

- [ ] **Step 2: 运行 RED**

Run: `npm exec vitest run tests/api/settlements/ledger-routes.test.ts tests/api/expenses/expense-routes.test.ts tests/unit/ui/settlement-page.test.tsx tests/unit/ui/expense-detail.test.tsx tests/unit/ui/expense-split-detail.test.tsx`

Expected: FAIL，详情与结算响应缺少头像字段。

- [ ] **Step 3: 为现有成员查询增加只读 Join**

只扩展 SELECT 与 DTO，不修改 Expense/Settlement 聚合、金额字段或权限判断。付款与承担行分别携带对应成员的 `avatarPreset`；创建人头像使用其 ActivityMember 关联的账户预设。

- [ ] **Step 4: 传递到全部头像调用并运行 GREEN**

Run: `npm exec vitest run tests/api/settlements/ledger-routes.test.ts tests/api/expenses/expense-routes.test.ts tests/unit/ui/settlement-page.test.tsx tests/unit/ui/expense-detail.test.tsx tests/unit/ui/expense-split-detail.test.tsx`

- [ ] **Step 5: 提交**

```bash
git add src/server/services/settlement-service.ts src/features/settlements src/server/repositories/expense-repository.ts src/features/expenses/api.ts src/features/expenses/components/expense-detail.tsx src/features/expenses/components/expense-split-detail.tsx tests/api/settlements/ledger-routes.test.ts tests/api/expenses/expense-routes.test.ts tests/unit/ui/settlement-page.test.tsx tests/unit/ui/expense-detail.test.tsx tests/unit/ui/expense-split-detail.test.tsx
git commit -m "feat(profile): show avatars across accounting views"
```

---

### Task 6: 个人资料路由与六头像选择

**Files:**
- Create: `src/features/me/components/me-subpage-header.tsx`
- Create: `src/features/me/components/avatar-preset-picker.tsx`
- Create: `src/features/me/components/profile-page.tsx`
- Create: `src/app/(product)/me/profile/page.tsx`
- Test: `tests/unit/ui/me-profile-page.test.tsx`
- Test: `tests/unit/ui/me-page-route.test.tsx`

**Interfaces:**
- Consumes: `getMeProfile`, `updateMeProfile`, `AVATAR_PRESETS`
- Produces: accessible `/me/profile` page

- [ ] **Step 1: 写失败的页面语义测试**

断言页面包含返回链接、标题、昵称、只读用户名、六个 radio 和保存按钮：

```tsx
expect(screen.getAllByRole("radio", { name: /头像/ })).toHaveLength(6);
expect(screen.getByRole("radio", { name: "头像 2" })).toBeChecked();
expect(screen.getByLabelText("用户名")).toHaveAttribute("readonly");
```

交互测试选择头像 5、修改昵称、保存，并断言请求体为 `{ nickname, avatarPreset: 5 }`；失败时输入和选择保持不变。

- [ ] **Step 2: 运行 RED**

Run: `npm exec vitest run tests/unit/ui/me-profile-page.test.tsx tests/unit/ui/me-page-route.test.tsx`

Expected: FAIL，路由和组件不存在。

- [ ] **Step 3: 实现受控单选与表单**

`AvatarPresetPicker` 使用原生 radio 或 Radix RadioGroup 语义，每个点击区域至少 `48px`，选中状态同时包含可见勾选和边框。大头像预览随选择立即更新，但只在用户点击“保存”后写服务器。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm exec vitest run tests/unit/ui/me-profile-page.test.tsx tests/unit/ui/me-page-route.test.tsx`

```bash
git add src/features/me/components/me-subpage-header.tsx src/features/me/components/avatar-preset-picker.tsx src/features/me/components/profile-page.tsx src/app/'(product)'/me/profile/page.tsx tests/unit/ui/me-profile-page.test.tsx tests/unit/ui/me-page-route.test.tsx
git commit -m "feat(profile): add avatar profile editor"
```

---

### Task 7: 邮箱、密码与主题二级页面

**Files:**
- Create: `src/features/me/components/email-page.tsx`
- Create: `src/features/me/components/password-page.tsx`
- Create: `src/features/me/components/theme-page.tsx`
- Create: `src/app/(product)/me/email/page.tsx`
- Create: `src/app/(product)/me/password/page.tsx`
- Create: `src/app/(product)/me/theme/page.tsx`
- Modify: `src/features/me/components/theme-selector.tsx`
- Test: `tests/unit/ui/me-account-pages.test.tsx`
- Test: `tests/unit/ui/me-page-route.test.tsx`

**Interfaces:**
- Consumes: existing `/api/me/email`, `/api/me/password`, `/api/me/theme`
- Produces: three directly addressable account pages

- [ ] **Step 1: 写失败的邮箱状态测试**

未绑定显示“绑定邮箱”；已绑定显示 `maskedEmail`、真实 `emailVerified` 状态和“更换邮箱”。不得渲染 Synthetic Email 或根据 `emailBound` 硬编码“已验证”。

- [ ] **Step 2: 写失败的密码与主题测试**

密码不一致时不调用 API并显示“新密码与确认密码不一致。”；一致时提交现有 `{ currentPassword, newPassword }`。主题页保持三个 radio，成功写服务器后才更新本地主题。

- [ ] **Step 3: 运行 RED**

Run: `npm exec vitest run tests/unit/ui/me-account-pages.test.tsx tests/unit/ui/me-page-route.test.tsx`

Expected: FAIL，二级路由不存在。

- [ ] **Step 4: 实现三个页面**

保持参考图字段顺序、明确 label、正确 `autocomplete`、提交 Loading 和相邻中文错误。邮箱页只展示服务端提供的脱敏值；主题页复用 `ThemeSelector`，不复制主题持久化逻辑。

- [ ] **Step 5: 运行 GREEN 并提交**

Run: `npm exec vitest run tests/unit/ui/me-account-pages.test.tsx tests/unit/ui/me-page-route.test.tsx`

```bash
git add src/features/me/components/email-page.tsx src/features/me/components/password-page.tsx src/features/me/components/theme-page.tsx src/features/me/components/theme-selector.tsx src/app/'(product)'/me/email/page.tsx src/app/'(product)'/me/password/page.tsx src/app/'(product)'/me/theme/page.tsx tests/unit/ui/me-account-pages.test.tsx tests/unit/ui/me-page-route.test.tsx
git commit -m "feat(profile): add account settings pages"
```

---

### Task 8: 参考图“我的”主页与系统管理入口

**Files:**
- Modify: `src/features/me/components/me-page.tsx`
- Modify: `src/app/admin/page.tsx`
- Test: `tests/unit/ui/me-page.test.tsx`
- Test: `tests/unit/ui/supporting-pages.test.tsx`

**Interfaces:**
- Consumes: `MeProfileDto`, `MemberAvatar.avatarPreset`
- Produces: homepage links `/me/profile`, `/me/email`, `/me/password`, `/me/theme`, `/admin`

- [ ] **Step 1: 更新主页测试并验证 RED**

将旧 Overlay 断言改为真实链接：

```tsx
expect(screen.getByRole("link", { name: "个人资料" }))
  .toHaveAttribute("href", "/me/profile");
expect(screen.getByRole("link", { name: "主题：跟随系统" }))
  .toHaveAttribute("href", "/me/theme");
expect(screen.queryByRole("dialog", { name: "编辑个人资料" }))
  .not.toBeInTheDocument();
```

同时断言系统管理员条件入口、邮箱状态、退出登录仅在主页存在。

Run: `npm exec vitest run tests/unit/ui/me-page.test.tsx tests/unit/ui/supporting-pages.test.tsx`

Expected: FAIL，主页仍打开 Overlay，分组样式与链接不符。

- [ ] **Step 2: 重排主页并删除孤儿 Overlay 状态**

资料卡改为浅薄荷语义表面；设置行放入紧凑圆角边框组；主题、退出登录保留在主页。删除因真实路由替代而失效的 Profile/Email/Password/Theme Overlay 状态和事件处理，但保留主页退出登录处理。

- [ ] **Step 3: 重排 `/admin` 首页**

使用返回标题栏、Lucide 图标、四个现有真实链接；不修改子页面和权限守卫，不添加 SMTP 独立入口，因为其能力当前属于 `/admin/settings`。

- [ ] **Step 4: 运行 GREEN 并提交**

Run: `npm exec vitest run tests/unit/ui/me-page.test.tsx tests/unit/ui/supporting-pages.test.tsx`

```bash
git add src/features/me/components/me-page.tsx src/app/admin/page.tsx tests/unit/ui/me-page.test.tsx tests/unit/ui/supporting-pages.test.tsx
git commit -m "feat(ui): align profile settings navigation"
```

---

### Task 9: 登录后头像 E2E 与统一视觉矩阵

**Files:**
- Modify: `tests/e2e/core-ui/authenticated-product-flow.spec.ts`
- Modify: `tests/e2e/core-ui/authenticated-product-support.ts`
- Modify: `tests/e2e/core-ui/product-visual-matrix.spec.ts`
- Output: `.superpowers/sdd/huddletab-product-ui-refresh/screenshots/`

**Interfaces:**
- Consumes: completed profile routes and avatar propagation
- Produces: authenticated persistence proof and 14-image Me acceptance set

- [ ] **Step 1: 写失败的生产容器头像流程**

流程必须通过真实 UI：登录 → `/me/profile` → 选择头像 5 → 保存 → 刷新 `/me` → 创建/打开活动成员页 → 当前正式成员头像仍为 `avatar-05.webp`。不得直接写数据库或 localStorage。

- [ ] **Step 2: 在旧生产构建上确认 RED**

Run in WSL against the production compose project: `npm exec playwright test tests/e2e/core-ui/authenticated-product-flow.spec.ts --project=chromium`

Expected: FAIL，`/me/profile` 或头像选择不存在。

- [ ] **Step 3: 更新视觉场景与截图定义**

将旧 Me 截图替换为以下 14 张，不重复保留旧版本：

```text
390×844 light: me, me-profile, me-email-unbound, me-email-bound,
                 me-password, me-theme, admin
390×844 dark:  me, me-profile, me-theme
700×900 light: me, me-profile
1440×1000 light: me, me-profile
```

既有 Reduced Motion、焦点、`scrollWidth <= clientWidth`、触控目标和底部导航留白继续使用断言，不增加截图变体。

- [ ] **Step 4: 重建生产容器并运行 GREEN**

使用项目现有 WSL Compose 流程重建 `huddletab_codex_e2e`，保持 `TZ=Asia/Shanghai`。运行头像 E2E 与视觉矩阵，审查所有截图可解码、尺寸正确、亮暗主题无重叠。

- [ ] **Step 5: 提交**

```bash
git add tests/e2e/core-ui
git commit -m "test(e2e): cover profile avatar experience"
```

截图为验收产物；只提交仓库既有策略要求跟踪的文件。

---

### Task 10: 全量回归、容器验证与统一验收交付

**Files:**
- Modify only files required to fix regressions directly caused by Tasks 1–9

**Interfaces:**
- Produces: release-ready verification evidence on the completed branch

- [ ] **Step 1: 运行静态与单元验证**

```text
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

每条命令必须退出码为 `0`；记录测试文件数与通过数。构建后恢复无语义变化的 `next-env.d.ts` 和 `public/sw.js` 生成改动。

- [ ] **Step 2: 运行 WSL 数据库集成测试**

Run: `npm run test:integration`

Expected: 与数据库相关测试全部通过；不得用跳过测试代替修复。

- [ ] **Step 3: 运行生产容器核心流程**

至少覆盖登录、活动创建、记账、邀请加入、结算、头像修改与跨页面展示。运行既有 production smoke/responsive E2E，确认新增路由没有破坏底部导航与认证回跳。

- [ ] **Step 4: 审核截图矩阵**

检查 14 张 Me 模块截图的尺寸、主题、文字溢出、头像清晰度、44px 触控目标和固定导航遮挡。对不合格页面只修正具体问题，不建立像素快照 gate。

- [ ] **Step 5: 最终提交与工作区审计**

```bash
git status --short
git diff --check
git log --oneline --decorate -12
```

只提交本计划文件；保留 `.agents/`、`NUL`、`skills-lock.json`、`unused/` 等用户本地未跟踪内容。向用户一次性展示截图与验证结果，等待统一验收，不提前推送或发布。
