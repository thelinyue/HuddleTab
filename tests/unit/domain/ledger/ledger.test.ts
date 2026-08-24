import { describe, expect, it } from "vitest";
import { calculateLedger } from "@/domain/ledger/ledger";

describe("calculateLedger", () => {
  it("按 payment - share + outgoing settlement - incoming settlement 计算余额", () => {
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

  it("拒绝不守恒的账务事实", () => {
    expect(() =>
      calculateLedger({
        memberIds: ["a"],
        payments: [{ memberId: "a", amountMinor: 1n }],
        shares: [],
        settlements: [],
      }),
    ).toThrow("账务事实不守恒，无法生成总账");
  });

  it("即使负付款与负分摊相互抵消也拒绝负付款", () => {
    expect(() =>
      calculateLedger({
        memberIds: ["a"],
        payments: [{ memberId: "a", amountMinor: -1n }],
        shares: [{ memberId: "a", amountMinor: -1n }],
        settlements: [],
      }),
    ).toThrow("付款金额不能为负数");
  });

  it("拒绝负分摊金额", () => {
    expect(() =>
      calculateLedger({
        memberIds: ["a"],
        payments: [],
        shares: [{ memberId: "a", amountMinor: -1n }],
        settlements: [],
      }),
    ).toThrow("分摊金额不能为负数");
  });

  it.each([
    { amountMinor: -1n, message: "结算金额必须大于零" },
    { amountMinor: 0n, message: "结算金额必须大于零" },
  ])("拒绝无效结算金额 $amountMinor", ({ amountMinor, message }) => {
    expect(() =>
      calculateLedger({
        memberIds: ["a", "b"],
        payments: [],
        shares: [],
        settlements: [
          {
            payerMemberId: "a",
            receiverMemberId: "b",
            amountMinor,
          },
        ],
      }),
    ).toThrow(message);
  });

  it("拒绝自结算", () => {
    expect(() =>
      calculateLedger({
        memberIds: ["a"],
        payments: [],
        shares: [],
        settlements: [
          { payerMemberId: "a", receiverMemberId: "a", amountMinor: 1n },
        ],
      }),
    ).toThrow("结算付款人与收款人不能相同");
  });

  it("拒绝重复总账成员", () => {
    expect(() =>
      calculateLedger({
        memberIds: ["a", "a"],
        payments: [],
        shares: [],
        settlements: [],
      }),
    ).toThrow("总账成员不能重复");
  });

  it("允许零付款与零分摊参与守恒账务", () => {
    expect(
      calculateLedger({
        memberIds: ["a", "b"],
        payments: [
          { memberId: "a", amountMinor: 1n },
          { memberId: "b", amountMinor: 0n },
        ],
        shares: [
          { memberId: "a", amountMinor: 1n },
          { memberId: "b", amountMinor: 0n },
        ],
        settlements: [],
      }),
    ).toEqual([
      { memberId: "a", netMinor: 0n },
      { memberId: "b", netMinor: 0n },
    ]);
  });

  it("保留未知成员的现有错误", () => {
    expect(() =>
      calculateLedger({
        memberIds: ["a"],
        payments: [{ memberId: "unknown", amountMinor: 0n }],
        shares: [],
        settlements: [],
      }),
    ).toThrow("账务事实引用了未知成员：unknown");
  });
});
