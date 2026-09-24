import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../api/error";
import type { ExpenseAggregate } from "./api";

const activity = vi.hoisted(() => ({
  activityId: "activity-1",
  allowedLifecycleActions: [],
  baseCurrency: "CNY",
  canDelete: false,
  currentMemberId: "member-1",
  currentMemberRole: "OWNER",
  endDate: null,
  fieldPermissions: { baseCurrency: false, endDate: false, location: false, name: false, startDate: false },
  hasAccountingRecords: true,
  location: null,
  name: "测试活动",
  ownerMemberId: "member-1",
  revision: "1",
  startDate: "2026-09-01",
  status: "ACTIVE",
  version: "7",
}));

const members = vi.hoisted(() => [
  { activityId: "activity-1", displayName: "甲", memberId: "member-1", role: "OWNER", status: "ACTIVE", userId: "user-1", version: "1" },
  { activityId: "activity-1", displayName: "乙", memberId: "member-2", role: "MEMBER", status: "ACTIVE", userId: "user-2", version: "1" },
] as const);

const expense = vi.hoisted(() => ({
  attachments: [{
    byteSize: "456",
    createdAt: "2026-09-02T01:00:00Z",
    height: 480,
    id: "attachment-1",
    mimeType: "image/webp",
    width: 640,
  }],
  expense: {
    activityId: "activity-1", baseAmountMinor: "1000", baseCurrency: "CNY", category: "FOOD", clientMutationId: "mutation-1", createdAt: "2026-09-01T08:00:00Z",
    exchangeRate: "1", exchangeRateKind: "IDENTITY", expenseId: "expense-1", note: "团队午餐",
    occurredAt: "2026-09-01T08:00:00Z", originalAmountMinor: "1000", originalCurrency: "CNY",
    revision: "1", splitMode: "EQUAL", title: "午餐", updatedAt: "2026-09-01T08:00:00Z", version: "3",
  },
  payments: [{ baseAmountMinor: "1000", factId: "payment-1", memberId: "member-1", originalAmountMinor: "1000" }],
  shares: [{ baseAmountMinor: "500", factId: "share-1", memberId: "member-1", originalAmountMinor: "500" }, { baseAmountMinor: "500", factId: "share-2", memberId: "member-2", originalAmountMinor: "500" }],
}));

const settlement = vi.hoisted(() => ({
  activityId: "activity-1", amountMinor: "500", clientMutationId: "settlement-mutation", createdAt: "2026-09-01T09:00:00Z",
  currency: "CNY", payerMemberId: "member-1", receiverMemberId: "member-2", revision: "1",
  settlementId: "settlement-1", status: "ACTIVE", updatedAt: "2026-09-01T09:00:00Z", version: "2", voidedAt: null, allocations: [],
}));

const mutation = vi.hoisted(() => () => ({ error: null, isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }));
const createMutation = vi.hoisted(() => ({
  error: null,
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
}));
const reviseMutation = vi.hoisted(() => ({
  error: null,
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
}));
const updateMutation = vi.hoisted(() => ({
  error: null as unknown,
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
}));
const deleteExpenseMutation = vi.hoisted(() => ({
  error: null as unknown,
  isPending: false,
  mutateAsync: vi.fn().mockResolvedValue(undefined),
}));
const discardMutation = vi.hoisted(() => ({
  error: null,
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
}));
const deleteAttachmentMutation = vi.hoisted(() => ({
  error: null as unknown,
  isPending: false,
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  variables: undefined as string | undefined,
}));
const uploadAttachmentMutation = vi.hoisted(() => ({
  error: null as unknown,
  isPending: false,
  mutateAsync: vi.fn().mockResolvedValue(undefined),
}));
const rateMutation = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn().mockResolvedValue({
    fromCurrency: "JPY", toCurrency: "CNY", rate: "0.04209",
    source: "PROVIDER", provider: "FRANKFURTER", referenceDate: "2026-08-30",
  }),
}));
const pendingMutations = vi.hoisted(() => ({ records: [] as Array<Record<string, unknown>> }));
const workspaceState = vi.hoisted(() => ({ offline: false, snapshotOnly: false }));
const readonlyExpenseState = vi.hoisted(() => ({ data: undefined as (typeof expense & { settlementProgress?: ExpenseAggregate["settlementProgress"] }) | undefined }));
const aiCapability = vi.hoisted(() => ({ textDraftAvailable: false }));
const aiCapabilityQuery = vi.hoisted(() => vi.fn());
const aiTextDraftMutation = vi.hoisted(() => vi.fn());
const accountingQueryState = vi.hoisted(() => ({ emptyExpenses: false, emptySettlements: false, netMinor: '-500', ledgerPending: false, ledgerError: undefined as Error | undefined }));
const guestMutation = vi.hoisted(() => ({
  error: null,
  isPending: false,
  mutateAsync: vi.fn().mockImplementation(async (displayName: string) => ({
    activityId: "activity-1",
    displayName,
    memberId: `guest-${displayName}`,
    role: "MEMBER",
    status: "ACTIVE",
    version: "1",
  })),
}));

vi.mock("../activities/workspace-context", () => ({
  useWorkspace: () => ({
    activity,
    offline: workspaceState.offline,
    snapshot: workspaceState.snapshotOnly ? { snapshot: { expenses: [expense] } } : undefined,
    session: { displayName: "测试用户", userId: "user-1", username: "tester" },
  }),
}));

vi.mock("../activities/api", () => ({
  useCreateGuestMutation: () => guestMutation,
  useMembersQuery: () => ({ data: members, isPending: false }),
}));

vi.mock("./api", () => ({
  useCreateExpenseMutation: () => createMutation,
  useReviseRejectedExpenseMutation: () => reviseMutation,
  useDiscardPendingExpenseMutation: () => discardMutation,
  useCreateSettlementMutation: mutation,
  useDeleteExpenseMutation: () => deleteExpenseMutation,
  useDeleteAttachmentMutation: () => deleteAttachmentMutation,
  useUploadAttachmentMutation: () => uploadAttachmentMutation,
  useExpenseQuery: () => ({ data: readonlyExpenseState.data ?? expense, isPending: false }),
  useExchangeRateSuggestionMutation: () => rateMutation,
  useAiCapabilityQuery: (...args: unknown[]) => { aiCapabilityQuery(...args); return { data: aiCapability, isPending: false, error: null }; },
  createAiTextDraft: (...args: unknown[]) => aiTextDraftMutation(...args),
  useExpensesQuery: () => ({ data: workspaceState.snapshotOnly ? undefined : accountingQueryState.emptyExpenses ? [] : [expense], isPending: false }),
  useLedgerQuery: () => ({ data: accountingQueryState.ledgerPending ? undefined : { balances: [{ memberId: "member-1", netMinor: accountingQueryState.netMinor }, { memberId: "member-2", netMinor: String(-BigInt(accountingQueryState.netMinor)) }] }, isPending: accountingQueryState.ledgerPending, error: accountingQueryState.ledgerError }),
  useRecommendationsQuery: () => ({ data: { recommendations: [{ payerMemberId: "member-1", receiverMemberId: "member-2", amountMinor: "500" }] }, isPending: false }),
  useSettlementsQuery: () => ({ data: accountingQueryState.emptySettlements ? [] : [settlement], isPending: false }),
  useUpdateExpenseMutation: () => updateMutation,
  useUpdateSettlementMutation: mutation,
  useVoidSettlementMutation: mutation,
}));

vi.mock("./expense-queue-sync", () => ({
  usePendingExpenseMutations: () => ({
    data: pendingMutations.records,
    error: null,
    isPending: false,
  }),
}));

import { ExpenseDetailPage, NewExpensePage, UnifiedExpenseEditor } from "./expense-editor";
import { ExpenseFeedPage } from "./feed-page";
import { ActivityViewProvider } from "../activities/activity-view-state";
import { FeedFilterProvider } from "./feed-filter-context";
import { SettlementsPage } from "./settlement-page";

function renderPage(node: ReactNode, initialEntries?: string[]) {
  return render(<MemoryRouter initialEntries={initialEntries}>{node}</MemoryRouter>, { wrapper: ({ children }) => <ActivityViewProvider><FeedFilterProvider>{children}</FeedFilterProvider></ActivityViewProvider> });
}

function openNoteView(container: HTMLElement = document.body) {
  fireEvent.click(within(container).getByRole("button", { name: /^备注：/ }));
  return screen.queryByRole("dialog", { name: "备注与图片" })
    ?? screen.getByRole("region", { name: "备注与图片" });
}

