import { describe, expect, it } from "vitest";
import { splitExpense } from "@/domain/splitting/split";

describe("splitExpense", () => {
  it("supports all four modes with exact conservation", () => {
    expect(
      splitExpense({
        mode: "EQUAL",
        totalMinor: 100n,
        memberIds: ["c", "a", "b"],
      }),
    ).toEqual([
      { memberId: "a", amountMinor: 34n },
      { memberId: "b", amountMinor: 33n },
      { memberId: "c", amountMinor: 33n },
    ]);
    expect(
      splitExpense({
        mode: "EXACT",
        totalMinor: 100n,
        shares: [
          { memberId: "a", amountMinor: 60n },
          { memberId: "b", amountMinor: 40n },
        ],
      }),
    ).toHaveLength(2);
    expect(
      splitExpense({
        mode: "PERCENTAGE",
        totalMinor: 101n,
        shares: [
          { memberId: "b", basisPoints: 5000n },
          { memberId: "a", basisPoints: 5000n },
        ],
      })[0],
    ).toEqual({ memberId: "a", amountMinor: 51n });
    expect(
      splitExpense({
        mode: "WEIGHT",
        totalMinor: 100n,
        shares: [
          { memberId: "a", weightHundredths: 100n },
          { memberId: "b", weightHundredths: 300n },
        ],
      }),
    ).toEqual([
      { memberId: "a", amountMinor: 25n },
      { memberId: "b", amountMinor: 75n },
    ]);
  });

  it("rejects invalid exact and percentage totals", () => {
    expect(() =>
      splitExpense({
        mode: "EXACT",
        totalMinor: 100n,
        shares: [{ memberId: "a", amountMinor: 99n }],
      }),
    ).toThrow("指定金额合计必须等于消费总额");
    expect(() =>
      splitExpense({
        mode: "PERCENTAGE",
        totalMinor: 100n,
        shares: [{ memberId: "a", basisPoints: 9999n }],
      }),
    ).toThrow("比例合计必须等于 100.00%");
  });
});
