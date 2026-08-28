# Account And Activity UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付既有 V1 主路径的前端入口，使用户能仅通过页面完成登录、注册、创建活动和首次记账。

**Architecture:** 使用现有 Better Auth 用户名端点与 `/api/auth/register`，客户端表单只负责输入、中文错误呈现和整页导航，不复制服务端认证或邀请策略。活动列表标题栏新增明确的“创建活动”命令，复用现有表单覆盖层并调用已存在的受 Session 保护的活动创建端点。

**Tech Stack:** Next.js 16 App Router、React 19、TypeScript、Tailwind、现有 shadcn 风格 `Button`/`Input`/`Label`、Vitest、Playwright。

---

### Task 1: Shared Account Form Contracts

**Files:**
- Create: `src/features/auth/components/account-form.tsx`
- Test: `tests/unit/ui/account-form.test.tsx`

- [ ] **Step 1: Write the failing component tests**

```tsx
test("登录提交用户名和密码并进入活动页", async () => {
  // 输入 username/password，断言调用 /api/auth/sign-in/username
  // 成功后断言 window.location.assign(`${origin}/activities`)
});

test("注册提交昵称、用户名、密码和可选邀请凭证后自动登录", async () => {
  // 断言先 POST /api/auth/register，再 POST /api/auth/sign-in/username
  // 不能在请求体中包含确认密码
});

test("注册确认密码不一致时不发起请求", async () => {
  // 断言 role=alert 为“两次输入的密码不一致。”
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm exec vitest run tests/unit/ui/account-form.test.tsx`

Expected: FAIL because `AccountForm` does not exist.

- [ ] **Step 3: Implement the focused account form**

```tsx
export function AccountForm({ mode }: { readonly mode: "login" | "register" }) {
  // login: username, password
  // register: nickname, username, password, confirmPassword, inviteProof
  // 所有网络失败读取 { error: { message } } 并显示中文服务端契约。
  // 注册成功必须使用同一凭证调用 Better Auth，再整页导航到 /activities。
}
```

Use the setup page's accessible labels, `Button`, `Input`, `Label`, pending state and `window.location.assign` pattern. Registration keeps invite proof optional and labels it “邀请凭证（受邀注册时填写）”; the server remains the sole registration-policy authority.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm exec vitest run tests/unit/ui/account-form.test.tsx`

Expected: PASS with three tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/components/account-form.tsx tests/unit/ui/account-form.test.tsx
git commit -m "feat: add account login and registration forms"
```

### Task 2: Public Account Routes

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/register/page.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/unit/ui/account-pages.test.tsx`

- [ ] **Step 1: Write failing route composition tests**

```tsx
test("登录页提供到注册页的链接", () => {
  render(<LoginPage />);
  expect(screen.getByRole("link", { name: "注册新账号" })).toHaveAttribute("href", "/register");
});

test("注册页提供到登录页的链接", () => {
  render(<RegisterPage />);
  expect(screen.getByRole("link", { name: "已有账号，登录" })).toHaveAttribute("href", "/login");
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm exec vitest run tests/unit/ui/account-pages.test.tsx`

Expected: FAIL because the routes do not exist.

- [ ] **Step 3: Implement route pages and home entry**

```tsx
// /login and /register: independent pages, each combines a compact “伙记” heading,
// AccountForm, and one plain-text Link to the other route.
// /: preserve product identity and expose “登录” and “注册” links rather than a dead-end page.
```

Do not add a marketing hero or a second navigation system. Keep the same centered `max-w-md` layout used by `/setup`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm exec vitest run tests/unit/ui/account-pages.test.tsx`

Expected: PASS with two tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/login/page.tsx src/app/register/page.tsx tests/unit/ui/account-pages.test.tsx
git commit -m "feat: add public account routes"
```

### Task 3: Activity Creation UI

**Files:**
- Create: `src/features/activities/components/create-activity-form.tsx`
- Modify: `src/features/activities/components/activity-home.tsx`
- Test: `tests/unit/ui/create-activity-form.test.tsx`