function chooseCurrency(code: string) {
  fireEvent.click(screen.getByRole("button", { name: /^币种：/ }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${code}`) }));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
});

afterEach(() => {
  cleanup();
  activity.activityId = "activity-1";
  activity.status = "ACTIVE";
  pendingMutations.records = [];
  workspaceState.offline = false;
  workspaceState.snapshotOnly = false;
  readonlyExpenseState.data = undefined;
  aiCapability.textDraftAvailable = false;
  aiCapabilityQuery.mockClear();
  aiTextDraftMutation.mockReset();
  accountingQueryState.emptyExpenses = false;
  accountingQueryState.emptySettlements = false;
  accountingQueryState.netMinor = '-500';
  accountingQueryState.ledgerPending = false;
  accountingQueryState.ledgerError = undefined;
  createMutation.mutateAsync.mockClear();
  reviseMutation.mutateAsync.mockClear();
  updateMutation.error = null;
  updateMutation.mutateAsync.mockReset();
  updateMutation.mutateAsync.mockResolvedValue(undefined);
  deleteExpenseMutation.error = null;
  deleteExpenseMutation.mutateAsync.mockReset();
  deleteExpenseMutation.mutateAsync.mockResolvedValue(undefined);
  discardMutation.mutateAsync.mockClear();
  deleteAttachmentMutation.mutateAsync.mockClear();
  deleteAttachmentMutation.error = null;
  uploadAttachmentMutation.mutateAsync.mockClear();
  uploadAttachmentMutation.error = null;
  rateMutation.mutateAsync.mockClear();
  guestMutation.mutateAsync.mockClear();
  vi.restoreAllMocks();
});

describe("Expense 参考汇率", () => {
  it("只在点击后填入建议，手工修改立即清除自动来源", async () => {
    renderPage(<NewExpensePage />);
    chooseCurrency("JPY");
    fireEvent.click(screen.getByRole("button", { name: "获取参考汇率" }));

    await waitFor(() => expect(rateMutation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByPlaceholderText("例如 7.25")).toHaveValue("0.04209");
    expect(screen.getByText("Frankfurter 参考汇率 · 2026-08-30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成" }).parentElement).toHaveClass("quick-expense-action-dock");

    fireEvent.change(screen.getByPlaceholderText("例如 7.25"), { target: { value: "0.043" } });
    expect(screen.queryByText(/Frankfurter 参考汇率/)).not.toBeInTheDocument();
  });

  it("Provider 失败时保留金额、币种与手工输入", async () => {
    rateMutation.mutateAsync.mockRejectedValueOnce(new Error("upstream"));
    renderPage(<NewExpensePage />);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "123" } });
    chooseCurrency("JPY");
    fireEvent.change(screen.getByPlaceholderText("例如 7.25"), { target: { value: "0.041" } });
    fireEvent.click(screen.getByRole("button", { name: "获取参考汇率" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法获取参考汇率，请手动输入。");
    expect(screen.getByPlaceholderText("例如 7.25")).toHaveValue("0.041");
    fireEvent.click(screen.getByRole("button", { name: "返回选择币种" }));
    fireEvent.click(screen.getByRole("button", { name: "返回记一笔" }));
    expect(screen.getByPlaceholderText("0.00")).toHaveValue("123");
    expect(screen.getByRole("button", { name: /^币种：/ })).toHaveTextContent("JPY");
  });

  it("主表单修改时间后清除过期参考汇率", async () => {
    renderPage(<NewExpensePage />);
    chooseCurrency("JPY");
    fireEvent.click(screen.getByRole("button", { name: "获取参考汇率" }));
    await waitFor(() => expect(screen.getByText("Frankfurter 参考汇率 · 2026-08-30")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "完成" }));

    fireEvent.change(screen.getByLabelText("时间"), { target: { value: "2026-09-08T12:30" } });
    fireEvent.change(screen.getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("用途"), { target: { value: "时间变化" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByRole("region", { name: "设置汇率" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例如 7.25")).toHaveValue("");
    expect(screen.queryByText(/Frankfurter 参考汇率/)).not.toBeInTheDocument();
  });
});

describe("人均消费说明", () => {
  const message = "人均消费仅为统计平均值，不代表任何成员实际应承担金额。";

  it("流水标题栏提供搜索和筛选入口，搜索默认收起", () => {
    renderPage(<ExpenseFeedPage />);

    expect(screen.queryByRole("link", { name: /活动统计/ })).not.toBeInTheDocument();
    const filter = screen.getByRole("button", { name: /^筛选$/ });
    expect(filter.parentElement).toHaveClass("expense-feed-section__actions");
    expect(screen.getByRole("button", { name: "搜索" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("textbox", { name: "搜索用途或备注" })).not.toBeInTheDocument();
  });

  it("点击后显示完整说明，Escape 关闭并恢复触发器焦点", async () => {
    renderPage(<ExpenseFeedPage />);
    const trigger = screen.getByRole("button", { name: "人均消费说明" });

    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(message)).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(message)).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("支持使用 Enter 键打开说明", async () => {
    const user = userEvent.setup();
    renderPage(<ExpenseFeedPage />);
    const trigger = screen.getByRole("button", { name: "人均消费说明" });
    trigger.focus();

    await user.keyboard("{Enter}");

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(message)).toBeVisible();
  });
});

describe("快捷记账 v0.0.2 信息路径", () => {
  async function openQuickExpense() {
    renderPage(<ExpenseFeedPage />);
    const trigger = screen.getByRole("button", { name: "记一笔" });
    expect(trigger).toHaveClass("activity-floating-action--manual", "quick-expense-trigger");
    expect(trigger).toHaveAttribute("title", "记一笔");
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "记一笔" });
    await within(dialog).findByLabelText("金额");
    return { trigger, dialog };
  }

  it("根表单直接提供时间选择、独立备注入口和悬浮保存按钮", async () => {
    const { dialog } = await openQuickExpense();
    await waitFor(() => expect(within(dialog).getByLabelText("金额")).toBeInTheDocument());
    const labels = [...dialog.querySelectorAll(".quick-expense-field-button__label")]
      .map((element) => element.textContent);
    expect(labels).toEqual(["付款人", "时间", "参与人", "备注"]);
    const categoryButton = within(dialog).getByRole("button", { name: "分类：餐饮" });
    expect(categoryButton).toHaveTextContent("餐饮");
    const categoryImage = categoryButton.querySelector(".quick-expense-value-button__image");
    expect(categoryImage).toHaveAttribute("src", "/expense-categories/food.webp");
    expect(categoryImage).toHaveAttribute("width", "34");
    expect(categoryImage).toHaveAttribute("height", "34");
    expect(categoryButton.querySelector(".quick-expense-value-button__content")).toBeInTheDocument();
    const splitButton = within(dialog).getByRole("button", { name: "分摊设置：均摊" });
    expect(splitButton).toHaveTextContent("均摊");
    expect(within(dialog).getByRole("button", { name: "币种：CNY" })).toHaveTextContent("CNY");
    expect(dialog.querySelector(".quick-expense-amount > small:not(.quick-expense-field-error)")).toHaveTextContent("金额");
    const fieldGrid = dialog.querySelector(".quick-expense-grid");
    const purposeInput = within(dialog).getByLabelText("用途");
    const payerButton = within(dialog).getByRole("button", { name: /^付款人：/ });
    const timeInput = within(dialog).getByLabelText("时间");
    const participantButton = within(dialog).getByRole("button", { name: /^参与人：/ });
    expect(fieldGrid).not.toBeNull();
    expect(fieldGrid!.children).toHaveLength(6);
    expect(fieldGrid!.children[0]).toBe(categoryButton);
    expect(fieldGrid!.children[1]).toContainElement(purposeInput);
    expect(fieldGrid!.children[2]).toBe(payerButton);
    expect(fieldGrid!.children[3]).toContainElement(timeInput);
    expect(fieldGrid!.children[4]).toContainElement(participantButton);
    expect(fieldGrid!.children[5]).toBe(splitButton);
    expect(timeInput).toHaveAttribute("type", "datetime-local");
    expect(timeInput.parentElement).toHaveClass("quick-expense-time-picker");
    expect(timeInput.parentElement).toHaveTextContent(/^时间今天 /);
    expect(within(dialog).queryByRole("button", { name: /^时间：/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "更多设置" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "保存" }).parentElement).toHaveClass("quick-expense-action-dock");
    expect(within(dialog).getByLabelText("金额")).toHaveValue("");
    expect(within(dialog).getByLabelText("金额")).toHaveAttribute("data-overlay-initial-focus", "true");
    expect(within(dialog).getByLabelText("用途")).toHaveValue("");
  });

  it("子视图使用动态标题，Back 保持草稿并把焦点还给原入口，Close 后焦点回到 FAB", async () => {
    const { trigger, dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "晚餐" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^付款人：/ }));

    const payerDialog = screen.getByRole("dialog", { name: "付款人" });
    expect(within(payerDialog).getByRole("button", { name: "关闭付款人" })).toBeInTheDocument();
    fireEvent.click(within(payerDialog).getByRole("button", { name: "记一笔" }));

    const rootDialog = screen.getByRole("dialog", { name: "记一笔" });
    expect(within(rootDialog).getByLabelText("金额")).toHaveValue("100");
    expect(within(rootDialog).getByLabelText("用途")).toHaveValue("晚餐");
    await waitFor(() => expect(document.activeElement).toBe(within(rootDialog).getByRole("button", { name: /^付款人：/ })));
    fireEvent.click(within(rootDialog).getByRole("button", { name: "关闭记一笔" }));
    expect(screen.queryByRole("dialog", { name: "记一笔" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("备注子视图使用中文附件入口并沿用悬浮操作 Dock", async () => {
    const { dialog } = await openQuickExpense();
    expect(within(dialog).getByRole("button", { name: "保存" }).parentElement).toHaveClass("quick-expense-action-dock");
    const noteDialog = openNoteView(dialog);
    expect(within(noteDialog).getByText("添加图片")).toBeInTheDocument();
    expect(within(noteDialog).getByText("未添加图片")).toBeInTheDocument();
    expect(within(noteDialog).getByLabelText("图片（最多三张）")).toHaveAttribute("accept", ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp");
    expect(within(noteDialog).getByRole("button", { name: "完成" }).parentElement).toHaveClass("quick-expense-action-dock");
  });

  it("参与人确认、分类和币种确认都回到根表单并保留其他字段", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^参与人：/ }));
    const participantDialog = screen.getByRole("dialog", { name: "参与人" });
    fireEvent.click(within(participantDialog).getByRole("checkbox", { name: "乙" }));
    const participantDone = within(participantDialog).getByRole("button", { name: "完成" });
    expect(participantDone.parentElement).toHaveClass("quick-expense-action-dock");
    fireEvent.click(participantDone);
    const rootAfterParticipants = screen.getByRole("dialog", { name: "记一笔" });
    expect(within(rootAfterParticipants).getByRole("button", { name: /^参与人：/ })).toHaveTextContent("1 人");

    fireEvent.click(within(rootAfterParticipants).getByRole("button", { name: /^分类：/ }));
    const categoryDialog = screen.getByRole("dialog", { name: "分类" });
    fireEvent.click(within(categoryDialog).getByRole("radio", { name: "交通" }));
    const rootAfterCategory = screen.getByRole("dialog", { name: "记一笔" });
    expect(within(rootAfterCategory).getByRole("button", { name: /^分类：/ })).toHaveTextContent("交通");

    fireEvent.click(within(rootAfterCategory).getByRole("button", { name: /^币种：/ }));
    const currencyDialog = screen.getByRole("dialog", { name: "选择币种" });
    fireEvent.change(within(currencyDialog).getByPlaceholderText("搜索币种"), { target: { value: "USD" } });
    fireEvent.click(within(currencyDialog).getByRole("button", { name: /USD/ }));
    expect(screen.getByRole("dialog", { name: "设置汇率" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("例如 7.25"), { target: { value: "7.25" } });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(within(screen.getByRole("dialog", { name: "记一笔" })).getByRole("button", { name: /^币种：/ })).toHaveTextContent("USD");
  });

  it("多人付款严格校验守恒，提交时传递每个付款人的最小单位金额", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "多人晚餐" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^付款人：/ }));
    const payerDialog = screen.getByRole("dialog", { name: "付款人" });
    fireEvent.click(within(payerDialog).getByRole("button", { name: "多人付款" }));
    fireEvent.click(within(payerDialog).getByRole("checkbox", { name: "乙" }));
    const payerDone = within(payerDialog).getByRole("button", { name: "完成" });
    expect(payerDone.parentElement).toHaveClass("quick-expense-action-dock");
    expect(payerDone).toBeDisabled();
    expect(within(payerDialog).getByText("已分配 ¥0.00 / ¥100.00")).toBeInTheDocument();
    fireEvent.change(within(payerDialog).getByLabelText("甲付款金额"), { target: { value: "60" } });
    fireEvent.change(within(payerDialog).getByLabelText("乙付款金额"), { target: { value: "40" } });
    expect(payerDone).toBeEnabled();
    fireEvent.click(payerDone);
    const rootDialog = screen.getByRole("dialog", { name: "记一笔" });
    fireEvent.click(within(rootDialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(createMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        payments: [
          { memberId: "member-1", amountMinor: "6000" },
          { memberId: "member-2", amountMinor: "4000" },
        ],
      }),
      files: [],
    })));
  });

  it("精确分摊实时显示守恒汇总，参与人变更会重新生成有效起点", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^分摊设置：/ }));
    const splitDialog = screen.getByRole("dialog", { name: "分摊设置" });
    fireEvent.click(within(splitDialog).getByRole("radio", { name: "按金额" }));
    fireEvent.change(within(splitDialog).getByLabelText("甲按金额"), { target: { value: "60" } });
    fireEvent.change(within(splitDialog).getByLabelText("乙按金额"), { target: { value: "40" } });
    expect(splitDialog).toHaveTextContent(/已分配\s*¥100\.00\s*·\s*差额\s*¥0\.00/);
    fireEvent.change(within(splitDialog).getByLabelText("乙按金额"), { target: { value: "" } });
    fireEvent.click(within(splitDialog).getByRole("button", { name: "填入剩余金额" }));
    expect(within(splitDialog).getByLabelText("乙按金额")).toHaveValue("40.00");
    fireEvent.click(within(splitDialog).getByRole("button", { name: "完成" }));
    const rootDialog = screen.getByRole("dialog", { name: "记一笔" });
    fireEvent.click(within(rootDialog).getByRole("button", { name: /^参与人：/ }));
    const participantDialog = screen.getByRole("dialog", { name: "参与人" });
    fireEvent.click(within(participantDialog).getByRole("checkbox", { name: "乙" }));
    fireEvent.click(within(participantDialog).getByRole("button", { name: "完成" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "记一笔" })).getByRole("button", { name: /^分摊设置：/ }));
    const resetSplitDialog = screen.getByRole("dialog", { name: "分摊设置" });
    expect(within(resetSplitDialog).getByLabelText("甲按金额")).toHaveValue("100.00");
  });

  it("按份数从一开始使用整数步进，按比例显示百分号并隐藏全局平均操作", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^分摊设置：/ }));
    const splitDialog = screen.getByRole("dialog", { name: "分摊设置" });
    fireEvent.click(within(splitDialog).getByRole("radio", { name: "按份数" }));

    const weightInput = within(splitDialog).getByLabelText("甲按份数");
    const decrement = within(splitDialog).getByRole("button", { name: "减少甲的份数" });
    const increment = within(splitDialog).getByRole("button", { name: "增加甲的份数" });
    expect(weightInput).toHaveValue("1");
    expect(decrement).toBeEnabled();
    fireEvent.click(increment);
    expect(weightInput).toHaveValue("2");
    fireEvent.click(decrement);
    expect(weightInput).toHaveValue("1");
    fireEvent.change(weightInput, { target: { value: "1.25" } });
    expect(within(splitDialog).getByRole("button", { name: "完成" })).toBeDisabled();
    fireEvent.change(weightInput, { target: { value: "1" } });
    expect(within(splitDialog).getByRole("button", { name: "完成" })).toBeEnabled();
    expect(within(splitDialog).getByRole("button", { name: "完成" }).parentElement).toHaveClass("quick-expense-action-dock");

    fireEvent.click(within(splitDialog).getByRole("radio", { name: "按比例" }));
    expect(within(splitDialog).getByLabelText("甲按比例")).toHaveValue("50");
    expect(within(splitDialog).getAllByText("%", { selector: ".quick-weight-stepper__unit" })).toHaveLength(2);
    expect(within(splitDialog).getByLabelText("甲按比例")).toHaveAttribute("placeholder", "0");
    expect(within(splitDialog).getByLabelText("乙按比例")).toHaveAttribute("placeholder", "0");
    expect(within(splitDialog).queryByRole("button", { name: "平均分配" })).not.toBeInTheDocument();
    expect(within(splitDialog).queryByRole("button", { name: "平均份数" })).not.toBeInTheDocument();
    fireEvent.change(within(splitDialog).getByLabelText("乙按比例"), { target: { value: "" } });
    fireEvent.click(within(splitDialog).getByRole("button", { name: "分配剩余比例" }));
    expect(within(splitDialog).getByLabelText("乙按比例")).toHaveValue("50");
  });

  it("Owner 在线可添加临时成员，离线时添加入口禁用", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.click(within(dialog).getByRole("button", { name: /^付款人：/ }));
    const payerDialog = screen.getByRole("dialog", { name: "付款人" });
    fireEvent.click(within(payerDialog).getByRole("button", { name: "添加临时成员" }));
    const guestDialog = screen.getByRole("dialog", { name: "添加临时成员" });
    fireEvent.change(within(guestDialog).getByLabelText("临时成员昵称"), { target: { value: "临时甲" } });
    const confirmGuest = within(guestDialog).getByRole("button", { name: "确认添加" });
    expect(confirmGuest.parentElement).toHaveClass("quick-expense-action-dock");
    fireEvent.click(confirmGuest);
    expect(await screen.findByRole("dialog", { name: "记一笔" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "记一笔" })).getByRole("button", { name: /^付款人：/ })).toHaveTextContent("临时甲");

    workspaceState.offline = true;
    cleanup();
    const offline = await openQuickExpense();
    fireEvent.click(within(offline.dialog).getByRole("button", { name: /^付款人：/ }));
    expect(within(screen.getByRole("dialog", { name: "付款人" })).getByRole("button", { name: "添加临时成员" })).toBeDisabled();
  });

  it("金额为空时就地展示错误并把焦点交给金额输入", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("金额不能为空");
    expect(document.activeElement).toBe(within(dialog).getByLabelText("金额"));
  });

  it("金额格式错误仍定位到金额字段", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "1.234" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "格式校验" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("金额小数位超过币种精度");
    expect(document.activeElement).toBe(within(dialog).getByLabelText("金额"));
  });

  it("提交时付款守恒失败会回到付款子视图并保留错误", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "付款校验" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^付款人：/ }));
    const payerDialog = screen.getByRole("dialog", { name: "付款人" });
    fireEvent.click(within(payerDialog).getByRole("button", { name: "多人付款" }));
    fireEvent.click(within(payerDialog).getByRole("checkbox", { name: "乙" }));
    fireEvent.change(within(payerDialog).getByLabelText("甲付款金额"), { target: { value: "60" } });
    fireEvent.change(within(payerDialog).getByLabelText("乙付款金额"), { target: { value: "40" } });
    fireEvent.click(within(payerDialog).getByRole("button", { name: "完成" }));
    const rootDialog = screen.getByRole("dialog", { name: "记一笔" });
    fireEvent.change(within(rootDialog).getByLabelText("金额"), { target: { value: "99" } });
    fireEvent.click(within(rootDialog).getByRole("button", { name: "保存" }));

    const invalidPayerDialog = await screen.findByRole("dialog", { name: "付款人" });
    expect(within(invalidPayerDialog).getByRole("alert")).toHaveTextContent("付款合计必须等于消费金额");
  });

  it("提交时分摊守恒失败会回到分摊子视图并保留错误", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "分摊校验" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^分摊设置：/ }));
    const splitDialog = screen.getByRole("dialog", { name: "分摊设置" });
    fireEvent.click(within(splitDialog).getByRole("radio", { name: "按金额" }));
    fireEvent.change(within(splitDialog).getByLabelText("甲按金额"), { target: { value: "60" } });
    fireEvent.change(within(splitDialog).getByLabelText("乙按金额"), { target: { value: "40" } });
    fireEvent.click(within(splitDialog).getByRole("button", { name: "完成" }));
    const rootDialog = screen.getByRole("dialog", { name: "记一笔" });
    fireEvent.change(within(rootDialog).getByLabelText("金额"), { target: { value: "99" } });
    fireEvent.click(within(rootDialog).getByRole("button", { name: "保存" }));

    const invalidSplitDialog = await screen.findByRole("dialog", { name: "分摊设置" });
    expect(within(invalidSplitDialog).getByRole("alert")).toHaveTextContent("指定金额合计必须等于消费总额");
  });
});

describe("统一账单编辑器", () => {
  it("修改页沿用新增字段顺序，并从付款与分摊事实无损回填", () => {
    renderPage(<ExpenseDetailPage />);

    expect(screen.getByRole("heading", { name: "修改账单" })).toBeInTheDocument();
    expect([...document.querySelectorAll(".quick-expense-field-button__label")]
      .map((element) => element.textContent))
      .toEqual(["付款人", "时间", "参与人", "备注"]);
    expect(screen.getByLabelText("金额")).toHaveValue("10.00");
    expect(screen.getByLabelText("用途")).toHaveValue("午餐");
    expect(screen.getByRole("button", { name: /^付款人：/ })).toHaveTextContent("甲");
    expect(screen.getByRole("button", { name: /^参与人：/ })).toHaveTextContent("2 人");
    expect(screen.getByRole("button", { name: /^分摊设置：/ })).toHaveTextContent("均摊");

    fireEvent.click(screen.getByRole("button", { name: /^付款人：/ }));
    expect(screen.getByRole("radio", { name: "甲" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "返回修改账单" }));
    fireEvent.click(screen.getByRole("button", { name: /^参与人：/ }));
    expect(screen.getByRole("checkbox", { name: "甲" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "乙" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "返回修改账单" }));
    fireEvent.click(screen.getByRole("button", { name: /^分摊设置：/ }));
    expect(screen.getByRole("radio", { name: "均摊" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByLabelText("甲按金额")).not.toBeInTheDocument();
  });

  it("未改动事实时保存携带原版本、mutation id、付款与均摊模式", async () => {
    renderPage(<ExpenseDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      version: "3",
      clientMutationId: "mutation-1",
      originalAmountMinor: "1000",
      payments: [{ memberId: "member-1", amountMinor: "1000" }],
      split: { mode: "EQUAL", members: ["member-1", "member-2"] },
    })));
  });

  it("备注子视图返回后保留输入并更新摘要", () => {
    renderPage(<NewExpensePage />);
    openNoteView();
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "保留这段备注" } });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByRole("button", { name: "备注：保留这段备注" })).toBeInTheDocument();
    openNoteView();
    expect(screen.getByLabelText("备注")).toHaveValue("保留这段备注");
  });

  it("409 冲突显示保留提示且不清空当前草稿", async () => {
    const conflict = new ApiRequestError(409, {
      error: { code: "VERSION_CONFLICT", details: {}, fieldErrors: {}, message: "账单版本冲突。", requestId: "request-409" },
    });
    updateMutation.error = conflict;
    updateMutation.mutateAsync.mockRejectedValue(conflict);
    renderPage(<ExpenseDetailPage />);
    fireEvent.change(screen.getByLabelText("用途"), { target: { value: "仍保留的午餐草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalled());
    expect(screen.getByText(/当前表单仍保留/)).toBeInTheDocument();
    expect(screen.getByLabelText("用途")).toHaveValue("仍保留的午餐草稿");
  });
});

describe("流水内修改账单 Sheet", () => {
  async function openExpenseEditor() {
    renderPage(<ExpenseFeedPage />, ["/activities/activity-1"]);
    const expenseLink = screen.getByRole("link", { name: /午餐/ });
    expenseLink.focus();
    fireEvent.click(expenseLink);
    return { expenseLink, dialog: await screen.findByRole("dialog", { name: "修改账单" }) };
  }

  it("保留流水上下文、复用完整表单，并从子视图返回修改任务", async () => {
    const { expenseLink, dialog } = await openExpenseEditor();

    expect(screen.getByRole("heading", { name: "全部流水" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("金额")).toHaveValue("10.00");
    expect(within(dialog).getByLabelText("用途")).toHaveValue("午餐");
    expect(within(dialog).getByRole("button", { name: "删除账单" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /^付款人：/ }));
    const payerDialog = screen.getByRole("dialog", { name: "付款人" });
    fireEvent.click(within(payerDialog).getByRole("button", { name: "修改账单" }));
    expect(screen.getByRole("dialog", { name: "修改账单" })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("dialog", { name: "修改账单" })).getByRole("button", { name: "关闭修改账单" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "修改账单" })).not.toBeInTheDocument());
    expect(expenseLink).toHaveFocus();
  });

  it("保存成功后关闭 Sheet 并沿用原账单版本", async () => {
    const { dialog } = await openExpenseEditor();
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "修改后的午餐" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      title: "修改后的午餐",
      version: "3",
    })));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "修改账单" })).not.toBeInTheDocument());
  });

  it("删除继续二次确认，成功后关闭 Sheet", async () => {
    const { dialog } = await openExpenseEditor();
    fireEvent.click(within(dialog).getByRole("button", { name: "删除账单" }));
    const confirmation = screen.getByRole("alertdialog", { name: "删除账单" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deleteExpenseMutation.mutateAsync).toHaveBeenCalledWith("3"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "修改账单" })).not.toBeInTheDocument());
  });

  it("离线与非活动状态打开流水内只读面板", () => {
    workspaceState.offline = true;
    const offline = renderPage(<ExpenseFeedPage />, ["/activities/activity-1"]);
    expect(screen.getByRole("link", { name: /午餐/ })).toHaveAttribute("href", "/activities/activity-1?viewExpense=expense-1");
    offline.unmount();

    workspaceState.offline = false;
    activity.status = "ENDED";
    renderPage(<ExpenseFeedPage />, ["/activities/activity-1"]);
    expect(screen.getByRole("link", { name: /午餐/ })).toHaveAttribute("href", "/activities/activity-1?viewExpense=expense-1");
  });
});

describe("流水备注摘要", () => {
  it("在正式流水标题下显示最多两行的备注摘要", () => {
    const originalNote = expense.expense.note;
    const longNote = "这是一段用于验证流水列表两行摘要样式的长备注内容".repeat(6);
    expense.expense.note = longNote;

    try {
      renderPage(<ExpenseFeedPage />);

      const note = screen.getByText(longNote);
      expect(note).toHaveClass("expense-row__note");
      expect(note.previousElementSibling).toHaveTextContent("午餐");
      expect(note.nextElementSibling).toHaveTextContent("甲 付款 · 2人");
    } finally {
      expense.expense.note = originalNote;
    }
  });

  it("无备注时不渲染摘要占位", () => {
    const originalNote = expense.expense.note;
    expense.expense.note = "";

    try {
      const { container } = renderPage(<ExpenseFeedPage />);

      expect(container.querySelector(".expense-row__note")).not.toBeInTheDocument();
    } finally {
      expense.expense.note = originalNote;
    }
  });
});

describe("流水图片标识", () => {
  it("在标题后显示含图片标识，并保留流水整行链接", () => {
    renderPage(<ExpenseFeedPage />);

    const row = screen.getByText("午餐").closest(".expense-row");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("img", { name: "含图片" })).toBeInTheDocument();
    expect(row).toHaveAttribute("href", "/activities/activity-1?editExpense=expense-1");
  });

  it("没有图片时不显示标识", () => {
    const originalAttachments = expense.attachments;
    expense.attachments = [];

    try {
      renderPage(<ExpenseFeedPage />);
      expect(screen.queryByRole("img", { name: "含图片" })).not.toBeInTheDocument();
    } finally {
      expense.attachments = originalAttachments;
    }
  });
});

describe("Expense 附件选择与私有预览", () => {
  it("追加图片时释放旧预览，卸载页面时释放所有当前预览", () => {
    let nextUrl = 0;
    const createUrl = vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:receipt-${++nextUrl}`);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const page = renderPage(<NewExpensePage />);
    openNoteView();
    const input = screen.getByLabelText("图片（最多三张）");
    fireEvent.change(input, { target: { files: [new File(["a"], "a.png", { type: "image/png" })] } });
    const previousUrls = createUrl.mock.results.map(({ value }) => value);

    fireEvent.change(input, { target: { files: [new File(["b"], "b.png", { type: "image/png" })] } });
    for (const url of previousUrls) expect(revoke).toHaveBeenCalledWith(url);
    expect(screen.getByRole("img", { name: "a.png 图片缩略图" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "b.png 图片缩略图" })).toBeInTheDocument();

    page.unmount();
    for (const { value } of createUrl.mock.results) expect(revoke).toHaveBeenCalledWith(value);
  });

  it("取消删除保留附件且不发送请求", () => {
    renderPage(<ExpenseDetailPage />);
    openNoteView();
    fireEvent.click(screen.getByRole("button", { name: "删除图片 1" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "删除图片" })).getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看图片 1" })).toBeInTheDocument();
    expect(deleteAttachmentMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("删除失败保留附件和确认框并显示错误", async () => {
    deleteAttachmentMutation.mutateAsync.mockImplementationOnce(async () => {
      const error = new Error("附件删除失败");
      deleteAttachmentMutation.error = error;
      throw error;
    });
    const page = renderPage(<ExpenseDetailPage />);
    openNoteView();
    fireEvent.click(screen.getByRole("button", { name: "删除图片 1" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deleteAttachmentMutation.mutateAsync).toHaveBeenCalledWith("attachment-1"));
    page.rerender(<MemoryRouter><ExpenseDetailPage /></MemoryRouter>);

    expect(screen.getByRole("alert")).toHaveTextContent("附件删除失败");
    expect(screen.getByRole("alertdialog", { name: "删除图片" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看图片 1" })).toBeInTheDocument();
  });

  it("新建和编辑模式都限制为三张受支持图片", () => {
    const create = renderPage(<NewExpensePage />);
    openNoteView();
    const input = screen.getByLabelText("图片（最多三张）");
    expect(input).toHaveAttribute(
      "accept",
      ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
    );
    create.unmount();

    renderPage(<ExpenseDetailPage />);
    openNoteView();
    expect(screen.getByLabelText("图片（最多三张）")).toBeInTheDocument();
  });

  it("编辑模式选图后立即上传并保留失败图片供移除", async () => {
    uploadAttachmentMutation.mutateAsync.mockRejectedValueOnce(new Error("网络暂时不可用"));
    renderPage(<ExpenseDetailPage />);
    openNoteView();
    const file = new File(["image"], "new-receipt.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("图片（最多三张）"), { target: { files: [file] } });

    await waitFor(() => expect(uploadAttachmentMutation.mutateAsync).toHaveBeenCalledWith({
      file,
      clientAttachmentId: expect.any(String),
    }));
    expect(screen.getByRole("img", { name: "new-receipt.png 图片缩略图" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("图片上传失败：网络暂时不可用");
  });

  it.each([
    {
      files: [0, 1, 2, 3].map((index) => new File(["x"], `${index}.png`, {
        type: "image/png",
      })),
      message: "每笔账单最多添加三张图片。",
    },
    {
      files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.jpg", {
        type: "image/jpeg",
      })],
      message: "单张图片不能超过 10 MiB。",
    },
    {
      files: [new File(["<svg/>"], "unsafe.svg", {
        type: "image/svg+xml",
      })],
      message: "仅支持 JPEG、PNG 或 WebP 图片。",
    },
  ])("无效附件保留已填表单并显示 $message", ({ files, message }) => {
    renderPage(<NewExpensePage />);
    const title = screen.getByLabelText("用途");
    const amount = screen.getByPlaceholderText("0.00");
    fireEvent.change(title, { target: { value: "保留的午餐" } });
    fireEvent.change(amount, { target: { value: "12.34" } });
    openNoteView();

    fireEvent.change(screen.getByLabelText("图片（最多三张）"), {
      target: { files },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.getByLabelText("用途")).toHaveValue("保留的午餐");
    expect(screen.getByPlaceholderText("0.00")).toHaveValue("12.34");
  });

  it("选择图片后显示缩略图，点击缩略图打开大图预览", () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:receipt-a")
      .mockReturnValueOnce("blob:receipt-b");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    renderPage(<NewExpensePage />);
    openNoteView();
    const files = [
      new File(["a"], "receipt-a.png", { type: "image/png" }),
      new File(["b"], "receipt-b.webp", { type: "image/webp" }),
    ];

    fireEvent.change(screen.getByLabelText("图片（最多三张）"), {
      target: { files },
    });

    expect(screen.getByRole("img", { name: "receipt-a.png 图片缩略图" }))
      .toHaveAttribute("src", "blob:receipt-a");
    expect(screen.getByRole("img", { name: "receipt-b.webp 图片缩略图" }))
      .toHaveAttribute("src", "blob:receipt-b");

    fireEvent.click(screen.getByRole("button", {
      name: "预览图片 receipt-b.webp",
    }));
    const preview = screen.getByRole("dialog", {
      name: "图片大图预览 receipt-b.webp",
    });
    expect(preview.querySelector("img")).toHaveAttribute(
      "src",
      "blob:receipt-b",
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭图片预览" }));
    expect(screen.queryByRole("dialog", { name: /图片大图预览/ }))
      .not.toBeInTheDocument();
  });

  it("服务端图片预览在原图加载前保持稳定的加载提示和原图入口", () => {
    renderPage(<ExpenseDetailPage />);
    const noteView = openNoteView();
    fireEvent.click(within(noteView).getByRole("link", { name: "查看图片 1" }));

    const preview = screen.getByRole("dialog", { name: "图片大图预览 1" });
    expect(preview.querySelector(".attachment-lightbox__stage")).toBeInTheDocument();
    expect(within(preview).getByRole("status")).toHaveTextContent("正在加载原图…");
    const fullImage = within(preview).getByRole("img", { name: "图片 1" });
    expect(fullImage).toHaveAttribute(
      "src",
      "/api/activities/activity-1/expenses/expense-1/attachments/attachment-1",
    );
    expect(within(preview).getByRole("link", { name: "打开原图" })).toHaveAttribute(
      "href",
      "/api/activities/activity-1/expenses/expense-1/attachments/attachment-1",
    );

    fireEvent.load(fullImage);
    expect(within(preview).queryByRole("status")).not.toBeInTheDocument();
    expect(preview.querySelector(".attachment-lightbox__placeholder")).not.toBeInTheDocument();

    fireEvent.keyDown(preview, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "图片大图预览 1" })).not.toBeInTheDocument();
  });

  it("服务端图片预览支持点击遮罩关闭", () => {
    renderPage(<ExpenseDetailPage />);
    const noteView = openNoteView();
    fireEvent.click(within(noteView).getByRole("link", { name: "查看图片 1" }));

    const preview = screen.getByRole("dialog", { name: "图片大图预览 1" });
    fireEvent.click(screen.getByRole("button", { name: "关闭图片预览背景" }));

    expect(screen.queryByRole("dialog", { name: "图片大图预览 1" })).not.toBeInTheDocument();
  });

  it("移除选中图片后只提交剩余附件", async () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:receipt-a")
      .mockReturnValueOnce("blob:receipt-b")
      .mockReturnValueOnce("blob:receipt-b-next");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    renderPage(<NewExpensePage />);
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("用途"), {
      target: { value: "保留一张附件" },
    });
    openNoteView();
    const first = new File(["a"], "receipt-a.png", { type: "image/png" });
    const second = new File(["b"], "receipt-b.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("图片（最多三张）"), {
      target: { files: [first, second] },
    });

    fireEvent.click(screen.getByRole("button", {
      name: "移除图片 receipt-a.png",
    }));
    expect(screen.queryByRole("img", { name: "receipt-a.png 图片缩略图" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "receipt-b.png 图片缩略图" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(createMutation.mutateAsync).toHaveBeenCalled());
    expect(createMutation.mutateAsync).toHaveBeenCalledWith({
      input: expect.objectContaining({ title: "保留一张附件" }),
      files: [second],
    });
  });

  it("移除图片时释放对应的本地预览地址", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:receipt");
    const revoke = vi.spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    renderPage(<NewExpensePage />);
    openNoteView();
    fireEvent.change(screen.getByLabelText("图片（最多三张）"), {
      target: {
        files: [new File(["receipt"], "receipt.png", { type: "image/png" })],
      },
    });

    fireEvent.click(screen.getByRole("button", {
      name: "移除图片 receipt.png",
    }));

    expect(revoke).toHaveBeenCalledWith("blob:receipt");
  });

  it("保存时把同一 File[] 与账单输入一起交给创建 mutation", async () => {
    renderPage(<NewExpensePage />);
    const file = new File(["receipt"], "receipt.png", {
      type: "image/png",
    });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("用途"), {
      target: { value: "午餐附件" },
    });
    openNoteView();
    fireEvent.change(screen.getByLabelText("图片（最多三张）"), {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(createMutation.mutateAsync).toHaveBeenCalled());
    expect(createMutation.mutateAsync).toHaveBeenCalledWith({
      input: expect.objectContaining({ title: "午餐附件" }),
      files: [file],
    });
  });

  it.each(["ACTIVE", "ENDED", "ARCHIVED"])(
    "%s 详情通过私有嵌套路由展示附件",
    (status) => {
      activity.status = status;
      renderPage(<ExpenseDetailPage />);
      if (status === "ACTIVE") openNoteView();

      const link = screen.getByRole("link", { name: "查看图片 1" });
      expect(link).toHaveAttribute(
        "href",
        "/api/activities/activity-1/expenses/expense-1/attachments/attachment-1",
      );
      expect(link.querySelector("img")).toHaveAttribute("loading", "lazy");
      expect(document.body.textContent).not.toContain("storageKey");
      expect(document.body.innerHTML).not.toContain("blob:");
      expect(document.body.innerHTML).not.toContain("uploads/");
      if (status === "ACTIVE") {
        expect(screen.getByRole("button", { name: "删除图片 1" }))
          .toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: "删除图片 1" }))
          .not.toBeInTheDocument();
      }
    },
  );

  it("ACTIVE 编辑页确认后立即删除指定已有附件", async () => {
    renderPage(<ExpenseDetailPage />);
    openNoteView();

    fireEvent.click(screen.getByRole("button", { name: "删除图片 1" }));
    expect(screen.getByRole("alertdialog", { name: "删除图片" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(deleteAttachmentMutation.mutateAsync)
      .toHaveBeenCalledWith("attachment-1"));
  });
});

describe("Expense pending 流水隔离", () => {
  it("显示待同步账单但不计入权威消费统计", () => {
    pendingMutations.records = [{
      activityId: "activity-1",
      attemptCount: 0,
      createdAt: 1,
      id: "pending-1",
      kind: "CREATE_EXPENSE",
      nextAttemptAt: 1,
      payload: {
        category: "FOOD",
        clientMutationId: "pending-1",
        exchangeRate: "1",
        exchangeRateKind: "IDENTITY",
        note: "清晨出发前购买",
        occurredAt: "2026-09-01T10:00:00Z",
        originalAmountMinor: "200",
        originalCurrency: "CNY",
        payments: [{ amountMinor: "200", memberId: "member-1" }],
        split: { members: ["member-1"], mode: "EQUAL" },
        title: "离线早餐",
      },
      status: "PENDING",
      updatedAt: 1,
      userId: "user-1",
    }];

    renderPage(<ExpenseFeedPage />);

    expect(screen.getByText("离线早餐")).toBeInTheDocument();
    expect(screen.getByText("清晨出发前购买")).toHaveClass("expense-row__note");
    expect(screen.getByText(/等待同步/)).toBeInTheDocument();
    expect(screen.getByText(/1 笔消费/)).toBeInTheDocument();
    expect(screen.getByLabelText("消费摘要")).toHaveTextContent("¥10.00");
    expect(screen.getByLabelText("消费摘要")).not.toHaveTextContent("¥12.00");
  });

  it("待同步图片显示标识", () => {
    pendingMutations.records = [{
      activityId: "activity-1",
      attachments: [{ id: "pending-attachment-1", status: "PENDING" }],
      attemptCount: 0,
      createdAt: 1,
      id: "pending-with-attachment",
      kind: "CREATE_EXPENSE",
      nextAttemptAt: 1,
      payload: {
        category: "FOOD",
        clientMutationId: "pending-with-attachment",
        exchangeRate: "1",
        exchangeRateKind: "IDENTITY",
        note: "带图早餐",
        occurredAt: "2026-09-01T10:00:00Z",
        originalAmountMinor: "200",
        originalCurrency: "CNY",
        payments: [{ amountMinor: "200", memberId: "member-1" }],
        split: { members: ["member-1"], mode: "EQUAL" },
        title: "带图早餐",
      },
      status: "PENDING",
      updatedAt: 1,
      userId: "user-1",
    }];

    renderPage(<ExpenseFeedPage />);

    const row = document.querySelector(".expense-row--pending");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByRole("img", { name: "含图片" })).toBeInTheDocument();
  });

  it("已同步 Expense 的附件拒绝状态附着在权威流水且不重复分组", () => {
    const originalAttachments = expense.attachments;
    expense.attachments = [];
    pendingMutations.records = [{
      activityId: "activity-1",
      attachments: [{
        id: "local-attachment-1",
        lastError: { code: "INVALID_ATTACHMENT", message: "附件被服务器拒绝。" },
        status: "REJECTED",
      }],
      attemptCount: 1,
      createdAt: 1,
      id: "mutation-1",
      kind: "CREATE_EXPENSE",
      nextAttemptAt: 0,
      payload: {
        category: "FOOD",
        clientMutationId: "mutation-1",
        exchangeRate: "1",
        exchangeRateKind: "IDENTITY",
        note: "团队午餐",
        occurredAt: "2026-09-01T08:00:00Z",
        originalAmountMinor: "1000",
        originalCurrency: "CNY",
        payments: [{ amountMinor: "1000", memberId: "member-1" }],
        split: { members: ["member-1", "member-2"], mode: "EQUAL" },
        title: "午餐",
      },
      serverExpenseId: "expense-1",
      status: "SYNCED",
      updatedAt: 1,
      userId: "user-1",
    }];

    try {
      renderPage(<ExpenseFeedPage />);

      expect(screen.queryByRole("heading", { name: "待同步" }))
        .not.toBeInTheDocument();
      expect(screen.getAllByText("午餐")).toHaveLength(1);
      expect(screen.getByText("附件被服务器拒绝。")).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "含图片" })).not.toBeInTheDocument();
    } finally {
      expense.attachments = originalAttachments;
    }
  });

  it("REJECTED 账单载入完整草稿并沿用原 mutation id 重试", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rejected");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    pendingMutations.records = [{
      activityId: "activity-1",
      attachments: [],
      attemptCount: 2,
      createdAt: 1,
      id: "rejected-1",
      kind: "CREATE_EXPENSE",
      lastError: { code: "INVALID_EXPENSE", message: "账单已被拒绝。" },
      nextAttemptAt: 0,
      payload: {
        category: "FOOD",
        clientMutationId: "rejected-1",
        exchangeRate: "1",
        exchangeRateKind: "IDENTITY",
        note: "原始备注",
        occurredAt: "2026-09-01T10:00:00Z",
        originalAmountMinor: "200",
        originalCurrency: "CNY",
        payments: [{ amountMinor: "200", memberId: "member-1" }],
        split: { members: ["member-1"], mode: "EQUAL" },
        title: "被拒早餐",
      },
      status: "REJECTED",
      updatedAt: 3,
      userId: "user-1",
    }];

    renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "修改后重试" }));
    await screen.findByLabelText("金额");
    const dialog = screen.getByRole("dialog", { name: "修改被拒账单" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "修改后重试" }).parentElement).toHaveClass("quick-expense-action-dock");
    expect(within(dialog).getByLabelText("用途")).toHaveValue("被拒早餐");
    openNoteView(dialog);
    expect(within(dialog).getByLabelText("备注")).toHaveValue("原始备注");

    fireEvent.click(within(dialog).getByRole("button", { name: "完成" }));
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "修正早餐" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "修改后重试" }));

    await waitFor(() => expect(reviseMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      mutationId: "rejected-1",
      payload: expect.objectContaining({ clientMutationId: "rejected-1", title: "修正早餐" }),
      attachments: [],
    })));
  });

  it("REJECTED 丢弃需要确认且只删除本地记录", async () => {
    pendingMutations.records = [{
      activityId: "activity-1",
      attachments: [],
      attemptCount: 1,
      createdAt: 1,
      id: "rejected-discard",
      kind: "CREATE_EXPENSE",
      nextAttemptAt: 0,
      payload: {
        category: "FOOD",
        clientMutationId: "rejected-discard",
        exchangeRate: "1",
        exchangeRateKind: "IDENTITY",
        occurredAt: "2026-09-01T10:00:00Z",
        originalAmountMinor: "100",
        originalCurrency: "CNY",
        payments: [{ amountMinor: "100", memberId: "member-1" }],
        split: { members: ["member-1"], mode: "EQUAL" },
        title: "丢弃早餐",
      },
      status: "REJECTED",
      updatedAt: 2,
      userId: "user-1",
    }];

    renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "丢弃本地记录" }));
    expect(screen.getByRole("alertdialog", { name: "丢弃本地记录" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃" }));
    await waitFor(() => expect(discardMutation.mutateAsync).toHaveBeenCalledWith({
      mutationId: "rejected-discard",
      activityId: "activity-1",
    }));
  });
});

