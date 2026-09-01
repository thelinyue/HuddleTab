import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShareSummaryCard } from "./card";

const readySummary = {
  activityName: "这是一个足够长、需要在手机上自动换行而不能挤出页面边界的活动名称", currency: "CNY",
  memberCount: 2, totalExpenseMinor: "6400", currentUserBalanceMinor: "-3200", state: "ready" as const,
  balances: [
    { amountMinor: "3200", displayName: "付款方名字特别长的成员", memberId: "member-b", state: "payable" as const },
    { amountMinor: "3200", displayName: "收款方名字特别长的成员", memberId: "member-a", state: "receivable" as const },
  ],
  recommendations: [{ amountMinor: "3200", payerName: "付款方名字特别长的成员", receiverName: "收款方名字特别长的成员" }],
};

describe("ShareSummaryCard", () => {
  it("展示推荐付款和成员余额，长名称保留在可换行容器内", () => {
    render(<ShareSummaryCard summary={readySummary} />);
    expect(screen.getByText("推荐转账")).toBeInTheDocument();
    expect(screen.getAllByText("付款方名字特别长的成员")).toHaveLength(2);
    expect(screen.getAllByText("收款方名字特别长的成员")).toHaveLength(2);
    expect(screen.getByText("应付")).toBeInTheDocument();
    expect(screen.getByText("应收")).toBeInTheDocument();
  });

  it.each([
    ["empty", "还没有账单", "录入账单后可生成结算建议。"],
    ["settled", "全部已结清", "当前没有待处理的转账。"],
  ] as const)("%s 状态展示明确文字而非只靠颜色", (state, title, description) => {
    render(<ShareSummaryCard summary={{ ...readySummary, state, totalExpenseMinor: state === "empty" ? "0" : "6400", recommendations: [] }} />);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
  });
});
