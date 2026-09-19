import { describe, expect, it } from "vitest";
import type { ExpenseAggregate } from "../accounting/api";
import { groupReceiptExpenses, receiptDayLabel } from "./receipt";

function expense(expenseId: string, occurredAt: string): ExpenseAggregate {
  return {
    expense: { expenseId, occurredAt } as ExpenseAggregate["expense"],
    payments: [],
    shares: [],
    attachments: [],
    settlementProgress: {
      currency: "CNY",
      members: [],
      remainingMinor: "0",
      settledMinor: "0",
      status: "NO_SETTLEMENT_REQUIRED",
      totalRequiredMinor: "0",
    },
  };
}

describe("流水小票日期分组", () => {
  it("按日期升序分组，并以活动开始日计算第 X 天", () => {
    const groups = groupReceiptExpenses([
      expense("late", "2026-09-12T04:00:00.000Z"),
      expense("first", "2026-09-10T04:00:00.000Z"),
      expense("middle", "2026-09-11T04:00:00.000Z"),
    ], ["2026-09-12", "2026-09-10"], "2026-09-10");

    expect(groups.map(group => [group.date, group.expenses.map(item => item.expense.expenseId), receiptDayLabel(group)])).toEqual([
      ["2026-09-10", ["first"], "第 1 天 · 2026-09-10"],
      ["2026-09-12", ["late"], "第 3 天 · 2026-09-12"],
    ]);
  });

  it("跨月和闰年仍按自然日计算", () => {
    const groups = groupReceiptExpenses([expense("leap", "2024-03-01T04:00:00.000Z")], ["2024-03-01"], "2024-02-28");
    expect(receiptDayLabel(groups[0]!)).toBe("第 3 天 · 2024-03-01");
  });

  it("跨月预订流水标记为活动前，活动开始日仍是第 1 天", () => {
    const groups = groupReceiptExpenses([
      expense("flight", "2026-09-15T04:00:00.000Z"),
      expense("hotel", "2026-09-20T04:00:00.000Z"),
      expense("departure", "2026-10-01T04:00:00.000Z"),
      expense("dinner", "2026-10-03T04:00:00.000Z"),
    ], ["2026-09-15", "2026-09-20", "2026-10-01", "2026-10-03"], "2026-10-01");

    expect(groups.map(receiptDayLabel)).toEqual([
      "活动前 · 2026-09-15",
      "活动前 · 2026-09-20",
      "第 1 天 · 2026-10-01",
      "第 3 天 · 2026-10-03",
    ]);
  });
});