describe("流水搜索与筛选", () => {
  async function closeFilters() {
    fireEvent.click(screen.getByRole("button", { name: "关闭筛选流水" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "筛选流水" })).not.toBeInTheDocument());
  }

  it("中文组词不提前筛选，完成后反馈结果，清除全部恢复列表与输入", () => {
    renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const input = screen.getByRole("textbox", { name: "搜索用途或备注" });
    expect(input).toHaveFocus();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "bu" } });
    expect(screen.getByRole("link", { name: /午餐/ })).toBeInTheDocument();
    fireEvent.compositionEnd(input, { data: "不存在", target: { value: "不存在" } });
    expect(screen.queryByRole("link", { name: /午餐/ })).not.toBeInTheDocument();
    expect(screen.getByText("找到 0 笔流水")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除全部条件" }));
    expect(input).toHaveValue("");
    expect(screen.getByRole("link", { name: /午餐/ })).toBeInTheDocument();
  });

  it("弹层修改和重置只影响草稿，关闭不应用，重新打开恢复已应用条件", async () => {
    renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "交通" }));
    expect(screen.getByRole("link", { name: /午餐/ })).toBeInTheDocument();
    await closeFilters();
    expect(screen.getByRole("button", { name: "筛选" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    expect(screen.getByRole("button", { name: "交通" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "餐饮" }));
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "移除餐饮" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    await closeFilters();
    expect(screen.getByRole("button", { name: "移除餐饮" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^筛选/ }));
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(screen.queryByRole("button", { name: "移除餐饮" })).not.toBeInTheDocument();
  });

  it("分类和成员组合匹配，搜索取消仅清空搜索，顶部摘要保持活动总额", async () => {
    renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "餐饮" }));
    fireEvent.click(screen.getByRole("button", { name: "交通" }));
    fireEvent.click(screen.getByText("付款人", { exact: true }));
    fireEvent.click(within(screen.getByRole("group", { name: "付款人" })).getByRole("checkbox", { name: "乙" }));
    fireEvent.click(screen.getByText("参与人", { exact: true }));
    fireEvent.click(within(screen.getByRole("group", { name: "参与人" })).getByRole("checkbox", { name: "乙" }));
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^筛选/ })).toHaveTextContent("筛选3");
    expect(screen.getByText("找到 0 笔流水")).toBeInTheDocument();
    expect(screen.getByLabelText("消费摘要")).toHaveTextContent("¥10.00");
    fireEvent.click(screen.getByRole("button", { name: "移除付款人：乙" }));
    expect(screen.getByText("找到 1 笔流水")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索用途或备注" }), { target: { value: "找不到" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "搜索" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "移除参与人：乙" })).toBeInTheDocument();
    expect(screen.getByText("找到 1 笔流水")).toBeInTheDocument();
  });

  it("日期不完整或倒序时说明原因，清空日期恢复可应用", () => {
    renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-09-02" } });
    expect(screen.getByRole("button", { name: "应用筛选" })).toBeDisabled();
    expect(screen.getByText("请选择完整的开始和结束日期。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("结束日期"), { target: { value: "2026-09-01" } });
    expect(screen.getByText("结束日期不能早于开始日期。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空日期" }));
    expect(screen.getByRole("button", { name: "应用筛选" })).toBeEnabled();
  });

  it("离线待同步记录单独计数，唯一匹配为本地记录时不显示空态", () => {
    workspaceState.offline = true;
    accountingQueryState.emptyExpenses = true;
    pendingMutations.records = [{ id: "local", status: "PENDING", attachments: [], payload: {
      ...expense.expense, clientMutationId: "local", payments: [{ memberId: "member-2", amountMinor: "1000" }], split: { mode: "EXACT", entries: [{ memberId: "member-1", value: "1000" }] },
    } }];
    renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索用途或备注" }), { target: { value: "午餐" } });
    expect(screen.getByText("找到 0 笔流水 · 本地待同步 1 笔")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "还没有流水" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "没有符合条件的流水" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("消费摘要")).toHaveTextContent("¥0.00");
  });

  it("没有在线查询缓存时，离线快照也使用同一套筛选条件", () => {
    workspaceState.offline = true;
    workspaceState.snapshotOnly = true;
    renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索用途或备注" }), { target: { value: "团队" } });
    expect(screen.getByText("找到 1 笔流水")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索用途或备注" }), { target: { value: "不存在" } });
    expect(screen.getByText("找到 0 笔流水")).toBeInTheDocument();
    expect(screen.getByLabelText("消费摘要")).toHaveTextContent("¥10.00");
  });

  it("服务端已返回但队列尚未更新的同一账单不会重复出现", () => {
    pendingMutations.records = [{ id: "local", status: "SYNCING", attachments: [], payload: {
      ...expense.expense, payments: [{ memberId: "member-1", amountMinor: "1000" }], split: { mode: "EQUAL", members: ["member-1"] },
    } }];
    renderPage(<ExpenseFeedPage />);
    expect(screen.getAllByText("午餐", { exact: true })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "待同步" })).not.toBeInTheDocument();
  });
});

