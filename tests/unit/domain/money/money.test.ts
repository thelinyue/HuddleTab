import { describe, expect, it } from "vitest";
import { getCurrencyMinorUnits } from "@/domain/currency/currency";
import {
  addMoney,
  formatMoney,
  moneyFromApi,
  moneyToApi,
} from "@/domain/money/money";

describe("Money", () => {
  it("keeps ISO precision and values beyond Number.MAX_SAFE_INTEGER", () => {
    expect(getCurrencyMinorUnits("CNY")).toBe(2);
    expect(getCurrencyMinorUnits("JPY")).toBe(0);
    expect(getCurrencyMinorUnits("BHD")).toBe(3);

    const value = moneyFromApi({
      currency: "CNY",
      amountMinor: "90071992547409931234",
    });

    expect(moneyToApi(value).amountMinor).toBe("90071992547409931234");
  });

  it("rejects float syntax and cross-currency arithmetic", () => {
    expect(() => moneyFromApi({ currency: "CNY", amountMinor: "1.5" })).toThrow(
      "金额必须是最小货币单位整数",
    );
    expect(() =>
      addMoney(
        moneyFromApi({ currency: "CNY", amountMinor: "1" }),
        moneyFromApi({ currency: "JPY", amountMinor: "1" }),
      ),
    ).toThrow("不能直接运算不同币种的金额");
  });

  it("formats without converting the full amount through Number", () => {
    expect(
      formatMoney(
        moneyFromApi({ currency: "CNY", amountMinor: "28600" }),
        "zh-CN",
      ),
    ).toBe("¥286.00");
  });
});
