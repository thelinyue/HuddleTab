import { describe, expect, it } from "vitest";
import { amountExpressionToMinor } from "./money";

describe("金额表达式", () => {
  it.each([
    ["12.5+8*2", "2850"],
    ["12*(3+2)", "6000"],
    ["1+2×3", "700"],
    ["8÷2", "400"],
    ["10/3", "333"],
  ])("计算 %s", (expression, expected) => {
    expect(amountExpressionToMinor(expression, "CNY")).toBe(expected);
  });

  it("支持 unary 运算并按零位币种四舍五入", () => {
    expect(amountExpressionToMinor("-(-2)+1", "JPY")).toBe("3");
    expect(amountExpressionToMinor("10/3", "JPY")).toBe("3");
  });

  it.each(["1/0", "1+", "2(3+1)", "1+(2", "1+a", "-1"])('拒绝非法表达式 "%s"', (expression) => {
    expect(() => amountExpressionToMinor(expression, "CNY")).toThrow();
  });

  it("保留纯金额的旧格式校验", () => {
    expect(() => amountExpressionToMinor("01", "CNY")).toThrow("金额格式不正确。");
    expect(amountExpressionToMinor("12.50", "CNY")).toBe("1250");
  });
});