describe("账务空状态插画", () => {
  it("首次流水为空时显示插画", () => {
    accountingQueryState.emptyExpenses = true;
    const { container } = renderPage(<ExpenseFeedPage />);

    expect(screen.getByRole("heading", { name: "还没有流水" })).toBeInTheDocument();
    expect(container.querySelector('img[src="/illustrations/expense-feed-empty.webp"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("筛选无结果时不显示首次流水插画", () => {
    const { container } = renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.change(screen.getByLabelText("搜索用途或备注"), { target: { value: "不存在的流水" } });

    expect(screen.getByRole("heading", { name: "没有符合条件的流水" })).toBeInTheDocument();
    expect(container.querySelector('img[src="/illustrations/expense-feed-empty.webp"]')).not.toBeInTheDocument();
    expect(container.querySelector(".empty-state__icon")).toBeInTheDocument();
  });

  it("结算记录为空时显示紧凑插画", () => {
    accountingQueryState.emptySettlements = true;
    const { container } = renderPage(<SettlementsPage />);

    expect(screen.getByRole("heading", { name: "还没有结算记录" })).toBeInTheDocument();
    expect(container.querySelector('img[src="/illustrations/settlement-history-empty.webp"]')).toHaveClass("state-illustration--compact");
  });
});

describe("我的结算摘要", () => {
  it.each([['500', '我的应收', 'positive'], ['-500', '我的应付', 'negative'], ['0', '个人余额已平', null]] as const)("余额 %s 保留正确金额、状态与说明", (netMinor, label, tone) => {
    accountingQueryState.netMinor = netMinor;
    renderPage(<SettlementsPage />);
    const summary = screen.getByRole('region', { name: '我的结算' });
    expect(within(summary).getByText(label, { exact: true })).toBeVisible();
    if (tone) expect(within(summary).getByText('¥5.00')).toHaveClass(`money--${tone}`);
    else expect(within(summary).getByText('¥0.00')).toBeVisible();
    expect(screen.getByRole('button', { name: '成员余额' })).toHaveTextContent(netMinor === '0' ? '0 人未结清' : '2 人未结清');
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }));
    expect(screen.getByRole('link', { name: '生成分享摘要' })).toHaveAttribute('href', '/share-summary/activity-1');
  });

  it("余额未知时只显示摘要占位，不宣告已结清", () => {
    accountingQueryState.ledgerPending = true;
    renderPage(<SettlementsPage />);
    const summary = screen.getByRole('region', { name: '我的结算' });
    expect(within(summary).getByRole('status', { name: '正在读取我的结算…' })).toBeVisible();
    expect(within(summary).queryByText('已结清')).toBeNull();
    expect(summary.querySelector('.accounting-skeleton__row')).toBeNull();
  });

  it("余额刷新失败时不把缓存的零余额宣告为已结清", () => {
    accountingQueryState.netMinor = '0';
    accountingQueryState.ledgerError = new Error('余额读取失败');
    renderPage(<SettlementsPage />);
    expect(screen.getByRole('region', { name: '我的结算' })).toHaveTextContent('余额读取失败');
    expect(screen.queryByText('个人余额已平')).toBeNull();
    expect(screen.queryByText('全员余额已结清')).toBeNull();
    expect(screen.getByRole('button', { name: '成员余额' })).toHaveTextContent('读取失败');
    fireEvent.click(screen.getByRole('button', { name: '成员余额' }));
    expect(screen.queryByText('余额已平')).toBeNull();
  });

  it("可以在更多菜单切换结算方案", async () => {
    renderPage(<SettlementsPage />);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("button", { name: "切换结算方案" }));

    const sheet = screen.getByRole("dialog", { name: "选择结算方案" });
    expect(within(sheet).getByRole("radio", { name: /最少转账/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(sheet).getByRole("radio", { name: /由我统一收付/ }));

    expect(screen.getByText("当前方案：由我统一收付")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "选择结算方案" })).not.toBeInTheDocument());
  });
});

