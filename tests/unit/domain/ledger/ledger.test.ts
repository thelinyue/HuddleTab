import { describe, expect, it } from "vitest";
import { calculateLedger } from "@/domain/ledger/ledger";

describe("calculateLedger", () => {
  it("uses payment - share + outgoing - incoming", () => {
    expect(
      calculateLedger({
        memberIds: ["a", "b", "c"],
        payments: [{ memberId: "a", amountMinor: 9000n }],
        shares: [
          { memberId: "a", amountMinor: 3000n },
          { memberId: "b", amountMinor: 3000n },
          { memberId: "c", amountMinor: 3000n },
        ],
        settlements: [
          { payerMemberId: "b", receiverMemberId: "a", amountMinor: 1000n },
        ],
      }),
    ).toEqual([
      { memberId: "a", netMinor: 5000n },
      { memberId: "b", netMinor: -2000n },
      { memberId: "c", netMinor: -3000n },
    ]);
  });

  it("rejects unbalanced facts", () => {
    expect(() =>
      calculateLedger({
        memberIds: ["a"],
        payments: [{ memberId: "a", amountMinor: 1n }],
        shares: [],
        settlements: [],
      }),
    ).toThrow("账务事实不守恒，无法生成总账");
  });
});
