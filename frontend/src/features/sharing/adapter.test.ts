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
    });

    expect(summary.balances).toEqual([
      { amountMinor: "3200", displayName: "甲", memberId: "member-a", state: "receivable" },
      { amountMinor: "3200", displayName: "乙", memberId: "member-b", state: "payable" },
    ]);
    expect(summary.recommendations).toEqual([
      { amountMinor: "3200", payerName: "乙", receiverName: "甲" },
    ]);
    expect(summary.state).toBe("ready");
  });

  it.each([
    ["empty", "0", [{ displayName: "甲", memberId: "member-a", netMinor: "0" }]],
    ["settled", "1200", [{ displayName: "甲", memberId: "member-a", netMinor: "0" }]],
  ] as const)("账本总额为 %s 时映射对应摘要状态", (state, totalExpenseMinor, balances) => {
    expect(mapActivitySummary({
      activityName: "测试活动", balances: [...balances], currency: "CNY", currentUserBalanceMinor: "0", memberCount: 1,
      recommendations: [], revision: "1", totalExpenseMinor,
    }).state).toBe(state);
  });
});
