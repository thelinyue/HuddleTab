# HuddleTab Phase 6 Core UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the complete mobile-first HuddleTab core experience for activities, feed, quick expense entry, expense detail, settlement, members, more, notifications entry, and profile entry in the confirmed 清账青 light/dark visual system.

**Architecture:** App Router pages compose feature components; server data stays authoritative and client components own only form, filter, dialog, and optimistic visual state. The same mobile information architecture is centered and widened to 720–768px on larger screens; no desktop sidebar or second UI is introduced.

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui/Radix primitives, React Hook Form, Zod, Lucide, Vitest, Testing Library, Playwright.

---

## File responsibility map

```text
src/app/(product)/layout.tsx                              Signed-in top-level shell: 活动/通知/我的
src/app/(product)/activities/page.tsx                     Activity home composition
src/app/(product)/activities/[activityId]/layout.tsx      Activity header and 流水/结算/成员/更多 navigation
src/app/(product)/activities/[activityId]/*/page.tsx      Server page composition only
src/components/design-system/app-frame.tsx                Centered responsive width and safe-area insets
src/components/design-system/theme-provider.tsx           SYSTEM/LIGHT/DARK selection without IA changes
src/components/design-system/status-badge.tsx             Text+icon status, never color-only
src/features/activities/components/*                      Activity list, summary and activity navigation
src/features/expenses/components/*                        Feed, detail, quick-entry form and split editors
src/features/settlements/components/*                     Balances, recommendations, real-transfer form and warning dialog
src/features/members/components/*                         Member list, role/status display and allowed actions
src/features/me/components/theme-selector.tsx             Theme preference control
src/lib/api-client.ts                                     Typed same-origin JSON client and stable error decoding
tests/unit/ui/*.test.tsx                                  Component interaction and accessibility behavior
tests/e2e/core-ui/*.spec.ts                               Mobile, desktop, theme, keyboard and critical flows
```

## Visual and interaction invariants

- Use only semantic tokens from `design-system/huddletab/MASTER.md`; no component-local hex colors.
- Light and dark themes preserve identical hierarchy, labels, focus, disabled and warning semantics.
- Base body is 16px/1.5; amount text uses tabular numerals; touch targets are at least 44×44px and primary actions 48px high.
- Mobile Bottom Sheet becomes a centered Dialog at `md` without changing field order or submission behavior.
- Animations use shared 160/220/280ms tokens and are removed or reduced under `prefers-reduced-motion`.

### Task 1: Build the 清账青 theme and responsive application frame

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/components/design-system/theme-provider.tsx`
- Create: `src/components/design-system/app-frame.tsx`
- Create: `src/components/design-system/status-badge.tsx`
- Test: `tests/unit/ui/theme-and-frame.test.tsx`

- [ ] **Step 1: Write the failing theme/frame test**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { AppFrame } from "@/components/design-system/app-frame";
import { StatusBadge } from "@/components/design-system/status-badge";

test("核心容器居中加宽且状态不只依赖颜色", () => {
  render(<AppFrame><StatusBadge tone="warning" icon="sync">待同步</StatusBadge></AppFrame>);
  expect(screen.getByTestId("app-frame")).toHaveClass("max-w-3xl", "mx-auto");
  expect(screen.getByText("待同步")).toBeVisible();
  expect(screen.getByRole("img", { name: "同步状态" })).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/ui/theme-and-frame.test.tsx`

Expected: FAIL because the design-system components do not exist.

- [ ] **Step 3: Implement semantic themes and frame**

```css
/* src/app/globals.css */
:root { --background:#F6F8F7; --surface:#FFFFFF; --surface-muted:#EAF2EE; --foreground:#17211D; --muted-foreground:#56675F; --primary:#146B52; --on-primary:#FFFFFF; --border:#DCE5E0; --warning:#8A5510; --destructive:#C93636; --motion-fast:160ms; --motion-normal:220ms; --motion-overlay:280ms; }
.dark { --background:#0D1512; --surface:#14201B; --surface-muted:#1B2B24; --foreground:#F1F7F4; --muted-foreground:#A9BBB3; --primary:#5DD6A7; --on-primary:#062017; --border:#2A3B34; --warning:#F1B968; --destructive:#FF7B7B; }
* { border-color: var(--border); }
html { color-scheme: light; }
html.dark { color-scheme: dark; }
body { background:var(--background); color:var(--foreground); font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
:focus-visible { outline:2px solid var(--primary); outline-offset:2px; }
.amount { font-variant-numeric:tabular-nums; }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { scroll-behavior:auto!important; animation-duration:1ms!important; transition-duration:1ms!important; } }
```

