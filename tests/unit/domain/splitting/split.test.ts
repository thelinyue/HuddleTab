import { describe, expect, it } from "vitest";
import { splitExpense } from "@/domain/splitting/split";

describe("splitExpense", () => {
  it("EQUAL 按成员 ID 升序均分并将余数分配给首位成员", () => {
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
  });

  it("EXACT 保留指定金额并按成员 ID 升序返回", () => {
    expect(
      splitExpense({
        mode: "EXACT",
        totalMinor: 100n,
        shares: [
          { memberId: "b", amountMinor: 40n },
          { memberId: "a", amountMinor: 60n },
        ],
      }),
    ).toEqual([
      { memberId: "a", amountMinor: 60n },
      { memberId: "b", amountMinor: 40n },
    ]);
  });

  it("PERCENTAGE 使用基点权重并将余数分配给首位成员", () => {
    expect(
      splitExpense({
        mode: "PERCENTAGE",
        totalMinor: 101n,
        shares: [
          { memberId: "b", basisPoints: 5000n },
          { memberId: "a", basisPoints: 5000n },
        ],
      }),
    ).toEqual([
      { memberId: "a", amountMinor: 51n },
      { memberId: "b", amountMinor: 50n },
    ]);
  });

  it("WEIGHT 按百分之一权重分摊", () => {
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

  it("拒绝指定金额合计与消费总额不一致", () => {
    expect(() =>
      splitExpense({
        mode: "EXACT",
        totalMinor: 100n,
        shares: [{ memberId: "a", amountMinor: 99n }],
      }),
    ).toThrow("指定金额合计必须等于消费总额");
  });

  it("拒绝比例合计不是 100.00%", () => {
    expect(() =>
      splitExpense({
        mode: "PERCENTAGE",
        totalMinor: 100n,
        shares: [{ memberId: "a", basisPoints: 9999n }],
      }),
    ).toThrow("比例合计必须等于 100.00%");
  });

  it("拒绝非正消费总额", () => {
    expect(() =>
      splitExpense({ mode: "EQUAL", totalMinor: 0n, memberIds: ["a"] }),
    ).toThrow("消费总额必须大于零");
  });

  it("拒绝空成员和重复成员", () => {
    expect(() =>
      splitExpense({ mode: "EQUAL", totalMinor: 1n, memberIds: [] }),
    ).toThrow("至少需要一个分摊成员");
    expect(() =>
      splitExpense({
        mode: "EXACT",
        totalMinor: 2n,
        shares: [
          { memberId: "a", amountMinor: 1n },
          { memberId: "a", amountMinor: 1n },
        ],
      }),
    ).toThrow("分摊成员不能重复");
  });

  it("拒绝负指定金额", () => {
    expect(() =>
      splitExpense({
        mode: "EXACT",
        totalMinor: 1n,
        shares: [{ memberId: "a", amountMinor: -1n }],
      }),
    ).toThrow("指定金额不能为负数");
  });

  it("不改变 EXACT 调用方输入", () => {
    const input = {
      mode: "EXACT" as const,
      totalMinor: 100n,
      shares: [
        { memberId: "b", amountMinor: 40n },
        { memberId: "a", amountMinor: 60n },
      ],
    };
    const originalShares = [...input.shares];

    splitExpense(input);

    expect(input.shares).toEqual(originalShares);
  });

  it("EXACT 与权重分摊使用相同的 Unicode 代码点排序", () => {
    expect(
      splitExpense({
        mode: "EXACT",
        totalMinor: 1n,
        shares: [
          { memberId: "\u{10000}", amountMinor: 0n },
          { memberId: "\uE000", amountMinor: 1n },
        ],
      }),
    ).toEqual([
      { memberId: "\uE000", amountMinor: 1n },
      { memberId: "\u{10000}", amountMinor: 0n },
    ]);
  });

  it.each([
    {
      mode: "PERCENTAGE" as const,
      totalMinor: 100n,
      shares: [
        { memberId: "a", basisPoints: 0n },
        { memberId: "b", basisPoints: 10000n },
      ],
    },
    {
      mode: "WEIGHT" as const,
      totalMinor: 100n,
      shares: [{ memberId: "a", weightHundredths: 0n }],
    },
  ])("将非正比例或权重交给 allocator 校验", (input) => {
    expect(() => splitExpense(input)).toThrow("分配权重必须大于零");
  });
});
