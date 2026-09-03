import { describe, expect, it } from "vitest";
import { mapActivitySummary } from "./adapter";

describe("mapActivitySummary", () => {
  it("将生成的摘要 DTO 映射为带姓名和金额方向的展示模型", () => {
    const summary = mapActivitySummary({
      activityName: "秋日江南行",
      balances: [
        { displayName: "甲", memberId: "member-a", netMinor: "3200" },
        { displayName: "乙", memberId: "member-b", netMinor: "-3200" },
      ],
      currency: "CNY",
      currentUserBalanceMinor: "-3200",
      memberCount: 2,
      recommendations: [{ payerMemberId: "member-b", receiverMemberId: "member-a", amountMinor: "3200" }],
      revision: "12",
      totalExpenseMinor: "6400",
      startDate: "2026-08-30",
      endDate: null,
      expenseCount: 2,
      participatingMemberCount: 2,
      averageExpenseMinor: "3200",
      originalCurrencyTotals: [{ currency: "JPY", amountMinor: "8000" }],
      categoryTotals: [{ category: "FOOD", amountMinor: "6400" }],
    });

    expect(summary.balances).toEqual([
      { amountMinor: "3200", displayName: "甲", memberId: "member-a", state: "receivable" },
      { amountMinor: "3200", displayName: "乙", memberId: "member-b", state: "payable" },
    ]);
    expect(summary.recommendations).toEqual([
      { amountMinor: "3200", payerName: "乙", receiverName: "甲" },
    ]);
    expect(summary.startDate).toBe("2026-08-30");
    expect(summary.expenseCount).toBe(2);
    expect(summary.averageExpenseMinor).toBe("3200");
    expect(summary.originalCurrencyTotals).toEqual([{ currency: "JPY", amountMinor: "8000" }]);
    expect(summary.categoryTotals).toEqual([{ category: "FOOD", amountMinor: "6400" }]);
    expect(summary.state).toBe("ready");
  });

  it.each([
    ["zero", "0", [{ displayName: "甲", memberId: "member-a", netMinor: "0" }]],
    ["settled", "1200", [{ displayName: "甲", memberId: "member-a", netMinor: "0" }]],
  ] as const)("账本总额为 %s 时映射对应摘要状态", (state, totalExpenseMinor, balances) => {
    expect(mapActivitySummary({
      activityName: "测试活动", balances: [...balances], currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1,
      recommendations: [], revision: "1", totalExpenseMinor,
      startDate: "2026-08-30", endDate: null, expenseCount: 1,
      participatingMemberCount: 1, averageExpenseMinor: totalExpenseMinor,
      originalCurrencyTotals: [], categoryTotals: [],
    }).state).toBe(state);
  });
});