- [ ] **Step 1: Write failing activity creation tests**

```tsx
test("创建活动提交名称、地点、币种和开始日期", async () => {
  // 点击“创建活动”，填写字段，断言 POST /api/activities 的 JSON
  // 成功后断言整页导航到 /activities/{id}
});

test("结束日期早于开始日期时显示中文校验错误且不提交", async () => {
  // role=alert: “结束日期不能早于开始日期。”
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm exec vitest run tests/unit/ui/create-activity-form.test.tsx`

Expected: FAIL because `CreateActivityForm` does not exist.

- [ ] **Step 3: Implement a compact creation overlay**

```tsx
// ActivityHome 标题右侧放 Button “创建活动”。
// 点击后在现有 ResponsiveFormOverlay 内呈现 CreateActivityForm。
// 必填：活动名称、主币种（默认 CNY）、开始日期（默认今天）。
// 可选：地点、结束日期。成功后 location.assign(`/activities/${data.id}`)。
```

Keep client validation limited to required fields and the date ordering; the server continues to validate the frozen API contract.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm exec vitest run tests/unit/ui/create-activity-form.test.tsx`

Expected: PASS with two tests.

- [ ] **Step 5: Commit**

```bash
git add src/features/activities/components/create-activity-form.tsx src/features/activities/components/activity-home.tsx tests/unit/ui/create-activity-form.test.tsx
git commit -m "feat: add activity creation UI"
```

### Task 4: Pure Browser User Journey

**Files:**
- Modify: `tests/e2e/wsl-setup-ui.spec.ts`

- [ ] **Step 1: Write the failing browser journey**

```ts
test("用户只通过页面完成初始化、创建活动、开放注册、注册登录和记账", async ({ browser }) => {
  // 管理员上下文：/activities -> /setup -> /activities。
  // 页面点击“创建活动”，填写表单，进入活动流水页。
  // 页面进入系统设置并选择“开放注册”。
  // 新浏览器上下文：/register，填写注册表单后进入 /activities。
  // 管理员上下文：在活动页点击“记一笔”，填写金额和用途，页面显示该消费。
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5660'; $env:RUN_WSL_UI_TEST='true'; npm exec -- playwright test tests/e2e/wsl-setup-ui.spec.ts --project=desktop-chromium`

Expected: FAIL because the public account and activity creation UI controls do not exist.

- [ ] **Step 3: Update selectors only after the UI contracts are implemented**

Use accessible page labels, buttons, links and visible activity title. Do not use `page.request`, `page.evaluate(fetch)`, database access or a direct HTTP client; the browser may perform only normal navigation and UI interaction.

- [ ] **Step 4: Run desktop and mobile browser verification**

Run: `$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5660'; $env:RUN_WSL_UI_TEST='true'; npm exec -- playwright test tests/e2e/wsl-setup-ui.spec.ts`

Expected: PASS for `desktop-chromium` and `mobile-chromium`.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/wsl-setup-ui.spec.ts
git commit -m "test: cover complete browser account and activity journey"
```

### Task 5: Final Verification

**Files:**
- Verify only; no source change.

- [ ] **Step 1: Run focused component tests**

Run: `npm exec vitest run tests/unit/ui/account-form.test.tsx tests/unit/ui/account-pages.test.tsx tests/unit/ui/create-activity-form.test.tsx tests/unit/ui/setup-form.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run static verification**

Run: `npm run lint && npm run typecheck && npm run build`

Expected: each command exits 0.

- [ ] **Step 3: Rebuild and verify the WSL test container**

Run: `wsl.exe -- bash -lc 'cd /mnt/d/code/HuddleTab && DATA_HOST_DIR=/home/linyue/.local/share/huddletab-test APP_BASE_URL=http://127.0.0.1:5660 BETTER_AUTH_URL=http://127.0.0.1:5660 BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:5660 docker compose up -d --build --force-recreate && docker compose ps'`

Expected: `app` and `postgres` both report healthy before the browser run.
