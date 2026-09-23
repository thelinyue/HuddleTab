import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

let offline = false;
let queryData: ExpenseAggregate[] | undefined = expenses;
let queryError: Error | null = null;
let snapshotExpenses: ExpenseAggregate[] | undefined;
const refetch = vi.fn();
beforeEach(() => { offline = false; queryData = expenses; queryError = null; snapshotExpenses = undefined; refetch.mockClear(); });
afterEach(cleanup);

vi.mock("../activities/workspace-context", () => ({
  useWorkspace: () => ({
    activity: { activityId: "activity-1", baseCurrency: "CNY" },
    members,
    offline,
    session: { userId: "user-1" },
    snapshot: snapshotExpenses ? { snapshot: { expenses: snapshotExpenses } } : undefined,
  }),
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    useExpensesQuery: () => ({ data: queryData, error: queryError, isPending: !queryData && !queryError, refetch }),
  };
});

import { ActivityStatisticsPage, buildActivityStatistics } from "./activity-statistics";

describe("活动统计聚合", () => {
  it("按主币种事实汇总分类、日期、总消费和总支出", () => {
    const result = buildActivityStatistics(expenses, members, "UTC");

    expect(result.totalMinor).toBe(1500n);
    expect(result.categories.map((item) => [item.key, item.amountMinor])).toEqual([["FOOD", 1000n], ["TRANSPORT", 500n]]);
    expect(result.days).toEqual([
      { amountMinor: 1000n, cumulativeMinor: 1000n, date: "2026-09-01" },
      { amountMinor: 500n, cumulativeMinor: 1500n, date: "2026-09-02" },
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

  it("按本地日期包含范围边界，累计从范围内重新开始并补齐零消费日", () => {
    const records = [
      expense("前一天", "FOOD", "2026-08-31T15:59:59Z", "900", [], []),
      expense("首日", "FOOD", "2026-08-31T16:00:00Z", "101", [], []),
      expense("末日", "FOOD", "2026-09-03T15:59:59Z", "200", [], []),
      expense("后一天", "FOOD", "2026-09-03T16:00:00Z", "800", [], []),
    ];
    const result = buildActivityStatistics(records, members, "Asia/Shanghai", { from: "2026-09-01", to: "2026-09-03" });
    expect(result.totalMinor).toBe(301n);
    expect(result.billCount).toBe(2);
    expect(result.consumptionDays).toBe(2);
    expect(result.averageBillMinor).toBe(151n);
    expect(result.averageMemberMinor).toBe(151n);
    expect(result.days.map(day => [day.date, day.amountMinor, day.cumulativeMinor])).toEqual([
      ["2026-09-01", 101n, 101n], ["2026-09-02", 0n, 101n], ["2026-09-03", 200n, 301n],
    ]);
    expect(result.categories[0]?.count).toBe(2);
  });

  it("跨夏令时仍逐自然日连续，单日范围有效", () => {
    const records = [expense("首日", "FOOD", "2026-03-07T17:00:00Z", "100", [], []), expense("末日", "FOOD", "2026-03-09T16:00:00Z", "200", [], [])];
    expect(buildActivityStatistics(records, members, "America/New_York").days.map(day => day.date)).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
    expect(buildActivityStatistics(records, members, "America/New_York", { from: "2026-03-09", to: "2026-03-09" }).totalMinor).toBe(200n);
  });

  it("原币种不参与加总，大金额保持精度，排行取五笔且同额排序稳定", () => {
    const records = Array.from({ length: 7 }, (_, index) => {
      const item = expense(`账单${index}`, "FOOD", "2026-09-01T08:00:00Z", String(9007199254740993n + BigInt(index)), [], []);
      item.expense.originalCurrency = index % 2 ? "JPY" : "USD";
      item.expense.originalAmountMinor = "1";
      return item;
    });
    const result = buildActivityStatistics(records, members, "UTC");
    expect(result.totalMinor).toBe(63050394783186972n);
    expect(result.topExpenses.map(item => item.expense.title)).toEqual(["账单6", "账单5", "账单4", "账单3", "账单2"]);
    const tied = buildActivityStatistics([expenses[0]!, { ...expenses[0]!, expense: { ...expenses[0]!.expense, expenseId: "aaa", occurredAt: "2026-09-01T09:00:00Z" } }], members, "UTC");
    expect(tied.topExpenses[0]?.expense.expenseId).toBe("aaa");
  });

  it("保留已移除成员历史金额，零分母返回空均额", () => {
    const record = expense("历史", "FOOD", "2026-09-01T08:00:00Z", "301", [["member-3", "301"]], [["member-3", "301"]]);
    const result = buildActivityStatistics([record], members, "UTC");
    expect(result.members[2]?.consumptionMinor).toBe(301n);
    expect(result.members[2]?.billPaymentMinor).toBe(301n);
    expect(result.averageMemberMinor).toBe(151n);
    const empty = buildActivityStatistics([], [], "UTC");
    expect(empty.averageBillMinor).toBeNull();
    expect(empty.averageMemberMinor).toBeNull();
    expect(empty.days).toEqual([]);
  });
});

function LocationProbe() { const location = useLocation(); return <output data-testid="location">{location.search}|{JSON.stringify(location.state)}</output>; }

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

  it("全部图表切换写入 URL 且保留来源，成员按支出排序", () => {
    queryData = [expense("代付", "FOOD", "2026-09-01T08:00:00Z", "1000", [["member-2", "1000"]], [["member-1", "1000"]])];
    render(<MemoryRouter initialEntries={[{ pathname: "/statistics", state: { activityStatisticsFromTab: "settlement" } }]}><ActivityStatisticsPage /><LocationProbe /></MemoryRouter>);
    for (const name of ["笔数", "条形", "累计消费", "按总支出", "明细"]) fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByTestId("location")).toHaveTextContent("categoryMetric=count&categoryView=bar&trend=cumulative&memberSort=payment&memberView=list");
    expect(screen.getByTestId("location")).toHaveTextContent('"activityStatisticsFromTab":"settlement"');
    expect(screen.getByRole("img", { name: /累计消费折线图/ })).toBeVisible();
    expect(within(document.querySelector(".activity-statistics-member-row") as HTMLElement).getByText("乙")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "环形" }));
    expect(screen.getByRole("img", { name: /分类消费圆形图，账单1笔/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "每日消费" }));
    fireEvent.click(screen.getByRole("button", { name: "对比" }));
    fireEvent.click(screen.getByRole("button", { name: "金额" }));
    expect(screen.getByLabelText("每日消费柱状图")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "人均消费说明" }));
    expect(screen.getByText(/所选范围总消费除以当前活动成员数/)).toBeVisible();
  });

  it("范围同步影响摘要、分类、成员和排行，重置恢复整个活动", () => {
    render(<MemoryRouter initialEntries={["/statistics?from=2026-09-02&to=2026-09-02"]}><ActivityStatisticsPage /></MemoryRouter>);
    expect(within(screen.getByLabelText("活动消费总览")).getByText("1 笔")).toBeVisible();
    expect(screen.queryByRole("link", { name: /午餐/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /打车/ })).toBeVisible();
    expect(screen.getByLabelText("分类消费明细")).not.toHaveTextContent("餐饮");
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(screen.getByRole("link", { name: /午餐/ })).toBeVisible();
    expect(within(screen.getByLabelText("活动消费总览")).getByText("2 笔")).toBeVisible();
  });

  it("选择同一天可应用，取消日期草稿不改变范围", () => {
    render(<MemoryRouter><ActivityStatisticsPage /><LocationProbe /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "选择统计日期范围" }));
    const day = screen.getByRole("button", { name: /2026年9月2日/ });
    fireEvent.click(day); fireEvent.click(day);
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(screen.getByTestId("location")).toHaveTextContent("from=2026-09-02&to=2026-09-02");
    fireEvent.click(screen.getByRole("button", { name: "选择统计日期范围" }));
    fireEvent.click(screen.getByRole("button", { name: /2026年9月3日/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByTestId("location")).toHaveTextContent("from=2026-09-02&to=2026-09-02");
  });

  it("筛选无结果允许恢复，非法 URL 日期回退整个活动", () => {
    const view = render(<MemoryRouter initialEntries={["/statistics?from=2025-01-01&to=2025-01-02"]}><ActivityStatisticsPage /></MemoryRouter>);
    expect(screen.getByText("所选日期暂无账单")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "查看整个活动" }));
    expect(screen.getByRole("heading", { name: "分类消费" })).toBeVisible();
    view.unmount();
    render(<MemoryRouter initialEntries={["/statistics?from=2026-02-30&to=2026-03-01"]}><ActivityStatisticsPage /></MemoryRouter>);
    expect(within(screen.getByLabelText("活动消费总览")).getByText("2 笔")).toBeVisible();
  });

  it("无账单有专属空态", () => {
    queryData = [];
    render(<MemoryRouter><ActivityStatisticsPage /></MemoryRouter>);
    expect(screen.getByText("活动暂无账单")).toBeVisible();
  });

  it("离线无快照不会一直加载，存在快照时继续统计", () => {
    offline = true; queryData = undefined;
    const view = render(<MemoryRouter><ActivityStatisticsPage /></MemoryRouter>);
    expect(screen.getByText(/离线快照不可用/)).toBeVisible();
    snapshotExpenses = expenses;
    view.rerender(<MemoryRouter><ActivityStatisticsPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "分类消费" })).toBeVisible();
    expect(screen.getByText(/最近一次同步的活动数据/)).toBeVisible();
  });

  it("请求失败支持重试，缓存存在时保留内容", () => {
    queryData = undefined; queryError = new Error("暂时无法读取统计");
    const view = render(<MemoryRouter><ActivityStatisticsPage /></MemoryRouter>);
    expect(screen.getByText("暂时无法读取统计")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(refetch).toHaveBeenCalledOnce();
    queryData = expenses;
    view.rerender(<MemoryRouter><ActivityStatisticsPage /></MemoryRouter>);
    expect(screen.getByText(/统计更新失败/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "分类消费" })).toBeVisible();
  });
});
