import { describe, expect, it } from "vitest";

import { prepareExpense } from "@/domain/expenses/prepare-expense";

const members = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

describe("prepareExpense", () => {
  it("付款人与承担人独立，并稳定分配外币换算尾差", () => {
    const result = prepareExpense({
      originalCurrency: "JPY",
      baseCurrency: "CNY",
      originalAmountMinor: 6001n,
      exchangeRate: "0.048",
      payments: [{ memberId: members[2], amountMinor: 6001n }],
      split: { mode: "EQUAL", members: members.slice(0, 2) },
    });

    expect(result.baseAmountMinor).toBe(28805n);
    expect(result.payments.map((row) => row.baseAmountMinor)).toEqual([28805n]);
    expect(result.shares.map((row) => row.originalAmountMinor)).toEqual([
      3001n,
      3000n,
    ]);
    expect(
      result.shares.reduce((sum, row) => sum + row.baseAmountMinor, 0n),
    ).toBe(28805n);
  });

  it("比例必须精确等于 10000 基点", () => {
    expect(() =>
      prepareExpense({
        originalCurrency: "CNY",
        baseCurrency: "CNY",
        originalAmountMinor: 100n,
        exchangeRate: "1",
        payments: [{ memberId: members[0], amountMinor: 100n }],
        split: {
          mode: "PERCENTAGE",
          entries: [
            { memberId: members[0], value: 3333n },
            { memberId: members[1], value: 3333n },
          ],
        },
      }),
    ).toThrowError("比例合计必须等于 100.00%");
  });
});