```tsx
// src/components/design-system/app-frame.tsx
export function AppFrame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <main data-testid="app-frame" className={`mx-auto min-h-dvh w-full px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] sm:px-6 ${wide ? "max-w-[960px]" : "max-w-3xl"}`}>{children}</main>;
}
```

`ThemeProvider` reads `SYSTEM | LIGHT | DARK`, applies `.dark` before hydration with an inline bootstrap script, listens to `prefers-color-scheme` only for SYSTEM, and persists the authenticated preference through `/api/me/theme`. `StatusBadge` maps Lucide icons and renders visible text plus an icon with an accessible name.

- [ ] **Step 4: Run the test**

Run: `npm run test:unit -- tests/unit/ui/theme-and-frame.test.tsx`

Expected: PASS; no theme-dependent information disappears.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/components/design-system tests/unit/ui/theme-and-frame.test.tsx
git commit -m "feat: add HuddleTab responsive theme shell"
```

### Task 2: Add top-level and activity navigation without a desktop sidebar

**Files:**
- Create: `src/app/(product)/layout.tsx`
- Create: `src/components/design-system/bottom-navigation.tsx`
- Create: `src/features/activities/components/activity-navigation.tsx`
- Create: `src/app/(product)/activities/[activityId]/layout.tsx`
- Test: `tests/unit/ui/navigation.test.tsx`

- [ ] **Step 1: Write the failing navigation test**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { BottomNavigation } from "@/components/design-system/bottom-navigation";

test("一级导航只有活动、通知、我的，并提供当前项语义", () => {
  render(<BottomNavigation current="activities" unreadCount={3} />);
  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "活动" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: /通知，3 条未读/ })).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/ui/navigation.test.tsx`

Expected: FAIL because `BottomNavigation` is missing.

- [ ] **Step 3: Implement predictable navigation**

```tsx
const items = [{ id:"activities", href:"/activities", label:"活动", icon:Users }, { id:"notifications", href:"/notifications", label:"通知", icon:Bell }, { id:"me", href:"/me", label:"我的", icon:UserRound }] as const;
export function BottomNavigation({ current, unreadCount }: { current: string; unreadCount: number }) {
  return <nav aria-label="主导航" className="fixed inset-x-0 bottom-0 z-40 border-t bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] md:left-1/2 md:max-w-3xl md:-translate-x-1/2">
    <ul className="grid grid-cols-3">{items.map((item) => <li key={item.id}><Link href={item.href} aria-current={current===item.id?"page":undefined} aria-label={item.id==="notifications"&&unreadCount?`通知，${unreadCount} 条未读`:item.label} className="flex min-h-14 items-center justify-center gap-1 px-3 text-sm"><item.icon aria-hidden="true"/><span>{item.label}</span></Link></li>)}</ul>
  </nav>;
}
```

The activity layout hides this top-level bar and renders exactly `流水 | 结算 | 成员 | 更多` in `ActivityNavigation`. Each target is deep-linkable; browser Back remains functional. At wide breakpoints the bars keep the same structure and centered width rather than becoming a sidebar.

- [ ] **Step 4: Run the test**

Run: `npm run test:unit -- tests/unit/ui/navigation.test.tsx`

Expected: PASS; all links are at least 44px high and current state is announced.

- [ ] **Step 5: Commit**

```bash
git add src/app/(product)/layout.tsx src/app/(product)/activities/[activityId]/layout.tsx src/components/design-system/bottom-navigation.tsx src/features/activities/components/activity-navigation.tsx tests/unit/ui/navigation.test.tsx
git commit -m "feat: add mobile-first product navigation"
```

### Task 3: Implement the activity home and authoritative summaries

**Files:**
- Create: `src/app/(product)/activities/page.tsx`
- Create: `src/features/activities/api.ts`
- Create: `src/features/activities/components/activity-home.tsx`
- Create: `src/features/activities/components/activity-list-item.tsx`
- Test: `tests/unit/ui/activity-home.test.tsx`

