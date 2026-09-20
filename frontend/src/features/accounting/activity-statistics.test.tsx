import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { ActivityMember } from "../activities/api";
import type { ExpenseAggregate } from "./api";

const members = [
  { activityId: "activity-1", avatarPreset: 1, displayName: "甲", memberId: "member-1", role: "OWNER", status: "ACTIVE", userId: "user-1", version: "1" },
  { activityId: "activity-1", avatarPreset: 2, displayName: "乙", memberId: "member-2", role: "MEMBER", status: "ACTIVE", userId: "user-2", version: "1" },
  { activityId: "activity-1", avatarPreset: 3, displayName: "丙", memberId: "member-3", role: "MEMBER", status: "LEFT", userId: null, version: "2" },
] satisfies ActivityMember[];

function expense(
  id: string,
  category: string,
  occurredAt: string,
  amount: string,
  payments: Array<[string, string]>,
  shares: Array<[string, string]>,
): ExpenseAggregate {
  return {
    attachments: [],
    expense: {
      activityId: "activity-1",
      baseAmountMinor: amount,
      baseCurrency: "CNY",
      category,
      clientMutationId: `mutation-${id}`,
      createdAt: occurredAt,
      exchangeRate: "1",
      exchangeRateKind: "IDENTITY",
      expenseId: id,
      note: null,
      occurredAt,
      originalAmountMinor: amount,
      originalCurrency: "CNY",
      revision: "1",
      splitMode: "EXACT",
      title: id,
      updatedAt: occurredAt,
      version: "1",
    },
    payments: payments.map(([memberId, baseAmountMinor], index) => ({ baseAmountMinor, factId: `${id}-payment-${index}`, memberId, originalAmountMinor: baseAmountMinor })),
    settlementProgress: { currency: "CNY", members: [], remainingMinor: amount, settledMinor: "0", status: "UNSETTLED", totalRequiredMinor: amount },
    shares: shares.map(([memberId, baseAmountMinor], index) => ({ baseAmountMinor, factId: `${id}-share-${index}`, memberId, originalAmountMinor: baseAmountMinor })),
  };
}

const expenses = [
  expense("午餐", "FOOD", "2026-09-01T08:00:00Z", "1000", [["member-1", "1000"]], [["member-1", "400"], ["member-2", "600"]]),
  expense("打车", "TRANSPORT", "2026-09-02T08:00:00Z", "500", [["member-2", "500"]], [["member-1", "500"]]),
];

vi.mock("../activities/workspace-context", () => ({
  useWorkspace: () => ({
    activity: { activityId: "activity-1", baseCurrency: "CNY" },
    members,
    offline: false,
    session: { userId: "user-1" },
    snapshot: undefined,
  }),
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    useExpensesQuery: () => ({ data: expenses, error: null, isPending: false, refetch: vi.fn() }),
  };
});

import { ActivityStatisticsPage, buildActivityStatistics } from "./activity-statistics";

describe("活动统计聚合", () => {
  it("按主币种事实汇总分类、日期、总消费和总支出", () => {
    const result = buildActivityStatistics(expenses, members, "UTC");

    expect(result.totalMinor).toBe(1500n);
    expect(result.categories.map((item) => [item.key, item.amountMinor])).toEqual([["FOOD", 1000n], ["TRANSPORT", 500n]]);
    expect(result.days).toEqual([
      { amountMinor: 1000n, date: "2026-09-01" },
      { amountMinor: 500n, date: "2026-09-02" },
    ]);
    expect(result.members.map((item) => [item.member.displayName, item.consumptionMinor, item.billPaymentMinor])).toEqual([
      ["甲", 900n, 1000n],
      ["乙", 600n, 500n],
      ["丙", 0n, 0n],
    ]);
  });

  it("未知分类归入其他，同额成员保持原列表顺序", () => {
    const records = [expense("未知", "CUSTOM", "2026-09-03T08:00:00Z", "300", [["member-1", "300"]], [["member-1", "150"], ["member-2", "150"]])];
    const result = buildActivityStatistics(records, members, "UTC");

    expect(result.categories.map((item) => [item.key, item.label, item.amountMinor])).toEqual([["OTHER", "其他", 300n]]);
    expect(result.members.map((item) => item.member.memberId)).toEqual(["member-1", "member-2", "member-3"]);
  });
});

describe("活动统计页面", () => {
  it("提供可读图表、两类成员金额和已移除状态", () => {
    render(<MemoryRouter><ActivityStatisticsPage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "分类消费" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /分类消费圆形图，总消费¥15\.00/ })).toBeInTheDocument();
    expect(screen.getByLabelText("每日消费柱状图")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "成员费用" })).toBeInTheDocument();
    const helpTrigger = screen.getByRole("button", { name: "成员费用说明" });
    expect(screen.queryByText("按账单分摊结果统计到该成员名下的消费金额。")).not.toBeInTheDocument();
    fireEvent.click(helpTrigger);
    expect(screen.getByText("按账单分摊结果统计到该成员名下的消费金额。")).toBeVisible();
    expect(screen.getByText("该成员实际支付给商家的账单金额。")).toBeVisible();
    const rows = document.querySelectorAll(".activity-statistics-member-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText("甲")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getAllByText("¥9.00").length).toBeGreaterThan(0);
    expect(within(rows[0] as HTMLElement).getAllByText("¥10.00").length).toBeGreaterThan(0);
    expect(within(rows[2] as HTMLElement).getByText("已移除")).toBeInTheDocument();
  });
});
