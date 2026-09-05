import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

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
const discardMutation = vi.hoisted(() => ({
  error: null,
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
}));
const deleteAttachmentMutation = vi.hoisted(() => ({
  error: null,
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

vi.mock("../activities/pages", () => ({
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
  useDeleteExpenseMutation: mutation,
  useDeleteAttachmentMutation: () => deleteAttachmentMutation,
  useExpenseQuery: () => ({ data: expense, isPending: false }),
  useExchangeRateSuggestionMutation: () => rateMutation,
  useExpensesQuery: () => ({ data: [expense], isPending: false }),
  useLedgerQuery: () => ({ data: { balances: [{ memberId: "member-1", netMinor: "-500" }, { memberId: "member-2", netMinor: "500" }] }, isPending: false }),
  useRecommendationsQuery: () => ({ data: { recommendations: [{ payerMemberId: "member-1", receiverMemberId: "member-2", amountMinor: "500" }] }, isPending: false }),
  useSettlementsQuery: () => ({ data: [settlement], isPending: false }),
  useUpdateExpenseMutation: mutation,
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

import { ExpenseDetailPage, ExpenseFeedPage, NewExpensePage, SettlementsPage } from "./pages";

function renderPage(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
  activity.status = "ACTIVE";
  pendingMutations.records = [];
  workspaceState.offline = false;
  createMutation.mutateAsync.mockClear();
  reviseMutation.mutateAsync.mockClear();
  discardMutation.mutateAsync.mockClear();
  deleteAttachmentMutation.mutateAsync.mockClear();
  rateMutation.mutateAsync.mockClear();
  guestMutation.mutateAsync.mockClear();
  vi.restoreAllMocks();
});

describe("Expense 参考汇率", () => {
  it("只在点击后填入建议，手工修改立即清除自动来源", async () => {
    renderPage(<NewExpensePage />);
    fireEvent.change(screen.getByLabelText("币种"), { target: { value: "JPY" } });
    fireEvent.click(screen.getByRole("button", { name: "获取参考汇率" }));

    await waitFor(() => expect(rateMutation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByPlaceholderText("例如 7.25")).toHaveValue("0.04209");
    expect(screen.getByText("Frankfurter 参考汇率 · 2026-08-30")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("例如 7.25"), { target: { value: "0.043" } });
    expect(screen.queryByText(/Frankfurter 参考汇率/)).not.toBeInTheDocument();
  });

  it("Provider 失败时保留金额、币种与手工输入", async () => {
    rateMutation.mutateAsync.mockRejectedValueOnce(new Error("upstream"));
    renderPage(<NewExpensePage />);
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("币种"), { target: { value: "JPY" } });
    fireEvent.change(screen.getByPlaceholderText("例如 7.25"), { target: { value: "0.041" } });
    fireEvent.click(screen.getByRole("button", { name: "获取参考汇率" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法获取参考汇率，请手动输入。");
    expect(screen.getByPlaceholderText("0.00")).toHaveValue("123");
    expect(screen.getByLabelText("币种")).toHaveValue("JPY");
    expect(screen.getByPlaceholderText("例如 7.25")).toHaveValue("0.041");
  });
});

describe("快捷记账 v0.0.2 信息路径", () => {
  function openQuickExpense() {
    renderPage(<ExpenseFeedPage />);
    const trigger = screen.getByRole("button", { name: "记一笔" });
    trigger.focus();
    fireEvent.click(trigger);
    return { trigger, dialog: screen.getByRole("dialog", { name: "记一笔" }) };
  }

  it("根表单按金额、用途、付款、参与、分摊、分类、更多设置和保存排序", async () => {
    const { dialog } = openQuickExpense();
    await waitFor(() => expect(within(dialog).getByLabelText("金额")).toBeInTheDocument());
    const labels = [...dialog.querySelectorAll(".quick-expense-selection__label")]
      .map((element) => element.textContent);
    expect(labels).toEqual(["谁付款", "谁参与", "分摊设置", "分类"]);
    expect(within(dialog).getByLabelText("用途")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "更多设置" })).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("金额")).toHaveValue("");
    expect(within(dialog).getByLabelText("金额")).toHaveAttribute("data-overlay-initial-focus", "true");
    expect(within(dialog).getByLabelText("用途")).toHaveValue("");
  });

  it("子视图使用动态标题，Back 保持草稿并把焦点还给原入口，Close 后焦点回到 FAB", async () => {
    const { trigger, dialog } = openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "晚餐" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "谁付款" }));

    const payerDialog = screen.getByRole("dialog", { name: "谁付款" });
    expect(within(payerDialog).getByRole("button", { name: "关闭谁付款" })).toBeInTheDocument();
    fireEvent.click(within(payerDialog).getByRole("button", { name: "记一笔" }));

    const rootDialog = screen.getByRole("dialog", { name: "记一笔" });
    expect(within(rootDialog).getByLabelText("金额")).toHaveValue("100");
    expect(within(rootDialog).getByLabelText("用途")).toHaveValue("晚餐");
    await waitFor(() => expect(document.activeElement).toBe(within(rootDialog).getByRole("button", { name: "谁付款" })));
    fireEvent.click(within(rootDialog).getByRole("button", { name: "关闭记一笔" }));
    expect(screen.queryByRole("dialog", { name: "记一笔" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("更多设置使用中文附件入口并保留粘附保存栏", () => {
    const { dialog } = openQuickExpense();
    fireEvent.click(within(dialog).getByRole("button", { name: "更多设置" }));
    expect(within(dialog).getByText("选择图片")).toBeInTheDocument();
    expect(within(dialog).getByText("未选择图片")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("附件（最多三张）")).toHaveAttribute("accept", ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp");
    expect(within(dialog).getByRole("button", { name: "保存" }).parentElement).toHaveClass("quick-expense-submit-bar");
  });

  it("参与人确认、分类和币种确认都回到根表单并保留其他字段", () => {
    const { dialog } = openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "谁参与" }));
    const participantDialog = screen.getByRole("dialog", { name: "谁参与" });
    fireEvent.click(within(participantDialog).getByRole("checkbox", { name: "乙" }));
    fireEvent.click(within(participantDialog).getByRole("button", { name: "完成" }));
    const rootAfterParticipants = screen.getByRole("dialog", { name: "记一笔" });
    expect(within(rootAfterParticipants).getByRole("button", { name: "谁参与" })).toHaveTextContent("1 人");

    fireEvent.click(within(rootAfterParticipants).getByRole("button", { name: "分类" }));
    const categoryDialog = screen.getByRole("dialog", { name: "分类" });
    fireEvent.click(within(categoryDialog).getByRole("radio", { name: "交通" }));
    const rootAfterCategory = screen.getByRole("dialog", { name: "记一笔" });
    expect(within(rootAfterCategory).getByRole("button", { name: "分类" })).toHaveTextContent("交通");

    fireEvent.click(within(rootAfterCategory).getByRole("button", { name: "币种" }));
    const currencyDialog = screen.getByRole("dialog", { name: "选择币种" });
    fireEvent.change(within(currencyDialog).getByPlaceholderText("搜索币种"), { target: { value: "USD" } });
    fireEvent.click(within(currencyDialog).getByRole("button", { name: /USD/ }));
    expect(within(screen.getByRole("dialog", { name: "记一笔" })).getByRole("button", { name: "币种" })).toHaveTextContent("USD");
  });

  it("多人付款严格校验守恒，提交时传递每个付款人的最小单位金额", async () => {
    const { dialog } = openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "多人晚餐" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "谁付款" }));
    const payerDialog = screen.getByRole("dialog", { name: "谁付款" });
    fireEvent.click(within(payerDialog).getByRole("button", { name: "多人付款" }));
    fireEvent.click(within(payerDialog).getByRole("checkbox", { name: "乙" }));
    fireEvent.change(within(payerDialog).getByLabelText("甲付款金额"), { target: { value: "60" } });
    fireEvent.change(within(payerDialog).getByLabelText("乙付款金额"), { target: { value: "40" } });
    expect(within(payerDialog).getByRole("button", { name: "完成" })).toBeEnabled();
    fireEvent.click(within(payerDialog).getByRole("button", { name: "完成" }));
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

  it("精确分摊实时显示守恒汇总，参与人变更会清空旧的精确值", () => {
    const { dialog } = openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "分摊设置" }));
    const splitDialog = screen.getByRole("dialog", { name: "分摊设置" });
    fireEvent.click(within(splitDialog).getByRole("radio", { name: "按金额" }));
    fireEvent.change(within(splitDialog).getByLabelText("甲按金额"), { target: { value: "60" } });
    fireEvent.change(within(splitDialog).getByLabelText("乙按金额"), { target: { value: "40" } });
    expect(splitDialog).toHaveTextContent("已分配 ¥100.00 / ¥100.00");
    fireEvent.click(within(splitDialog).getByRole("button", { name: "完成" }));
    const rootDialog = screen.getByRole("dialog", { name: "记一笔" });
    fireEvent.click(within(rootDialog).getByRole("button", { name: "谁参与" }));
    const participantDialog = screen.getByRole("dialog", { name: "谁参与" });
    fireEvent.click(within(participantDialog).getByRole("checkbox", { name: "乙" }));
    fireEvent.click(within(participantDialog).getByRole("button", { name: "完成" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "记一笔" })).getByRole("button", { name: "分摊设置" }));
    const resetSplitDialog = screen.getByRole("dialog", { name: "分摊设置" });
    expect(within(resetSplitDialog).getByLabelText("甲按金额")).toHaveValue("");
  });

  it("Owner 在线可添加临时成员，离线时添加入口禁用", async () => {
    const { dialog } = openQuickExpense();
    fireEvent.click(within(dialog).getByRole("button", { name: "谁付款" }));
    const payerDialog = screen.getByRole("dialog", { name: "谁付款" });
    fireEvent.click(within(payerDialog).getByRole("button", { name: "添加临时成员" }));
    const guestDialog = screen.getByRole("dialog", { name: "添加临时成员" });
    fireEvent.change(within(guestDialog).getByLabelText("临时成员昵称"), { target: { value: "临时甲" } });
    fireEvent.click(within(guestDialog).getByRole("button", { name: "确认添加" }));
    expect(await screen.findByRole("dialog", { name: "记一笔" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog", { name: "记一笔" })).getByRole("button", { name: "谁付款" })).toHaveTextContent("临时甲");

    workspaceState.offline = true;
    cleanup();
    const offline = openQuickExpense();
    fireEvent.click(within(offline.dialog).getByRole("button", { name: "谁付款" }));
    expect(within(screen.getByRole("dialog", { name: "谁付款" })).getByRole("button", { name: "添加临时成员" })).toBeDisabled();
  });

  it("金额为空时就地展示错误并把焦点交给金额输入", () => {
    const { dialog } = openQuickExpense();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("金额不能为空");
    expect(document.activeElement).toBe(within(dialog).getByLabelText("金额"));
  });

  it("金额格式错误仍定位到金额字段", () => {
    const { dialog } = openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "1.234" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "格式校验" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("金额小数位超过币种精度");
    expect(document.activeElement).toBe(within(dialog).getByLabelText("金额"));
  });

  it("提交时付款守恒失败会回到付款子视图并保留错误", async () => {
    const { dialog } = openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "付款校验" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "谁付款" }));
    const payerDialog = screen.getByRole("dialog", { name: "谁付款" });
    fireEvent.click(within(payerDialog).getByRole("button", { name: "多人付款" }));
    fireEvent.click(within(payerDialog).getByRole("checkbox", { name: "乙" }));
    fireEvent.change(within(payerDialog).getByLabelText("甲付款金额"), { target: { value: "60" } });
    fireEvent.change(within(payerDialog).getByLabelText("乙付款金额"), { target: { value: "40" } });
    fireEvent.click(within(payerDialog).getByRole("button", { name: "完成" }));
    const rootDialog = screen.getByRole("dialog", { name: "记一笔" });
    fireEvent.change(within(rootDialog).getByLabelText("金额"), { target: { value: "99" } });
    fireEvent.click(within(rootDialog).getByRole("button", { name: "保存" }));

    const invalidPayerDialog = await screen.findByRole("dialog", { name: "谁付款" });
    expect(within(invalidPayerDialog).getByRole("alert")).toHaveTextContent("付款合计必须等于消费金额");
  });

  it("提交时分摊守恒失败会回到分摊子视图并保留错误", async () => {
    const { dialog } = openQuickExpense();
    fireEvent.change(within(dialog).getByLabelText("金额"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("用途"), { target: { value: "分摊校验" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "分摊设置" }));
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

describe("Expense 附件选择与私有预览", () => {
  it("新建模式限制为三张受支持图片，编辑模式不再选择附件", () => {
    const create = renderPage(<NewExpensePage />);
    const input = screen.getByLabelText("附件（最多三张）");
    expect(input).toHaveAttribute(
      "accept",
      ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
    );
    create.unmount();

    renderPage(<ExpenseDetailPage />);
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
    const title = screen.getByLabelText("标题");
    const amount = screen.getByPlaceholderText("0.00");
    fireEvent.change(title, { target: { value: "保留的午餐" } });
    fireEvent.change(amount, { target: { value: "12.34" } });

    fireEvent.change(screen.getByLabelText("附件（最多三张）"), {
      target: { files },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(title).toHaveValue("保留的午餐");
    expect(amount).toHaveValue("12.34");
  });

  it("选择图片后显示缩略图，点击缩略图打开大图预览", () => {
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:receipt-a")
      .mockReturnValueOnce("blob:receipt-b");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    renderPage(<NewExpensePage />);
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

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("标题"), {
      target: { value: "保留一张附件" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存账单" }));

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
    fireEvent.change(screen.getByLabelText("标题"), {
      target: { value: "午餐附件" },
    });
    fireEvent.change(screen.getByLabelText("附件（最多三张）"), {
      target: { files: [file] },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存账单" }));

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
    const dialog = screen.getByRole("dialog", { name: "修改被拒账单" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("标题")).toHaveValue("被拒早餐");
    expect(within(dialog).getByLabelText("备注")).toHaveValue("原始备注");

    fireEvent.change(within(dialog).getByLabelText("标题"), { target: { value: "修正早餐" } });
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

describe("Activity 生命周期写权限", () => {
  it.each(["ACTIVE", "ENDED", "ARCHIVED"])("%s 活动在结算页提供生成分享摘要入口", (status) => {
    activity.status = status;
    renderPage(<SettlementsPage />);

    expect(screen.getByRole("link", { name: "生成分享摘要" })).toHaveAttribute("href", "/share-summary/activity-1");
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
