import { describe, expect, it } from "vitest";
import { recommendSettlements } from "@/domain/settlement/recommendation";

const balances = [
  { memberId: "creditor-major", netMinor: 8n },
  { memberId: "creditor-minor", netMinor: 3n },
  { memberId: "debtor-major", netMinor: -7n },
  { memberId: "debtor-minor", netMinor: -4n },
] as const;

describe("recommendSettlements", () => {
  it("每轮由最大债务人与最大债权人配对，并取双方剩余金额的较小值", () => {
    expect(recommendSettlements(balances)).toEqual([
      {
        payerMemberId: "debtor-major",
        receiverMemberId: "creditor-major",
        amountMinor: 7n,
      },
      {
        payerMemberId: "debtor-minor",
        receiverMemberId: "creditor-minor",
        amountMinor: 3n,
      },
      {
        payerMemberId: "debtor-minor",
        receiverMemberId: "creditor-major",
        amountMinor: 1n,
      },
    ]);
  });

  it("余额相同按 memberId 升序稳定配对，与输入顺序无关", () => {
    const shuffled = [
      { memberId: "debtor-b", netMinor: -500n },
      { memberId: "creditor-b", netMinor: 500n },
      { memberId: "debtor-a", netMinor: -500n },
      { memberId: "creditor-a", netMinor: 500n },
    ] as const;

    expect(recommendSettlements(shuffled)).toEqual([
      {
        payerMemberId: "debtor-a",
        receiverMemberId: "creditor-a",
        amountMinor: 500n,
      },
      {
        payerMemberId: "debtor-b",
        receiverMemberId: "creditor-b",
        amountMinor: 500n,
      },
    ]);
  });

  it("忽略零余额", () => {
    expect(
      recommendSettlements([
        { memberId: "creditor", netMinor: 12n },
        { memberId: "settled", netMinor: 0n },
        { memberId: "debtor", netMinor: -12n },
      ]),
    ).toEqual([
      {
        payerMemberId: "debtor",
        receiverMemberId: "creditor",
        amountMinor: 12n,
      },
    ]);
  });

  it("不修改传入的账本余额", () => {
    const input = [
      { memberId: "creditor", netMinor: 9n },
      { memberId: "debtor-a", netMinor: -4n },
      { memberId: "debtor-b", netMinor: -5n },
    ] as const;
    const snapshot = structuredClone(input);

    recommendSettlements(input);

    expect(input).toEqual(snapshot);
  });

  it("余额合计不为零时抛出明确错误", () => {
    expect(() =>
      recommendSettlements([
        { memberId: "creditor", netMinor: 1n },
        { memberId: "debtor", netMinor: -2n },
      ]),
    ).toThrow("成员余额合计必须为零");
  });
});
