import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShareSummaryCard } from "./card";

const readySummary = {
  activityName: "这是一个足够长、需要在手机上自动换行而不能挤出页面边界的活动名称", currency: "CNY",
  memberCount: 2, totalExpenseMinor: "6400", currentUserBalanceMinor: "-3200", state: "ready" as const,
  startDate: "2026-08-30", endDate: null, expenseCount: 2, participatingMemberCount: 2, averageExpenseMinor: "3200", originalCurrencyTotals: [], categoryTotals: [],
  balances: [
    { amountMinor: "3200", displayName: "付款方名字特别长的成员", memberId: "member-b", state: "payable" as const },
    { amountMinor: "3200", displayName: "收款方名字特别长的成员", memberId: "member-a", state: "receivable" as const },
    { amountMinor: "0", displayName: "已经结清的成员", memberId: "member-c", state: "settled" as const },
  ],
  recommendations: [{ amountMinor: "3200", payerName: "付款方名字特别长的成员", receiverName: "收款方名字特别长的成员" }],
};

describe("ShareSummaryCard", () => {
  afterEach(cleanup);

  it("完整展示 v0.0.2 的结算结论、说明和品牌区", () => {
    render(<ShareSummaryCard summary={readySummary} id="summary-card" />);
    const card = screen.getByRole("article", { name: /结算摘要/ });
    expect(card).toHaveAttribute("id", "summary-card");
    expect(within(card).getByText("结算摘要")).toBeVisible();
    expect(within(card).getByRole("heading", { name: readySummary.activityName })).toBeVisible();
    expect(within(card).getByText(/2人 · 总支出/)).toHaveTextContent("¥64.00");

    const viewer = within(card).getByRole("region", { name: "我的结算" });
    expect(viewer).toHaveTextContent("应付¥32.00");
    const recommendations = within(card).getByRole("list", { name: "推荐结算" });
    expect(within(recommendations).getByRole("listitem")).toHaveTextContent("付款方名字特别长的成员 向 收款方名字特别长的成员 支付¥32.00");
    const balances = within(card).getByRole("list", { name: "成员余额" });
    expect(within(balances).getAllByRole("listitem")[2]).toHaveTextContent("已经结清的成员已结清¥0.00");
    expect(within(card).getByRole("region", { name: "结算说明" })).toHaveTextContent("推荐结算已尽量减少转账次数");
    expect(within(card).getByText("一起消费，清楚结算")).toBeVisible();
  });

  it.each([
    ["zero", "当前总消费为零，无需转账"],
    ["settled", "当前无需推荐转账"],
  ] as const)("%s 状态保留完整模板并显示明确空状态", (state, emptyMessage) => {
    render(<ShareSummaryCard summary={{ ...readySummary, state, currentUserBalanceMinor: "0", totalExpenseMinor: state === "zero" ? "0" : "6400", recommendations: [] }} />);
    const card = screen.getByRole("article");
    expect(card).toHaveAttribute("data-state", state);
    expect(within(card).getByRole("region", { name: "我的结算" })).toHaveTextContent("已结清¥0.00");
    expect(within(card).getByRole("list", { name: "推荐结算" })).toHaveTextContent(emptyMessage);
    expect(within(card).getByText("当前无需转账")).toBeVisible();
  });

  it("预览和导出实例使用各自的标题关联 ID", () => {
    render(<><ShareSummaryCard summary={readySummary} /><ShareSummaryCard summary={readySummary} id="share-summary-card" /></>);
    expect(document.querySelectorAll("#share-summary-preview-card-viewer")).toHaveLength(1);
    expect(document.querySelectorAll("#share-summary-card-viewer")).toHaveLength(1);
  });
});
