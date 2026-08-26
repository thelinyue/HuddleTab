import { describe, expect, it } from "vitest";
import {
  convertMinorAmount,
  decimalRateToString,
  parseDecimalRate,
} from "@/domain/exchange-rate/decimal-rate";

describe("DecimalRate", () => {
  it("normalizes exact decimals and converts the total without float arithmetic", () => {
    const rate = parseDecimalRate("0.0480");

    expect(rate).toEqual({ coefficient: 48n, scale: 3 });
    expect(decimalRateToString(rate)).toBe("0.048");
    expect(convertMinorAmount(6000n, 0, 2, rate)).toBe(28800n);
  });

  it("rounds a half upward and rejects unsafe syntax", () => {
    expect(convertMinorAmount(1n, 0, 2, parseDecimalRate("0.015"))).toBe(2n);

    for (const input of ["0", "-1", "1e-3", "0.1234567890123"]) {
      expect(() => parseDecimalRate(input)).toThrow(
        "汇率必须是最多 12 位小数的正十进制数",
      );
    }
  });
});
