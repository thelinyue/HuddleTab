# 账单详情分字段编辑 Implementation Plan

> **For agentic workers:** Implement this single integrated task yourself. Do not dispatch subagents. Follow TDD: write focused failing tests, run them to confirm the expected failures, implement the smallest production change, then re-run focused and regression suites.

**Goal:** 将账单详情改造成可直接查看、分字段编辑和删除的轻量操作页，移除完整“编辑账单”入口。

**Architecture:** 保留现有完整 `PUT` 更新契约和 `version` 乐观锁；客户端从当前详情事实构建完整更新草稿，按字段打开 Sheet/Picker/Editor，保存后重新加载权威详情。移动端 Overlay 使用 `visualViewport` 适配软键盘，并通过固定头尾、滚动正文保证保存操作始终可见。

**Tech Stack:** Next.js 16.3、React 19、TypeScript、Radix UI、Tailwind CSS、Vitest、Testing Library、Playwright。

## Global Constraints

- 遵守仓库 `AGENTS.md`：关键类和非显然逻辑补充中文注释，面向用户的错误使用明确中文。
- 精准修改，不清理无关代码；不改变账单模型、权限、审计通知、结算逻辑、附件行为或离线更新策略。
- 不新增 HTTP PATCH；更新继续调用现有完整 `PUT` 并携带当前 `version`。
- 不支持账单跨活动移动；活动、参与成员摘要、创建人、创建时间均为只读。
- 分类图标只复用已提交的 `public/expense-categories/*.webp` 七张 512×512 插画；禁止重新生成、替换或修改这些资产。
- 有 Chevron 表示可操作或进入明细；无 Chevron 表示只读。
- 付款和分摊添加临时成员继续受现有成员管理权限与联网状态约束。
- 所有新行为必须先写会因功能缺失而失败的测试，并保留 RED/GREEN 命令与结果。

---

### Task 1: 实现账单详情分字段编辑完整体验

**Primary files:**
- Modify: `src/features/expenses/components/expense-detail.tsx`
- Create or modify focused field-editor components under `src/features/expenses/components/`
- Modify: `src/features/expenses/components/expense-loaders.tsx`
- Modify: `src/features/expenses/components/responsive-form-overlay.tsx`
- Modify: `src/features/expenses/components/expense-category-illustration.tsx`
- Remove or retire: `src/features/expenses/components/expense-edit-overlay.tsx`
- Update focused tests under `tests/unit/ui/` and `tests/unit/foundation/`; update relevant core UI E2E assertions if the old menu is referenced.

**Required internal interface:**

```ts
export type ExpenseEditTarget =
  | "TITLE"
  | "AMOUNT"
  | "OCCURRED_AT"
  | "CATEGORY"
  | "NOTE"
  | "PAYMENTS"
  | "SPLIT";
```

The implementation may choose focused component/file names, but must keep one coordinator for the active edit target and avoid restoring a global full-form editor.

#### Detail page behavior

- Replace the current card-heavy layout with the approved `Section + Row + Divider` hierarchy and retain the existing HuddleTab theme/tokens.
- Remove the header ellipsis, dropdown actions, pencil icons, global `onEdit`, and complete “编辑账单” Overlay.
- Make title and amount independent full-width text-region buttons with one quiet Chevron each; do not render input-like borders.
- Sections and exact behavior:
  - `消费信息`: `消费时间`, `分类`, `备注` are editable rows; `活动` is plain read-only text with no link and no Chevron.
  - `付款`: the payer breakdown is one editable region; `支付合计` is read-only; there is no duplicate `修改付款` row.
  - `分摊`: only `分摊方式` opens the SplitEditor; `参与成员` is avatar-only read-only summary; `查看分摊明细` remains a separate link to the existing read-only detail route.
  - `创建信息`: `创建人` and `创建时间` are low-emphasis read-only rows.
  - Existing attachment viewing remains unchanged.
- Put `删除账单` at the bottom after a divider as a red text action with no Chevron. Preserve the existing confirmation, loading, error retention, version check, navigation, and permission behavior. Update confirmation copy to include the bill amount and explain removal from activity flow and settlement results.
- Without update permission, all edit affordances disappear while read-only and split-detail navigation remain available. Delete visibility continues to use independent delete permission.

#### Field editor and update behavior

