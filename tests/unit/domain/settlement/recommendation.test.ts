import { describe, expect, it } from "vitest";

import { recommendSettlements } from "@/domain/settlement/recommendation";

describe("recommendSettlements", () => {
  it("优先匹配最大应付与最大应收", () => {
    expect(
      recommendSettlements([
        { memberId: "creditor", netMinor: 5000n },
        { memberId: "debtor-b", netMinor: -2000n },
        { memberId: "debtor-c", netMinor: -3000n },
      ]),
    ).toEqual([
      {
        payerMemberId: "debtor-c",
        receiverMemberId: "creditor",
        amountMinor: 3000n,
      },
      {
        payerMemberId: "debtor-b",
        receiverMemberId: "creditor",
        amountMinor: 2000n,
      },
    ]);
  });

  it("余额相同时按成员 ID 升序决定匹配顺序", () => {
    expect(
      recommendSettlements([
        { memberId: "creditor-b", netMinor: 100n },
        { memberId: "creditor-a", netMinor: 100n },
        { memberId: "debtor-b", netMinor: -100n },
        { memberId: "debtor-a", netMinor: -100n },
      ]),
    ).toEqual([
      {
        payerMemberId: "debtor-a",
        receiverMemberId: "creditor-a",
        amountMinor: 100n,
      },
      {
        payerMemberId: "debtor-b",
        receiverMemberId: "creditor-b",
        amountMinor: 100n,
      },
    ]);
  });

  it("拒绝余额合计不为零的总账", () => {
    expect(() =>
      recommendSettlements([{ memberId: "a", netMinor: 1n }]),
    ).toThrow("成员余额合计必须为零");
  });
});
