import { describe, expect, it } from "vitest";
import { allocateByWeights } from "@/domain/splitting/allocation";

describe("allocateByWeights", () => {
  it("gives remainder units to ActivityMember ids in ascending order", () => {
    expect(
      allocateByWeights(10000n, [
        { memberId: "c", weight: 1n },
        { memberId: "a", weight: 1n },
        { memberId: "b", weight: 1n },
      ]),
    ).toEqual([
      { memberId: "a", amountMinor: 3334n },
      { memberId: "b", amountMinor: 3333n },
      { memberId: "c", amountMinor: 3333n },
    ]);
  });

  it("rejects duplicate members and non-positive weights", () => {
    expect(() =>
      allocateByWeights(10n, [
        { memberId: "a", weight: 1n },
        { memberId: "a", weight: 1n },
      ]),
    ).toThrow("分配成员不能重复");
    expect(() =>
      allocateByWeights(10n, [{ memberId: "a", weight: 0n }]),
    ).toThrow("分配权重必须大于零");
  });
});
