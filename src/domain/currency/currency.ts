/**
 * ISO 4217 币种代码。
 *
 * 使用品牌类型避免把未校验的普通字符串直接作为账务币种传递；所有公开入口
 * 都会先调用 asCurrencyCode，以确保运行时同样满足校验要求。
 */
export type CurrencyCode = string & { readonly __currencyCode: unique symbol };

const ZERO_MINOR_UNIT_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_MINOR_UNIT_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

const FOUR_MINOR_UNIT_CURRENCIES = new Set(["CLF", "UYW"]);

/**
 * 冻结的 ISO 4217 List One 官方币种代码（SIX 发布于 2026-01-01，共 178 个唯一代码）。
 *
 * 币种成员资格不能依赖 Intl.supportedValuesOf("currency")：其内容由运行时 ICU
 * 决定，既可能保留已废止代码，也可能缺少基金、贵金属、测试和单位代码。Intl 仅用于
 * 后续确认当前运行时具有格式化能力；是否为 ISO 4217 当前代码始终以此冻结清单为准。
 */
const SUPPORTED_CURRENCY_CODES = new Set([
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BOV",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHE",
  "CHF",
  "CHW",
  "CLF",
  "CLP",
  "CNY",
  "COP",
  "COU",
  "CRC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "IQD",
  "IRR",
  "ISK",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KPW",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MXV",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "SSP",
  "STN",
  "SVC",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "USN",
  "UYI",
  "UYU",
  "UYW",
  "UZS",
  "VED",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAD",
  "XAF",
  "XAG",
  "XAU",
  "XBA",
  "XBB",
  "XBC",
  "XBD",
  "XCD",
  "XCG",
  "XDR",
  "XOF",
  "XPD",
  "XPF",
  "XPT",
  "XSU",
  "XTS",
  "XUA",
  "XXX",
  "YER",
  "ZAR",
  "ZMW",
  "ZWG",
]);

/**
 * 将外部币种代码标准化并验证为当前 ISO 4217 币种。
 * 成员校验使用冻结的官方清单；Intl.NumberFormat 仅负责确认运行时的货币格式能力。
 */
export function asCurrencyCode(input: string): CurrencyCode {
  if (typeof input !== "string") {
    throw new Error("币种代码必须是三个大写字母");
  }

  const code = input.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error("币种代码必须是三个大写字母");
  }

  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
  } catch {
    throw new Error(`不支持的币种：${code}`);
  }

  if (!SUPPORTED_CURRENCY_CODES.has(code)) {
    throw new Error(`不支持的币种：${code}`);
  }

  return code as CurrencyCode;
}

/**
 * 返回账务金额拆分所需的小数位数。
 * ISO 4217 中与默认两位小数不同的币种在此显式列出，避免把金额精度隐含在
 * 调用方或 Intl 的实现细节中。
 */
export function getCurrencyMinorUnits(currency: string): number {
  const code = asCurrencyCode(currency);

  if (ZERO_MINOR_UNIT_CURRENCIES.has(code)) return 0;
  if (THREE_MINOR_UNIT_CURRENCIES.has(code)) return 3;
  if (FOUR_MINOR_UNIT_CURRENCIES.has(code)) return 4;

  return 2;
}
