import { describe, expect, it } from "vitest";

import {
  convertMinorAmount,
  decimalRateToString,
  parseDecimalRate,
  type DecimalRate,
} from "@/domain/exchange-rate/decimal-rate";

describe("DecimalRate", () => {
  it("规范化十进制汇率并精确换算唯一 Expense 总额", () => {
    const rate = parseDecimalRate("0.0480");

    expect(rate).toEqual({ coefficient: 48n, scale: 3 });
    expect(decimalRateToString(rate)).toBe("0.048");
    expect(convertMinorAmount(6000n, 0, 2, rate)).toBe(28800n);
  });

  it("在半数时向上舍入", () => {
    expect(convertMinorAmount(1n, 0, 2, parseDecimalRate("0.015"))).toBe(2n);
  });

  it("拒绝非正、科学计数法和超过十二位小数的汇率", () => {
    for (const input of ["0", "-1", "1e-3", "0.1234567890123"]) {
      expect(() => parseDecimalRate(input)).toThrow(
        "汇率必须是最多 12 位小数的正十进制数",
      );
    }
  });

  it("忽略输入首尾空白和小数末尾零", () => {
    const rate = parseDecimalRate(" 12.3400 ");

    expect(rate).toEqual({ coefficient: 1234n, scale: 2 });
    expect(decimalRateToString(rate)).toBe("12.34");
  });

  it("精确表示没有小数部分的汇率", () => {
    expect(decimalRateToString(parseDecimalRate("12"))).toBe("12");
  });

  it("拒绝绕过解析器构造的无效汇率结构", () => {
    const invalidRates: DecimalRate[] = [
      { coefficient: 0n, scale: 0 },
      { coefficient: 1n, scale: 13 },
    ];

    for (const rate of invalidRates) {
      expect(() => decimalRateToString(rate)).toThrow(
        "汇率必须是最多 12 位小数的正十进制数",
      );
      expect(() => convertMinorAmount(1n, 0, 2, rate)).toThrow(
        "汇率必须是最多 12 位小数的正十进制数",
      );
    }
  });

  it("拒绝负的待换算 Expense 总额", () => {
    expect(() => convertMinorAmount(-1n, 0, 2, parseDecimalRate("1"))).toThrow(
      "待换算金额不能为负数",
    );
  });
});
