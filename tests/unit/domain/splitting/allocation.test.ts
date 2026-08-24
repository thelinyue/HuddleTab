import { describe, expect, it } from "vitest";
import {
  allocateByWeights,
  compareMemberIds,
} from "@/domain/splitting/allocation";

describe("allocateByWeights", () => {
  it("按 ActivityMember ID 升序分配剩余最小单位", () => {
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

  it("拒绝重复成员", () => {
    expect(() =>
      allocateByWeights(10n, [
        { memberId: "a", weight: 1n },
        { memberId: "a", weight: 1n },
      ]),
    ).toThrow("分配成员不能重复");
  });

  it("拒绝零权重", () => {
    expect(() =>
      allocateByWeights(10n, [{ memberId: "a", weight: 0n }]),
    ).toThrow("分配权重必须大于零");
  });

  it("拒绝负分配总额和空成员", () => {
    expect(() =>
      allocateByWeights(-1n, [{ memberId: "a", weight: 1n }]),
    ).toThrow("分配总额不能为负数");
    expect(() => allocateByWeights(0n, [])).toThrow("至少需要一个分配成员");
  });

  it("不改变调用方输入，并保持总额守恒与输入顺序无关", () => {
    const inputs = [
      { memberId: "c", weight: 1n },
      { memberId: "a", weight: 2n },
      { memberId: "b", weight: 3n },
    ];
    const originalInputs = [...inputs];

    const result = allocateByWeights(10n, inputs);
    const reversedResult = allocateByWeights(10n, [...inputs].reverse());

    expect(inputs).toEqual(originalInputs);
    expect(result).toEqual([
      { memberId: "a", amountMinor: 4n },
      { memberId: "b", amountMinor: 5n },
      { memberId: "c", amountMinor: 1n },
    ]);
    expect(result.reduce((sum, row) => sum + row.amountMinor, 0n)).toBe(10n);
    expect(reversedResult).toEqual(result);
  });

  it("按 Unicode 代码点而非运行环境 locale 排序成员 ID", () => {
    expect(
      allocateByWeights(1n, [
        { memberId: "\u{10000}", weight: 1n },
        { memberId: "\uE000", weight: 1n },
      ]),
    ).toEqual([
      { memberId: "\uE000", amountMinor: 1n },
      { memberId: "\u{10000}", amountMinor: 0n },
    ]);
  });

  it("导出跨分摊模式共用的 Unicode 代码点比较器", () => {
    expect(compareMemberIds("\uE000", "\u{10000}")).toBeLessThan(0);
  });
});