describe("AI 智能录入入口", () => {
  const initialDraft = {
    title: "AI 标题",
    amountMinor: "1000",
    currency: "CNY",
    occurredAt: "2026-09-18T12:00:00Z",
    category: "FOOD" as const,
    note: "AI 备注",
    payerMode: "single" as const,
    payerIds: ["member-1"],
    paymentValues: { "member-1": "10.00" },
    participantIds: ["member-1"],
    splitMode: "EQUAL" as const,
    fieldStates: {
      title: "AI_SUGGESTED" as const,
      amount: "AI_SUGGESTED" as const,
      currency: "AI_SUGGESTED" as const,
      occurredAt: "AI_SUGGESTED" as const,
      category: "AI_SUGGESTED" as const,
      note: "AI_SUGGESTED" as const,
      payer: "AI_SUGGESTED" as const,
      participants: "AI_SUGGESTED" as const,
      split: "AI_SUGGESTED" as const,
    },
    memberSuggestions: [],
    warnings: [],
    incompleteFields: [],
  };

  it("能力可用时在流水页显示 AI 入口并保持记一笔主入口", () => {
    aiCapability.textDraftAvailable = true;
    renderPage(<ExpenseFeedPage />);
    const aiButton = screen.getByRole("button", { name: "智能录入" });
    const manualButton = screen.getByRole("button", { name: "记一笔" });
    expect(aiButton).toBeInTheDocument();
    expect(manualButton).toBeInTheDocument();
    expect(aiButton.parentElement).toHaveClass("activity-floating-actions");
    expect(aiButton.compareDocumentPosition(manualButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("能力不可用时直接进入原有手动编辑器", () => {
    renderPage(<NewExpensePage />);
    expect(screen.getByLabelText("金额")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "新增账单" })).not.toBeInTheDocument();
  });

  it("明确离线时不请求 AI capability", () => {
    workspaceState.offline = true;
    aiCapability.textDraftAvailable = true;
    renderPage(<ExpenseFeedPage />);
    expect(aiCapabilityQuery).toHaveBeenCalledWith("user-1", "activity-1", false);
    expect(screen.getByRole("button", { name: "记一笔" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "智能录入" })).not.toBeInTheDocument();
  });

  it("同一草稿的父级刷新不会覆盖用户修改，只有新 key 才重新初始化", async () => {
    const onViewChange = vi.fn();
    const view = renderPage(<UnifiedExpenseEditor initialDraft={initialDraft} view="entry" onViewChange={onViewChange} />);
    await screen.findByLabelText("用途");
    fireEvent.change(screen.getByLabelText("用途"), { target: { value: "用户修改后的标题" } });
    view.rerender(<MemoryRouter><UnifiedExpenseEditor initialDraft={{ ...initialDraft }} view="entry" onViewChange={onViewChange} /></MemoryRouter>);
    expect(screen.getByLabelText("用途")).toHaveValue("用户修改后的标题");

    view.rerender(<MemoryRouter><UnifiedExpenseEditor key="draft-2" initialDraft={{ ...initialDraft, title: "第二份草稿" }} view="entry" onViewChange={onViewChange} /></MemoryRouter>);
    expect(screen.getByLabelText("用途")).toHaveValue("第二份草稿");
    view.rerender(<MemoryRouter><UnifiedExpenseEditor key="manual" view="entry" onViewChange={onViewChange} /></MemoryRouter>);
    expect(screen.queryByRole("region", { name: "智能录入提示" })).not.toBeInTheDocument();
  });

  it("能力查询刷新不会重新填充已经编辑的 AI 草稿", async () => {
    aiCapability.textDraftAvailable = true;
    aiTextDraftMutation.mockResolvedValue({
      title: "查询刷新草稿", merchant: null, amount: { amountMinor: "1000", currency: "CNY" }, occurredAt: null,
      categorySuggestion: "FOOD", location: null, note: null, items: [], warnings: [], incompleteFields: [], payerSuggestions: [], splitSuggestion: null,
    });
    const view = renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "智能录入" }));
    fireEvent.change(screen.getByRole("textbox", { name: /账单描述/ }), { target: { value: "一笔账" } });
    fireEvent.click(screen.getByRole("button", { name: "生成账单草稿" }));
    await screen.findByRole("region", { name: "智能录入提示" });
    fireEvent.change(screen.getByLabelText("用途"), { target: { value: "用户已编辑" } });
    view.rerender(<MemoryRouter><ExpenseFeedPage /></MemoryRouter>);
    expect(screen.getByLabelText("用途")).toHaveValue("用户已编辑");
  });

  it("Activity 切换后不会把旧草稿带入新活动", async () => {
    aiCapability.textDraftAvailable = true;
    const pendingDraft = {
      title: "旧活动草稿", merchant: null, amount: { amountMinor: "1000", currency: "CNY" }, occurredAt: null,
      categorySuggestion: "FOOD", location: null, note: null, items: [], warnings: [], incompleteFields: [],
      payerSuggestions: [{ mention: "我", matchStatus: "MATCHED", memberId: "member-1", candidateMemberIds: [], matchedDisplayName: "甲", candidateCount: null, amount: { amountMinor: "1000", currency: "CNY" } }],
      splitSuggestion: { mode: "EQUAL", participants: [{ mention: "我", matchStatus: "MATCHED", memberId: "member-1", candidateMemberIds: [], matchedDisplayName: "甲", candidateCount: null, value: null }] },
    };
    let resolveDraft: ((value: typeof pendingDraft) => void) | undefined;
    aiTextDraftMutation.mockImplementation(() => new Promise<typeof pendingDraft>((resolve) => { resolveDraft = resolve; }));
    const view = renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "智能录入" }));
    fireEvent.change(screen.getByRole("textbox", { name: /账单描述/ }), { target: { value: "旧活动的一笔账" } });
    fireEvent.click(screen.getByRole("button", { name: "生成账单草稿" }));
    expect(await screen.findByRole("button", { name: "取消智能录入" })).toBeInTheDocument();
    activity.activityId = "activity-2";
    view.rerender(<MemoryRouter><ExpenseFeedPage /></MemoryRouter>);
    resolveDraft?.(pendingDraft);
    await waitFor(() => expect(screen.queryByRole("region", { name: "智能录入提示" })).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue("旧活动草稿")).not.toBeInTheDocument();
  });

  it("用户修改标题和金额后清除对应 AI 建议标记", async () => {
    renderPage(<UnifiedExpenseEditor initialDraft={initialDraft} view="entry" onViewChange={vi.fn()} />);
    await screen.findByLabelText("用途");
    expect(screen.getAllByText("AI 建议")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("用途"), { target: { value: "手工标题" } });
    expect(screen.getAllByText("AI 建议")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("金额"), { target: { value: "20" } });
    expect(screen.queryByText("AI 建议")).not.toBeInTheDocument();
  });
});