- [ ] **Step 1: Write the failing grouping test**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ActivityHome } from "@/features/activities/components/activity-home";

test("跨活动应收应付不抵消，并按生命周期分组", () => {
  render(<ActivityHome data={{ payableMinor:"3000", receivableMinor:"5000", currency:"CNY",
    active:[{ id:"a", name:"杭州旅行", status:"ACTIVE", myNetMinor:"-3000" }], ended:[{ id:"b", name:"周末露营", status:"ENDED", myNetMinor:"5000" }], archived:[] }} />);
  expect(screen.getByText("待支付 ¥30.00")).toBeVisible();
  expect(screen.getByText("待收款 ¥50.00")).toBeVisible();
  expect(screen.getByRole("heading", { name:"进行中" })).toBeVisible();
  expect(screen.getByRole("heading", { name:"最近结束" })).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/ui/activity-home.test.tsx`

Expected: FAIL because activity home components do not exist.

- [ ] **Step 3: Implement the page and grouped list**

```tsx
export function ActivityHome({ data }: { data: ActivityHomeDto }) {
  return <AppFrame><header className="mb-8"><p className="text-sm text-[var(--muted-foreground)]">一起花，清楚分。</p><h1 className="text-3xl font-extrabold">活动</h1></header>
    <section aria-label="跨活动账务摘要" className="grid grid-cols-2 gap-3 rounded-2xl bg-[var(--surface-muted)] p-4">
      <p><span className="block text-sm">待支付</span><strong className="amount text-xl">{formatMoney(data.payableMinor,data.currency)}</strong></p>
      <p><span className="block text-sm">待收款</span><strong className="amount text-xl">{formatMoney(data.receivableMinor,data.currency)}</strong></p>
    </section>
    <ActivityGroup title="进行中" items={data.active}/><ActivityGroup title="最近结束" items={data.ended}/>{data.archived.length>0&&<ActivityGroup title="历史活动" items={data.archived}/>} </AppFrame>;
}
```

Each list row shows name, place/date when present, member count, lifecycle text and `应付/应收/已结清`; archived activities are collapsed behind an explicit “查看历史活动” control. Use whitespace/dividers, not one heavy card per row.

- [ ] **Step 4: Run the test**

Run: `npm run test:unit -- tests/unit/ui/activity-home.test.tsx`

Expected: PASS and payable/receivable remain separate.

- [ ] **Step 5: Commit**

```bash
git add src/app/(product)/activities/page.tsx src/features/activities/api.ts src/features/activities/components/activity-home.tsx src/features/activities/components/activity-list-item.tsx tests/unit/ui/activity-home.test.tsx
git commit -m "feat: add activity home UI"
```

### Task 4: Build feed filtering and Expense detail

**Files:**
- Create: `src/app/(product)/activities/[activityId]/page.tsx`
- Create: `src/app/(product)/activities/[activityId]/expenses/[expenseId]/page.tsx`
- Create: `src/features/expenses/api.ts`
- Create: `src/features/expenses/components/expense-feed.tsx`
- Create: `src/features/expenses/components/expense-list-item.tsx`
- Create: `src/features/expenses/components/expense-detail.tsx`
- Test: `tests/unit/ui/expense-feed.test.tsx`

- [ ] **Step 1: Write the failing feed test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ExpenseFeed } from "@/features/expenses/components/expense-feed";

test("流水只提供名称、固定分类和我参与的筛选", async () => {
  render(<ExpenseFeed activity={fixtureActivity()} expenses={[fixtureExpense({ title:"一兰拉面", category:"FOOD", originalAmountMinor:"6000", originalCurrency:"JPY" })]} />);
  expect(screen.getByRole("searchbox", { name:"搜索消费名称" })).toBeVisible();
  expect(screen.getByRole("button", { name:"餐饮" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name:"只看我参与的" })).toBeVisible();
  await userEvent.type(screen.getByRole("searchbox"), "拉面");
  expect(screen.getByText("一兰拉面")).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/ui/expense-feed.test.tsx`

Expected: FAIL because feed components do not exist.

- [ ] **Step 3: Implement feed and detail**

```tsx
export function ExpenseListItem({ expense }: { expense: ExpenseListDto }) {
  return <Link href={`expenses/${expense.id}`} className="block min-h-20 border-b py-3 focus-visible:rounded-xl">
    <div className="flex justify-between gap-4"><strong>{expense.title}</strong><strong className="amount">{formatMoney(expense.baseAmountMinor,expense.baseCurrency)}</strong></div>
    <p className="text-sm text-[var(--muted-foreground)]">{categoryLabel(expense.category)} · {expense.payerSummary} · {expense.participantCount} 人参与</p>
    <p className="text-sm text-[var(--muted-foreground)]">{expense.originalCurrency!==expense.baseCurrency?`${formatMoney(expense.originalAmountMinor,expense.originalCurrency)} · `:""}{formatRelativeTime(expense.occurredAt)}</p>
    <ExpenseStatuses value={expense.statuses}/>
  </Link>;
}
```

Feed top shows authoritative base-currency total and original-currency summary; Settlement rows never contribute. Group rows by date. Detail page shows all required payment, split, FX snapshot, attachment metadata, note, creator and timestamps. Its menu renders edit/delete only from server-provided `permissions.canUpdate/canDelete`; LEFT never sees either, even for self-created history.

- [ ] **Step 4: Run the test**

Run: `npm run test:unit -- tests/unit/ui/expense-feed.test.tsx`

Expected: PASS; statuses include visible text for 待同步/同步失败/已修改/有附件.

- [ ] **Step 5: Commit**

```bash
git add src/app/(product)/activities/[activityId]/page.tsx src/app/(product)/activities/[activityId]/expenses src/features/expenses/api.ts src/features/expenses/components tests/unit/ui/expense-feed.test.tsx
git commit -m "feat: add expense feed and detail UI"
```

### Task 5: Implement fast, complete Expense entry with progressive disclosure

**Files:**
- Create: `src/features/expenses/components/quick-expense-trigger.tsx`
- Create: `src/features/expenses/components/quick-expense-form.tsx`
- Create: `src/features/expenses/components/payment-editor.tsx`
- Create: `src/features/expenses/components/split-editor.tsx`
- Create: `src/features/expenses/components/responsive-form-overlay.tsx`
- Test: `tests/unit/ui/quick-expense-form.test.tsx`

- [ ] **Step 1: Write the failing default/preference test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { QuickExpenseForm } from "@/features/expenses/components/quick-expense-form";

test("默认只展示快速字段，展开后提供四种分摊和外币快照", async () => {
  render(<QuickExpenseForm activity={fixtureActivity()} members={fixtureMembers()} preference={{ lastCategory:"OTHER", recentParticipantIds:["m1","m2"], recentPayerIds:["m1"], recentCurrency:"CNY" }} onSaved={vi.fn()} />);
  expect(screen.getByLabelText("金额")).toBeVisible(); expect(screen.getByLabelText("用途")).toBeVisible();
  expect(screen.queryByLabelText("汇率")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name:"更多设置" }));
  expect(screen.getByRole("radiogroup", { name:"分摊方式" })).toBeVisible();
  expect(screen.getByRole("radio", { name:"均摊" })).toBeChecked();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/ui/quick-expense-form.test.tsx`

Expected: FAIL because quick-entry components are missing.

- [ ] **Step 3: Implement the form and responsive overlay**

```tsx
export function ResponsiveFormOverlay({ open, onOpenChange, title, children }: Props) {
  return <><div className="md:hidden"><Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto pb-[env(safe-area-inset-bottom)]"><SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>{children}</SheetContent></Sheet></div>
    <div className="hidden md:block"><Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>{children}</DialogContent></Dialog></div></>;
}
```

`QuickExpenseForm` uses React Hook Form plus the Phase 4 Zod schema. Default order is amount, title, payer, participants, more settings, save. Advanced section contains fixed category chips, multiple payment editor, EQUAL/EXACT/PERCENTAGE/WEIGHT editor, currency, precise rate string/source/time, occurred time, up to three attachment selectors, and note. It generates `clientMutationId` before the first submission and reuses it on network retry. All inputs have visible labels; failed submission keeps inline errors and focuses an error-summary link list. Online success closes, returns to feed, highlights the new row briefly, and announces `已记录「标题」金额`; it does not navigate to detail.

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit -- tests/unit/ui/quick-expense-form.test.tsx`

Expected: PASS for defaults, four modes, multi-payer conservation, manual-rate fallback, focusable error summary, and no draft save.

- [ ] **Step 5: Commit**

```bash
git add src/features/expenses/components/quick-expense-trigger.tsx src/features/expenses/components/quick-expense-form.tsx src/features/expenses/components/payment-editor.tsx src/features/expenses/components/split-editor.tsx src/features/expenses/components/responsive-form-overlay.tsx tests/unit/ui/quick-expense-form.test.tsx
git commit -m "feat: add quick expense entry UI"
```

### Task 6: Implement balances, recommendations, and actual Settlement confirmation UI

**Files:**
- Create: `src/app/(product)/activities/[activityId]/settlements/page.tsx`
- Create: `src/features/settlements/api.ts`
- Create: `src/features/settlements/components/settlement-page.tsx`
- Create: `src/features/settlements/components/settlement-form.tsx`
- Create: `src/features/settlements/components/over-settlement-dialog.tsx`
- Test: `tests/unit/ui/settlement-page.test.tsx`

- [ ] **Step 1: Write the failing recommendation/confirmation test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SettlementPage } from "@/features/settlements/components/settlement-page";

test("推荐只预填表单，超额需要明确二次确认", async () => {
  const api = vi.fn().mockRejectedValueOnce({ code:"OVER_SETTLEMENT_CONFIRMATION_REQUIRED", message:"本次支付比当前应付多 ¥73.50，保存后可能产生新的反向余额", details:{ overAmountMinor:"7350" } }).mockResolvedValueOnce({ settlement:{ id:"s1" } });
  render(<SettlementPage data={fixtureSettlementPage()} createSettlement={api} />);
  await userEvent.click(screen.getByRole("button", { name:/按建议记录/ }));
  expect(screen.getByLabelText("金额")).toHaveValue("326.50");
  await userEvent.clear(screen.getByLabelText("金额")); await userEvent.type(screen.getByLabelText("金额"), "400");
  await userEvent.click(screen.getByRole("button", { name:"确认已支付" }));
  expect(await screen.findByRole("alertdialog", { name:"确认超额结算" })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name:"仍然记录 ¥400.00" }));
  expect(api).toHaveBeenLastCalledWith(expect.objectContaining({ confirmOverSettlement:true }));
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/ui/settlement-page.test.tsx`

Expected: FAIL because settlement UI is missing.

- [ ] **Step 3: Implement separate recommendation and fact flows**

```tsx
<Button onClick={() => openForm({ payerMemberId: r.payerMemberId, receiverMemberId: r.receiverMemberId, amountMinor: r.amountMinor })}>按建议记录</Button>
```

The button above only opens `SettlementForm`; no request occurs until “确认已支付”. The form posts actual payer, receiver, base-currency amount, occurred time and note. On `OVER_SETTLEMENT_CONFIRMATION_REQUIRED`, show an accessible AlertDialog with server message, cancel, and explicit amount-bearing confirm button; retry with `confirmOverSettlement: true`. Display current balances, recommendation section, and separate actual Settlement history. ENDED permits recording according to server permissions; ARCHIVED/DELETED are read-only. When LEFT, payer is locked to self and receiver options include ACTIVE and LEFT accounting identities.

- [ ] **Step 4: Run the test**

Run: `npm run test:unit -- tests/unit/ui/settlement-page.test.tsx`

Expected: PASS; recommendation remains non-authoritative and server overage drives the warning.

- [ ] **Step 5: Commit**

```bash
git add src/app/(product)/activities/[activityId]/settlements src/features/settlements/api.ts src/features/settlements/components tests/unit/ui/settlement-page.test.tsx
git commit -m "feat: add settlement experience"
```

### Task 7: Add members, more, notification entry, and theme preference surfaces

**Files:**
- Create: `src/app/(product)/activities/[activityId]/members/page.tsx`
- Create: `src/app/(product)/activities/[activityId]/more/page.tsx`
- Create: `src/app/(product)/notifications/page.tsx`
- Create: `src/app/(product)/me/page.tsx`
- Create: `src/features/members/components/member-list.tsx`
- Create: `src/features/activities/components/activity-more.tsx`
- Create: `src/features/me/components/theme-selector.tsx`
- Test: `tests/unit/ui/supporting-pages.test.tsx`

- [ ] **Step 1: Write the failing role/status test**

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { MemberList } from "@/features/members/components/member-list";

test("成员列表同时显示角色和 LEFT 文本状态", () => {
  render(<MemberList members={[{ id:"m1", displayName:"小王", role:"MEMBER", status:"LEFT", memberType:"USER", permissions:{ canManage:false } }]} />);
  expect(screen.getByText("成员")).toBeVisible(); expect(screen.getByText("已退出" )).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `npm run test:unit -- tests/unit/ui/supporting-pages.test.tsx`

Expected: FAIL because supporting page components are absent.

- [ ] **Step 3: Implement the supporting surfaces**

Member list shows USER/GUEST identity, OWNER/ADMIN/MEMBER role, ACTIVE/LEFT status and only server-authorized actions. “更多” contains lifecycle actions, invitation, summary/export links and Audit entry according to permissions; destructive actions are visually separated and confirmed. Notifications page renders server notification rows and unread state when Phase 8 data is available; before Phase 8 it uses the real `/api/notifications` empty response, not sample data. “我的” shows nickname, username, real-email binding status, sessions, password, app version, logout and `ThemeSelector`; synthetic email is never rendered.

```tsx
export function ThemeSelector({ value, onChange }: { value:"SYSTEM"|"LIGHT"|"DARK"; onChange:(value:"SYSTEM"|"LIGHT"|"DARK")=>void }) {
  return <fieldset><legend className="mb-2 font-medium">主题</legend><div role="radiogroup" aria-label="主题">{[["SYSTEM","跟随系统"],["LIGHT","亮色"],["DARK","暗色"]].map(([id,label])=><label key={id} className="inline-flex min-h-11 items-center gap-2 px-3"><input type="radio" checked={value===id} onChange={()=>onChange(id as typeof value)}/>{label}</label>)}</div></fieldset>;
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit -- tests/unit/ui/supporting-pages.test.tsx`

Expected: PASS; role/status are textual, and theme has three keyboard-operable choices.

- [ ] **Step 5: Commit**

```bash
git add src/app/(product)/activities/[activityId]/members src/app/(product)/activities/[activityId]/more src/app/(product)/notifications src/app/(product)/me src/features/members/components src/features/activities/components/activity-more.tsx src/features/me/components/theme-selector.tsx tests/unit/ui/supporting-pages.test.tsx
git commit -m "feat: add member and account surfaces"
```

### Task 8: Verify responsive, accessible, light/dark critical paths

**Files:**
- Create: `tests/e2e/core-ui/quick-expense.spec.ts`
- Create: `tests/e2e/core-ui/accessibility-responsive.spec.ts`
- Create: `tests/e2e/core-ui/settlement.spec.ts`

- [ ] **Step 1: Write the E2E checks**

```ts
import { expect, test } from "@playwright/test";

test("small phone completes quick entry with visible focus and 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 }); await signInAndOpenActivity(page);
  await page.getByRole("button", { name:"记一笔" }).click();
  await page.getByLabel("金额").fill("286"); await page.getByLabel("用途").fill("海底捞晚餐");
  const save = page.getByRole("button", { name:"保存消费" }); expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await save.click(); await expect(page.getByText("已记录「海底捞晚餐」¥286.00")).toBeVisible();
});

test("desktop keeps mobile IA centered in light and dark themes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await signInAndOpenActivity(page);
  await expect(page.getByRole("navigation", { name:"活动导航" })).toContainText("流水结算成员更多");
  await expect(page.locator("[data-testid=app-frame]")).toHaveCSS("max-width", "768px");
  await page.emulateMedia({ colorScheme:"dark", reducedMotion:"reduce" });
  await page.reload(); await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name:"记一笔" })).toBeVisible();
});
```

- [ ] **Step 2: Run E2E and observe any failures**

Run: `npm run test:e2e -- tests/e2e/core-ui`

Expected: all critical paths pass on Chromium mobile and desktop projects; no horizontal scroll or obscured focus.

- [ ] **Step 3: Run automated accessibility assertions**

Add checks for icon-button accessible names, heading order, form labels, focus trap/restore, keyboard-only completion, warning text not color-only, and reduced-motion computed duration. Use Testing Library queries first; do not add screenshot-only approval as the main gate.

- [ ] **Step 4: Run the full Phase 6 gate**

Run: `npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:e2e && npm run build`

Expected: all commands exit 0 in both configured theme projects.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/core-ui src/app src/components/design-system src/features
git commit -m "test: verify core responsive UI"
```
