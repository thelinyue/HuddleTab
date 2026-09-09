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
  it("群聊摘要保留完整姓名、转账方向、余额和币种，不展示个人视角", () => {
    render(<ShareSummaryCard summary={readySummary} />);
    const card = screen.getByRole("article");
    expect(card).toHaveTextContent(readySummary.activityName);
    expect(card).toHaveTextContent("付款方名字特别长的成员 → 收款方名字特别长的成员");
    expect(card).toHaveTextContent("应收");
    expect(card).toHaveTextContent("应付");
    expect(card).toHaveTextContent("已结清");
    expect(card).toHaveTextContent("CNY");
    expect(card).toHaveTextContent("第 1 / 1 页");
    expect(within(card).queryByText("我的结算")).toBeNull();
    expect(card.querySelector("img")).toBeNull();
  });
  it("当前页只展示指定条目，并重复活动信息与页码", () => {
    render(<ShareSummaryCard summary={readySummary} items={[{ key: "balance-member-a", kind: "balance", index: 1 }]} page={2} pageCount={3} />);
    expect(screen.getByRole("article")).toHaveTextContent("第 2 / 3 页");
    expect(screen.queryByText("付款方名字特别长的成员")).toBeNull();
    expect(screen.getByText("收款方名字特别长的成员")).toBeVisible();
  });
  it.each(["zero", "settled"] as const)("%s 显示明确结清状态", state => {
    render(<ShareSummaryCard summary={{ ...readySummary, state, recommendations: [] }} />);
    expect(screen.getByText(state === "zero" ? "当前总消费为零，无需转账" : "全部已结清，无需转账")).toBeVisible();
  });
});
