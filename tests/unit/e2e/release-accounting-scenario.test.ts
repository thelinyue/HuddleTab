import { describe, expect, test } from "vitest";

import {
  buildTripDates,
  categoryTotalsMinor,
  dailyExpectedBalancesMinor,
  tripExpenses,
  tripSettlements,
  tripSettlementCounts,
} from "../../e2e/release/four-day-accounting-scenario";

describe("四日旅行发布门禁账本", () => {
  test("按部署时区生成连续四个本地日期", () => {
    expect(
      buildTripDates(new Date("2026-08-28T01:30:00.000Z"), "Asia/Shanghai"),
    ).toEqual(["2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]);
    expect(
      buildTripDates(new Date("2026-08-28T01:30:00.000Z"), "America/New_York"),
    ).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"]);
  });

  test("十二笔最终账单覆盖四种分摊、多人付款、外币与部分成员", () => {
    expect(tripExpenses).toHaveLength(12);
    expect(new Set(tripExpenses.map((expense) => expense.split.mode))).toEqual(
      new Set(["EQUAL", "EXACT", "PERCENTAGE", "WEIGHT"]),
    );
    expect(
      tripExpenses.filter((expense) => expense.payments.length > 1),
    ).toHaveLength(3);
    expect(
      tripExpenses.some(
        (expense) =>
          expense.originalCurrency === "JPY" && expense.exchangeRate === "0.05",
      ),
    ).toBe(true);
    expect(
      tripExpenses.filter((expense) => expense.participants.length < 4),
    ).toHaveLength(5);
  });

  test("主币、分类、每日余额和结算笔数使用手工复算的固定值", () => {
    expect(
      tripExpenses.reduce(
        (sum, expense) => sum + BigInt(expense.baseAmountMinor),
        0n,
      ),
    ).toBe(479_400n);
    expect(categoryTotalsMinor()).toEqual({
      ENTERTAINMENT: 42_000n,
      FOOD: 96_800n,
      LODGING: 120_000n,
      SHOPPING: 44_600n,
      TICKET: 110_000n,
      TRANSPORT: 66_000n,
    });
    expect(dailyExpectedBalancesMinor).toEqual([
      { owner: 102_000n, a: -25_200n, b: -33_600n, c: -43_200n },
      { owner: -36_200n, a: 6_600n, b: -4_200n, c: 33_800n },
      { owner: 37_500n, a: -19_500n, b: -6_500n, c: -11_500n },
      { owner: -8_000n, a: 24_000n, b: 2_000n, c: -18_000n },
    ]);
    expect(tripSettlementCounts).toEqual([3, 6, 9, 12]);
    expect(tripSettlements).toEqual([
      { dayIndex: 0, payer: "a", receiver: "owner", amount: "252" },
      { dayIndex: 0, payer: "b", receiver: "owner", amount: "336" },
      { dayIndex: 0, payer: "c", receiver: "owner", amount: "432" },
      { dayIndex: 1, payer: "owner", receiver: "c", amount: "338" },
      { dayIndex: 1, payer: "b", receiver: "a", amount: "42" },
      { dayIndex: 1, payer: "owner", receiver: "a", amount: "24" },
      { dayIndex: 2, payer: "a", receiver: "owner", amount: "195" },
      { dayIndex: 2, payer: "c", receiver: "owner", amount: "115" },
      { dayIndex: 2, payer: "b", receiver: "owner", amount: "65" },
      { dayIndex: 3, payer: "c", receiver: "a", amount: "180" },
      { dayIndex: 3, payer: "owner", receiver: "a", amount: "60" },
      { dayIndex: 3, payer: "owner", receiver: "b", amount: "20" },
    ]);
  });
});