- Title: focused single-field Sheet, prefilled, explicit `保存`, required, max 120.
- Amount: focused Sheet with amount and currency/exchange facts as required by the current expense. Use `type="text"`, `inputMode="decimal"`, `enterKeyHint="done"`, and the existing currency precision parsing.
- Occurred time: datetime editor, explicit save, invalid input error beside field.
- Category: existing category Picker; selection immediately submits the complete update. Show pending/success/error feedback and do not silently replace the old value on failure.
- Note: textarea Sheet, explicit save, empty input stored as absent and displayed as `无`, max 2000.
- Payments: reuse the payer model and member Picker inside a focused `付款信息` editor. User changes are not submitted until `完成`.
- Split: reuse the four split modes and SplitEditor in a single `分摊设置` flow; participant selection lives only here.
- Extract/reuse conversion logic from the old editor so every field mutation sends a complete valid `UpdateExpenseRequest`, including a fresh client mutation ID and current `version`.
- After a successful update, re-fetch authoritative expense detail so payments, shares, derived amounts, permissions and version are current before another edit.
- Disable repeated submit and show `保存中…`/`更新中…` as appropriate.
- For validation and network errors keep the editor and draft open. For 409 keep the draft, show that another member changed the bill, and expose `查看最新内容`; never overwrite silently.

#### Financial coupling

- Amount change with one payer derives that payer amount from the new total.
- `EQUAL`, `PERCENTAGE`, and `WEIGHT` retain their split inputs and recalculate derived allocations.
- Multiple-payer totals must equal the new bill total before save.
- `EXACT` split entries must equal the new bill total before save.
- Changing participants in equal mode recalculates automatically.
- Changing participants in non-equal modes requires complete valid allocation values before `完成` is enabled.

#### Temporary members

- Both payer editor and SplitEditor contain `添加临时成员` using the existing `addGuestMember` API and nested form.
- Show the entry only with member-management permission; when offline keep it disabled and explain `当前离线，联网后可添加`.
- Creating a guest immediately adds it to the activity and is not rolled back if bill editing is cancelled.
- Single payer: the new guest becomes selected, returns to payer editing, and the user still presses `完成` to update the bill.
- Multiple payer: the new guest becomes selected with blank payment amount; completion is disabled until payment totals balance.
- Equal split: the new guest becomes selected and allocations recalculate.
- Other split modes: the new guest becomes selected, allocation is blank, and completion is disabled until valid.

#### Keyboard-responsive mobile Overlay

- Extend `ResponsiveFormOverlay` with a narrowly scoped keyboard-aware mode and a footer slot; do not duplicate overlay primitives.
- While an enabled mobile overlay is open, listen to `window.visualViewport` `resize` and `scroll` events and compute visible height plus keyboard bottom inset. Fall back to `100dvh` when unavailable.
- Keep header and footer as non-scrolling flex children; make the middle body `min-height: 0` and independently scrollable.
- Position the Sheet within the visual viewport so the sticky footer remains immediately above the soft keyboard. Do not apply duplicate bottom safe-area padding while the keyboard inset is non-zero.
- On focus/viewport resize, ensure the focused control remains within the scrollable visible body. Remove listeners on close/unmount.
- Preserve desktop Dialog behavior and existing non-keyboard-aware overlay behavior.

#### Category illustration reuse

- Replace the temporary Lucide mapping in `ExpenseCategoryIllustration` with the existing `expenseCategoryIllustrations` WebP mapping.
- Render the WebP as decorative (`alt=""`/hidden from accessibility tree); keep category names as HTML text.
- Reuse the same component in detail, feed/list, quick entry and Picker. Do not create or edit image assets.

#### Required TDD and verification

1. Add/update unit tests first and run them to record expected failures for:
   - detail editable vs read-only rows, unique payment/split entry points, split detail link and bottom deletion;
   - all field editor opening/prefill/save rules and complete PUT/version payloads;
   - category immediate save and WebP rendering;
   - financial coupling for single/multiple payer and all four split modes;
   - guest member creation, auto-selection, permission/offline/error behavior in payment and split flows;
   - keyboard-aware Overlay visual viewport listener lifecycle, computed inset/height, input mode, scroll body and visible footer;
   - network/validation/403/409/repeated-submit/focus-return behavior.
2. Confirm each focused test fails for the missing behavior before production edits.
3. Implement the smallest cohesive production changes and keep Chinese design comments on the coordinator, request builder and visual-viewport logic.
4. Run the focused UI/foundation tests until green.
5. Update and run relevant core UI E2E assertions that currently use the old `账单操作`/`编辑账单` flow.
6. Run at minimum:

```powershell
npm test -- --run tests/unit/ui/expense-detail.test.tsx tests/unit/ui/expense-detail-loader.test.tsx tests/unit/ui/quick-expense-form.test.tsx tests/unit/ui/responsive-form-overlay.test.tsx tests/unit/foundation/visual-assets.test.ts
npm run typecheck
npm run lint
```

7. Run any additional new focused test file explicitly. If the full unit suite is practical, run `npm run test:unit` before committing.
8. Self-review `git diff` for unrelated edits, missing Chinese user-facing errors, and any regenerated/changed category images.
9. Commit all implementation and tests on `codex/expense-field-editing` with a concise Chinese commit message.

