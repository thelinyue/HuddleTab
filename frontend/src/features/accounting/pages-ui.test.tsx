import { cleanup, render, screen } from "@testing-library/react";
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
const pendingMutations = vi.hoisted(() => ({ records: [] as Array<Record<string, unknown>> }));

vi.mock("../activities/pages", () => ({
  useWorkspace: () => ({
    activity,
    session: { displayName: "测试用户", userId: "user-1", username: "tester" },
  }),
}));

vi.mock("../activities/api", () => ({
  useMembersQuery: () => ({ data: members, isPending: false }),
}));

vi.mock("./api", () => ({
  useCreateExpenseMutation: mutation,
  useCreateSettlementMutation: mutation,
  useDeleteExpenseMutation: mutation,
  useExpenseQuery: () => ({ data: expense, isPending: false }),
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
    expect(screen.queryByRole("button", { name: "快速记账" })).not.toBeInTheDocument();
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
