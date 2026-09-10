import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "../../api/error";

const activity = vi.hoisted(() => ({
  activityId: "activity-1",
  allowedLifecycleActions: [],
  baseCurrency: "CNY",
  canDelete: false,
  canRestore: false,
  currentMemberId: "member-1",
  currentMemberRole: "OWNER",
  deletedAt: null,
  endDate: null,
  fieldPermissions: { baseCurrency: false, endDate: false, location: false, name: false, startDate: false },
  hasAccountingRecords: true,
  location: null,
  name: "测试活动",
  ownerMemberId: "member-1",
  purgeAfter: null,
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
  settlementId: "settlement-1", status: "ACTIVE", updatedAt: "2026-09-01T09:00:00Z", version: "2", voidedAt: null,
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
const rateMutation = vi.hoisted(() => ({
  isPending: false,
  mutateAsync: vi.fn().mockResolvedValue({
    fromCurrency: "JPY", toCurrency: "CNY", rate: "0.04209",
    source: "PROVIDER", provider: "FRANKFURTER", referenceDate: "2026-08-30",
  }),
}));
const pendingMutations = vi.hoisted(() => ({ records: [] as Array<Record<string, unknown>> }));
const workspaceState = vi.hoisted(() => ({ offline: false }));
const accountingQueryState = vi.hoisted(() => ({ emptyExpenses: false, emptySettlements: false, netMinor: '-500', ledgerPending: false }));
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
  useExpenseQuery: () => ({ data: expense, isPending: false }),
  useExchangeRateSuggestionMutation: () => rateMutation,
  useExpensesQuery: () => ({ data: accountingQueryState.emptyExpenses ? [] : [expense], isPending: false }),
  useLedgerQuery: () => ({ data: accountingQueryState.ledgerPending ? undefined : { balances: [{ memberId: "member-1", netMinor: accountingQueryState.netMinor }, { memberId: "member-2", netMinor: String(-BigInt(accountingQueryState.netMinor)) }] }, isPending: accountingQueryState.ledgerPending }),
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

import { ExpenseDetailPage, NewExpensePage } from "./expense-editor";
import { ExpenseFeedPage } from "./feed-page";
import { SettlementsPage } from "./settlement-page";

function renderPage(node: ReactNode, initialEntries?: string[]) {
  return render(<MemoryRouter initialEntries={initialEntries}>{node}</MemoryRouter>);
}

function openNoteView(container: HTMLElement = document.body) {
  fireEvent.click(within(container).getByRole("button", { name: /^备注：/ }));
  return screen.queryByRole("dialog", { name: "备注与附件" })
    ?? screen.getByRole("region", { name: "备注与附件" });
}

function chooseCurrency(code: string) {
  fireEvent.click(screen.getByRole("button", { name: /^币种：/ }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${code}`) }));
}

afterEach(() => {
  cleanup();
  activity.status = "ACTIVE";
  pendingMutations.records = [];
  workspaceState.offline = false;
  accountingQueryState.emptyExpenses = false;
  accountingQueryState.emptySettlements = false;
  accountingQueryState.netMinor = '-500';
  accountingQueryState.ledgerPending = false;
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
    expect(trigger).toHaveClass("activity-add-fab", "quick-expense-trigger");
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
    expect(within(noteDialog).getByText("选择图片")).toBeInTheDocument();
    expect(within(noteDialog).getByText("未选择图片")).toBeInTheDocument();
    expect(within(noteDialog).getByLabelText("附件（最多三张）")).toHaveAttribute("accept", ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp");
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

  it("精确分摊实时显示守恒汇总，参与人变更会清空旧的精确值", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^分摊设置：/ }));
    const splitDialog = screen.getByRole("dialog", { name: "分摊设置" });
    fireEvent.click(within(splitDialog).getByRole("radio", { name: "按金额" }));
    fireEvent.change(within(splitDialog).getByLabelText("甲按金额"), { target: { value: "60" } });
    fireEvent.change(within(splitDialog).getByLabelText("乙按金额"), { target: { value: "40" } });
    expect(splitDialog).toHaveTextContent("已分配 ¥100.00 / ¥100.00");
    fireEvent.click(within(splitDialog).getByRole("button", { name: "完成" }));
    const rootDialog = screen.getByRole("dialog", { name: "记一笔" });
    fireEvent.click(within(rootDialog).getByRole("button", { name: /^参与人：/ }));
    const participantDialog = screen.getByRole("dialog", { name: "参与人" });
    fireEvent.click(within(participantDialog).getByRole("checkbox", { name: "乙" }));
    fireEvent.click(within(participantDialog).getByRole("button", { name: "完成" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "记一笔" })).getByRole("button", { name: /^分摊设置：/ }));
    const resetSplitDialog = screen.getByRole("dialog", { name: "分摊设置" });
    expect(within(resetSplitDialog).getByLabelText("甲按金额")).toHaveValue("");
  });

  it("按份数支持整数步进和小数手输，按比例使用百分比符号占位", async () => {
    const { dialog } = await openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^分摊设置：/ }));
    const splitDialog = screen.getByRole("dialog", { name: "分摊设置" });
    fireEvent.click(within(splitDialog).getByRole("radio", { name: "按份数" }));

    const weightInput = within(splitDialog).getByLabelText("甲按份数");
    const decrement = within(splitDialog).getByRole("button", { name: "减少甲的份数" });
    const increment = within(splitDialog).getByRole("button", { name: "增加甲的份数" });
    expect(weightInput).toHaveValue("");
    expect(decrement).toBeDisabled();
    fireEvent.click(increment);
    expect(weightInput).toHaveValue("1");
    expect(decrement).toBeDisabled();
    fireEvent.change(weightInput, { target: { value: "1.25" } });
    fireEvent.click(increment);
    expect(weightInput).toHaveValue("2.25");
    fireEvent.click(decrement);
    expect(weightInput).toHaveValue("1.25");
    expect(within(splitDialog).getByRole("button", { name: "完成" }).parentElement).toHaveClass("quick-expense-action-dock");

    fireEvent.click(within(splitDialog).getByRole("radio", { name: "按比例" }));
    expect(within(splitDialog).getByLabelText("甲按比例")).toHaveAttribute("placeholder", "%");
    expect(within(splitDialog).getByLabelText("乙按比例")).toHaveAttribute("placeholder", "%");
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
    expect(screen.getByRole("button", { name: /^分摊设置：/ })).toHaveTextContent("按金额");

    fireEvent.click(screen.getByRole("button", { name: /^付款人：/ }));
    expect(screen.getByRole("radio", { name: "甲" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "返回修改账单" }));
    fireEvent.click(screen.getByRole("button", { name: /^参与人：/ }));
    expect(screen.getByRole("checkbox", { name: "甲" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "乙" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "返回修改账单" }));
    fireEvent.click(screen.getByRole("button", { name: /^分摊设置：/ }));
    expect(screen.getByRole("radio", { name: "按金额" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("甲按金额")).toHaveValue("5.00");
    expect(screen.getByLabelText("乙按金额")).toHaveValue("5.00");
  });

  it("未改动事实时保存携带原版本、mutation id、付款与精确分摊", async () => {
    renderPage(<ExpenseDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      version: "3",
      clientMutationId: "mutation-1",
      originalAmountMinor: "1000",
      payments: [{ memberId: "member-1", amountMinor: "1000" }],
      split: {
        mode: "EXACT",
        entries: [
          { memberId: "member-1", value: "500" },
          { memberId: "member-2", value: "500" },
        ],
      },
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

  it("离线与非活动状态继续使用独立账单深链", () => {
    workspaceState.offline = true;
    const offline = renderPage(<ExpenseFeedPage />, ["/activities/activity-1"]);
    expect(screen.getByRole("link", { name: /午餐/ })).toHaveAttribute("href", "/activities/activity-1/expenses/expense-1");
    offline.unmount();

    workspaceState.offline = false;
    activity.status = "ENDED";
    renderPage(<ExpenseFeedPage />, ["/activities/activity-1"]);
    expect(screen.getByRole("link", { name: /午餐/ })).toHaveAttribute("href", "/activities/activity-1/expenses/expense-1");
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

describe("Expense 附件选择与私有预览", () => {
  it("追加图片时释放旧预览，卸载页面时释放所有当前预览", () => {
    let nextUrl = 0;
    const createUrl = vi.spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:receipt-${++nextUrl}`);
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const page = renderPage(<NewExpensePage />);
    openNoteView();
    const input = screen.getByLabelText("附件（最多三张）");
    fireEvent.change(input, { target: { files: [new File(["a"], "a.png", { type: "image/png" })] } });
    const previousUrls = createUrl.mock.results.map(({ value }) => value);

    fireEvent.change(input, { target: { files: [new File(["b"], "b.png", { type: "image/png" })] } });
    for (const url of previousUrls) expect(revoke).toHaveBeenCalledWith(url);
    expect(screen.getByRole("img", { name: "a.png 缩略图" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "b.png 缩略图" })).toBeInTheDocument();

    page.unmount();
    for (const { value } of createUrl.mock.results) expect(revoke).toHaveBeenCalledWith(value);
  });

  it("取消删除保留附件且不发送请求", () => {
    renderPage(<ExpenseDetailPage />);
    openNoteView();
    fireEvent.click(screen.getByRole("button", { name: "删除附件 1" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "删除附件" })).getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看附件 1" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "删除附件 1" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(deleteAttachmentMutation.mutateAsync).toHaveBeenCalledWith("attachment-1"));
    page.rerender(<MemoryRouter><ExpenseDetailPage /></MemoryRouter>);

    expect(screen.getByRole("alert")).toHaveTextContent("附件删除失败");
    expect(screen.getByRole("alertdialog", { name: "删除附件" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看附件 1" })).toBeInTheDocument();
  });

  it("新建模式限制为三张受支持图片，编辑模式不再选择附件", () => {
    const create = renderPage(<NewExpensePage />);
    openNoteView();
    const input = screen.getByLabelText("附件（最多三张）");
    expect(input).toHaveAttribute(
      "accept",
      ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
    );
    create.unmount();

    renderPage(<ExpenseDetailPage />);
    openNoteView();
    expect(screen.queryByLabelText("附件（最多三张）")).not.toBeInTheDocument();
  });

  it.each([
    {
      files: [0, 1, 2, 3].map((index) => new File(["x"], `${index}.png`, {
        type: "image/png",
      })),
      message: "每笔账单最多添加三张附件。",
    },
    {
      files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.jpg", {
        type: "image/jpeg",
      })],
      message: "单张附件不能超过 10 MiB。",
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

    fireEvent.change(screen.getByLabelText("附件（最多三张）"), {
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

    fireEvent.change(screen.getByLabelText("附件（最多三张）"), {
      target: { files },
    });

    expect(screen.getByRole("img", { name: "receipt-a.png 缩略图" }))
      .toHaveAttribute("src", "blob:receipt-a");
    expect(screen.getByRole("img", { name: "receipt-b.webp 缩略图" }))
      .toHaveAttribute("src", "blob:receipt-b");

    fireEvent.click(screen.getByRole("button", {
      name: "预览附件 receipt-b.webp",
    }));
    const preview = screen.getByRole("dialog", {
      name: "附件大图预览 receipt-b.webp",
    });
    expect(preview.querySelector("img")).toHaveAttribute(
      "src",
      "blob:receipt-b",
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭附件预览" }));
    expect(screen.queryByRole("dialog", { name: /附件大图预览/ }))
      .not.toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("附件（最多三张）"), {
      target: { files: [first, second] },
    });

    fireEvent.click(screen.getByRole("button", {
      name: "移除附件 receipt-a.png",
    }));
    expect(screen.queryByRole("img", { name: "receipt-a.png 缩略图" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "receipt-b.png 缩略图" }))
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
    fireEvent.change(screen.getByLabelText("附件（最多三张）"), {
      target: {
        files: [new File(["receipt"], "receipt.png", { type: "image/png" })],
      },
    });

    fireEvent.click(screen.getByRole("button", {
      name: "移除附件 receipt.png",
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
    fireEvent.change(screen.getByLabelText("附件（最多三张）"), {
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

      const link = screen.getByRole("link", { name: "查看附件 1" });
      expect(link).toHaveAttribute(
        "href",
        "/api/activities/activity-1/expenses/expense-1/attachments/attachment-1",
      );
      expect(link.querySelector("img")).toHaveAttribute("loading", "lazy");
      expect(document.body.textContent).not.toContain("storageKey");
      expect(document.body.innerHTML).not.toContain("blob:");
      expect(document.body.innerHTML).not.toContain("uploads/");
      if (status === "ACTIVE") {
        expect(screen.getByRole("button", { name: "删除附件 1" }))
          .toBeInTheDocument();
      } else {
        expect(screen.queryByRole("button", { name: "删除附件 1" }))
          .not.toBeInTheDocument();
      }
    },
  );

  it("ACTIVE 编辑页确认后立即删除指定已有附件", async () => {
    renderPage(<ExpenseDetailPage />);
    openNoteView();

    fireEvent.click(screen.getByRole("button", { name: "删除附件 1" }));
    expect(screen.getByRole("alertdialog", { name: "删除附件" })).toBeInTheDocument();
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

  it("已同步 Expense 的附件拒绝状态附着在权威流水且不重复分组", () => {
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

    renderPage(<ExpenseFeedPage />);

    expect(screen.queryByRole("heading", { name: "待同步" }))
      .not.toBeInTheDocument();
    expect(screen.getAllByText("午餐")).toHaveLength(1);
    expect(screen.getByText("附件被服务器拒绝。")).toBeInTheDocument();
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

describe("账务空状态插画", () => {
  it("首次流水为空时显示插画", () => {
    accountingQueryState.emptyExpenses = true;
    const { container } = renderPage(<ExpenseFeedPage />);

    expect(screen.getByRole("heading", { name: "还没有流水" })).toBeInTheDocument();
    expect(container.querySelector('img[src="/illustrations/expense-feed-empty.webp"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("筛选无结果时不显示首次流水插画", () => {
    const { container } = renderPage(<ExpenseFeedPage />);
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.change(screen.getByLabelText("搜索"), { target: { value: "不存在的流水" } });

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
  it.each([['500', '应收', 'positive'], ['-500', '应付', 'negative'], ['0', '已结清', null]] as const)("余额 %s 保留正确金额、状态与说明", (netMinor, label, tone) => {
    accountingQueryState.netMinor = netMinor;
    renderPage(<SettlementsPage />);
    const summary = screen.getByRole('region', { name: '我的结算' });
    expect(within(summary).getByText(label, { exact: true })).toBeVisible();
    if (tone) expect(within(summary).getByText('¥5.00')).toHaveClass(`money--${tone}`);
    else expect(summary.querySelector('.money')).toBeNull();
    expect(within(summary).getByText(netMinor === '0' ? '0 人未结清 · 2 人已结清' : '2 人未结清 · 0 人已结清')).toBeVisible();
    expect(within(summary).getByRole('link', { name: '生成分享摘要' })).toHaveAttribute('href', '/share-summary/activity-1');
  });

  it("余额未知时只显示摘要占位，不宣告已结清", () => {
    accountingQueryState.ledgerPending = true;
    renderPage(<SettlementsPage />);
    const summary = screen.getByRole('region', { name: '我的结算' });
    expect(within(summary).getByRole('status', { name: '正在读取我的结算…' })).toBeVisible();
    expect(within(summary).queryByText('已结清')).toBeNull();
    expect(summary.querySelector('.accounting-skeleton__row')).toBeNull();
  });
});

describe("Activity 生命周期写权限", () => {
  it.each(["ACTIVE", "ENDED", "ARCHIVED"])("%s 活动在结算页提供生成分享摘要入口", (status) => {
    activity.status = status;
    renderPage(<SettlementsPage />);

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
    expect(detail).toHaveTextContent("原始金额¥10.00");
    expect(detail).toHaveTextContent("折算金额¥10.00");
    expect(detail).toHaveTextContent("汇率1");
    expect(detail).toHaveTextContent("付款事实甲¥10.00");
    expect(detail).toHaveTextContent("分摊方式均摊");
    expect(detail).toHaveTextContent("成员分摊甲¥5.00乙¥5.00");
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
