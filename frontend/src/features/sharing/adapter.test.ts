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
      effectiveStrategy: "MIN_TRANSFERS",
      hubMemberId: null,
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

  it("保留 Rust 返回的统一结算人和策略，不在前端重算转账", () => {
    const summary = mapActivitySummary({
      activityName: "统一结算", balances: [{ displayName: "林樾", memberId: "hub", netMinor: "0" }],
      currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1,
      recommendations: [{ payerMemberId: "guest", receiverMemberId: "hub", amountMinor: "500" }],
      revision: "1", totalExpenseMinor: "500", startDate: "2026-08-30", endDate: null,
      expenseCount: 1, participatingMemberCount: 1, averageExpenseMinor: "500",
      originalCurrencyTotals: [], categoryTotals: [], effectiveStrategy: "CENTRALIZED", hubMemberId: "hub",
    });

    expect(summary.effectiveStrategy).toBe("CENTRALIZED");
    expect(summary.hubMemberId).toBe("hub");
    expect(summary.hubName).toBe("林樾");
    expect(summary.recommendations).toEqual([{ amountMinor: "500", payerName: "未知成员", receiverName: "林樾" }]);
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
      effectiveStrategy: "MIN_TRANSFERS", hubMemberId: null,
    }).state).toBe(state);
  });
});
