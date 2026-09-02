import { describe, expect, it } from "vitest";
import type { ExpenseAggregate } from "./api";
import { groupExpensesByDate } from "./pages";

function aggregate(expenseId: string, occurredAt: string): ExpenseAggregate {
  return {
    attachments: [],
    expense: {
      activityId: "activity-1",
      baseAmountMinor: "100",
      baseCurrency: "CNY",
      category: "FOOD",
      clientMutationId: `mutation-${expenseId}`,
      createdAt: occurredAt,
      exchangeRate: "1",
      exchangeRateKind: "IDENTITY",
      expenseId,
      occurredAt,
      originalAmountMinor: "100",
      originalCurrency: "CNY",
      revision: "1",
      splitMode: "EQUAL",
      title: expenseId,
      updatedAt: occurredAt,
      version: "1",
    },
    payments: [],
    shares: [],
  };
}

describe("groupExpensesByDate", () => {
  it("不依赖接口顺序，按日期倒序合并同日流水", () => {
    const groups = groupExpensesByDate([
      aggregate("earlier", "2026-08-30T09:00:00.000Z"),
      aggregate("latest", "2026-08-31T12:00:00.000Z"),
      aggregate("same-day", "2026-08-31T08:00:00.000Z"),
    ], "UTC");

    expect(groups.map((group) => group.date)).toEqual(["2026-08-31", "2026-08-30"]);
    expect(groups[0]?.expenses.map(({ expense }) => expense.expenseId)).toEqual(["latest", "same-day"]);
  });
});
