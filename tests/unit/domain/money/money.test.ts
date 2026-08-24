import { describe, expect, it } from "vitest";

import {
  addMoney,
  formatMoney,
  moneyFromApi,
  moneyToApi,
} from "@/domain/money/money";
import {
  asCurrencyCode,
  getCurrencyMinorUnits,
} from "@/domain/currency/currency";

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

  it("supports frozen precision codes omitted by Intl currency values", () => {
    expect(asCurrencyCode("UYI")).toBe("UYI");
    expect(getCurrencyMinorUnits("UYI")).toBe(0);
    expect(asCurrencyCode("CLF")).toBe("CLF");
    expect(getCurrencyMinorUnits("CLF")).toBe(4);
    expect(asCurrencyCode("UYW")).toBe("UYW");
    expect(getCurrencyMinorUnits("UYW")).toBe(4);
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

  it("normalizes and validates currency codes through Intl", () => {
    expect(asCurrencyCode(" cny ")).toBe("CNY");
    expect(() => asCurrencyCode("cn")).toThrow("币种代码必须是三个大写字母");
    expect(() => asCurrencyCode("ZZZ")).toThrow("不支持的币种：ZZZ");
  });

  it("rejects non-integer decimal API strings", () => {
    for (const amountMinor of ["01", "1e3", "+1", " 1", "1 "]) {
      expect(() => moneyFromApi({ currency: "CNY", amountMinor })).toThrow(
        "金额必须是最小货币单位整数",
      );
    }
  });

  it("formats negative values and zero-minor-unit currencies", () => {
    expect(
      formatMoney(
        moneyFromApi({ currency: "CNY", amountMinor: "-105" }),
        "zh-CN",
      ),
    ).toBe("-¥1.05");
    expect(
      formatMoney(
        moneyFromApi({ currency: "JPY", amountMinor: "1234" }),
        "ja-JP",
      ),
    ).toBe("￥1,234");
  });
});