describe("只读账单紧凑明细", () => {
  beforeEach(() => {
    activity.status = "ENDED";
    readonlyExpenseState.data = structuredClone(expense);
  });

  it.each([4, 5])("%s 人分摊按边界展示，保留零金额成员", async (count) => {
    const data = readonlyExpenseState.data!;
    data.shares = Array.from({ length: count }, (_, index) => ({ factId: `share-${index}`, memberId: `member-${index + 1}`, baseAmountMinor: index === 4 ? "0" : "250", originalAmountMinor: index === 4 ? "0" : "250" }));
    data.expense.splitMode = count === 5 ? "EXACT" : "EQUAL";
    renderPage(<ExpenseDetailPage />);
    expect(screen.getByText(`${count} 人`)).toBeVisible();
    const rows = document.querySelectorAll(".expense-detail-split-members .expense-detail-member-row");
    expect(rows).toHaveLength(count);
    if (count === 4) {
      expect(screen.queryByRole("button", { name: "查看分摊明细" })).not.toBeInTheDocument();
      expect(rows[0]).toBeVisible();
    } else {
      expect(rows[0]).not.toBeVisible();
      const toggle = screen.getByRole("button", { name: "查看分摊明细" });
      toggle.focus();
      await userEvent.keyboard("{Enter}");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(rows[4]).toBeVisible();
      expect(rows[4]).toHaveTextContent("¥0.00");
      await userEvent.keyboard(" ");
      expect(rows[0]).not.toBeVisible();
    }
  });

  it.each([["UNSETTLED", "待结算"], ["PARTIALLY_SETTLED", "部分结算"], ["SETTLED", "已结清"]])("%s 使用服务端状态，展开后才展示结算事实", (status, label) => {
    readonlyExpenseState.data!.settlementProgress = {
      currency: "CNY", status, remainingMinor: "300", settledMinor: "200", totalRequiredMinor: "500",
      members: [{ memberId: "member-2", direction: "PAYABLE", expectedMinor: "500", settledMinor: "200", remainingMinor: "300", status }],
    };
    renderPage(<ExpenseDetailPage />);
    const progress = screen.getByRole("region", { name: "结算进度" });
    expect(progress).toHaveTextContent(label);
    expect(within(progress).queryByRole("table")).not.toBeInTheDocument();
    fireEvent.click(within(progress).getByRole("button", { name: "查看结算明细" }));
    expect(within(progress).getByRole("table")).toHaveTextContent("待结¥3.00");
    expect(within(progress).getByText(/仅统计明确关联/)).toBeVisible();
    expect(document.querySelector(".expense-detail-fields")!.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("无需结算直接说明，不提供空的展开入口", () => {
    readonlyExpenseState.data!.settlementProgress = { currency: "CNY", status: "NO_SETTLEMENT_REQUIRED", members: [], remainingMinor: "0", settledMinor: "0", totalRequiredMinor: "0" };
    renderPage(<ExpenseDetailPage />);
    expect(screen.getByText("这笔账从一开始无需成员间结算。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "查看结算明细" })).not.toBeInTheDocument();
  });

  it("切换账单重置分摊与结算的展开状态", () => {
    const data = readonlyExpenseState.data!;
    data.shares = Array.from({ length: 5 }, (_, index) => ({ ...expense.shares[0], factId: `s${index}`, memberId: `m${index}` }));
    data.settlementProgress = { currency: "CNY", status: "UNSETTLED", members: [], remainingMinor: "500", settledMinor: "0", totalRequiredMinor: "500" };
    const view = renderPage(<ExpenseDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "查看分摊明细" }));
    fireEvent.click(screen.getByRole("button", { name: "查看结算明细" }));
    data.expense.expenseId = "expense-2";
    view.rerender(<MemoryRouter><ExpenseDetailPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "查看分摊明细" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "查看结算明细" })).toHaveAttribute("aria-expanded", "false");
  });

  it("缺少进度、备注和图片时隐藏对应区域，外币和多付款人金额保持原始事实", () => {
    const data = readonlyExpenseState.data!;
    data.expense.note = "";
    data.attachments = [];
    data.expense.originalCurrency = "USD";
    data.expense.originalAmountMinor = "150";
    data.expense.exchangeRate = "6.666667";
    data.payments = [{ ...data.payments[0], originalAmountMinor: "100" }, { ...data.payments[0], factId: "p2", memberId: "member-2", originalAmountMinor: "50" }];
    renderPage(<ExpenseDetailPage />);
    expect(screen.queryByRole("region", { name: "结算进度" })).not.toBeInTheDocument();
    expect(screen.queryByText("备注", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "图片" })).not.toBeInTheDocument();
    expect(screen.getByText("折算后 ¥10.00")).toBeVisible();
    expect(screen.getByText(/汇率 6.666667/)).toBeVisible();
    const payers = screen.getByText("付款人", { exact: true }).nextElementSibling!;
    expect(payers).toHaveTextContent("甲US$1.00乙US$0.50");
  });
});

describe("Activity 生命周期写权限", () => {
  it.each(["ACTIVE", "ENDED", "ARCHIVED"])("%s 活动在结算页提供生成分享摘要入口", (status) => {
    activity.status = status;
    renderPage(<SettlementsPage />);

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("link", { name: "生成分享摘要" })).toHaveAttribute("href", "/share-summary/activity-1");
    expect(screen.getByRole("button", { name: "成员余额" })).toBeVisible();
    expect(screen.queryByText("查看 Rust 账本计算的全员余额")).not.toBeInTheDocument();
  });

  it("ENDED 隐藏 Expense 新建、编辑和删除，直接新建只显示只读说明", () => {
    activity.status = "ENDED";

    const feed = renderPage(<ExpenseFeedPage />);
    expect(screen.queryByRole("button", { name: "记一笔" })).not.toBeInTheDocument();
    feed.unmount();

    const create = renderPage(<NewExpensePage />);
    expect(screen.getByText(/活动已结束.*不能新增账单/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存账单" })).not.toBeInTheDocument();
    create.unmount();

    renderPage(<ExpenseDetailPage />);
    const detail = screen.getByRole("region", { name: "账单详情" });
    expect(detail).toHaveTextContent("午餐");
    expect(detail).toHaveTextContent("分类餐饮");
    expect(detail).toHaveTextContent("金额CNY¥10.00");
    expect(detail).toHaveTextContent("用途午餐");
    expect(detail).toHaveTextContent("付款人甲¥10.00");
    const occurredAt = within(detail).getByText(new Date(expense.expense.occurredAt).toLocaleString("zh-CN"), { exact: true });
    expect(occurredAt).toHaveAttribute("dateTime", expense.expense.occurredAt);
    expect(detail).toHaveTextContent("参与人2 人");
    expect(detail).toHaveTextContent("分摊设置均摊甲¥5.00乙¥5.00");
    expect(detail).toHaveTextContent("团队午餐");
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存账单" })).not.toBeInTheDocument();
  });

  it("ENDED 仍保留 Settlement 新建、修改和作废", () => {
    activity.status = "ENDED";
    renderPage(<SettlementsPage />);

    fireEvent.click(screen.getByRole("button", { name: "补记结算" }));
    expect(screen.getByRole("button", { name: "记录结算" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "补记结算" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "修改" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作废" })).toBeInTheDocument();
  });

  it("ARCHIVED 隐藏所有 Settlement 写入口但保留记录读取", () => {
    activity.status = "ARCHIVED";
    renderPage(<SettlementsPage />);

    expect(screen.getByText("实际结算记录")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "记录结算" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "补记结算" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "修改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "作废" })).not.toBeInTheDocument();
  });
});
