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
 * 当前 ICU 未列出的官方 ISO 4217 代码补集。
 * 本领域层的 ISO 4217 代码由 ICU 支持集合与该补集共同构成：
 * Intl.supportedValuesOf("currency") 并非 ISO 4217 权威全集，可能遗漏基金、
 * 贵金属、测试及单位代码；补集与冻结的官方清单保持一致，避免运行时 ICU 差异
 * 让合法币种在校验阶段被拒绝。
 */
const ICU_MISSING_OFFICIAL_ISO_4217_CODES = new Set([
  "BOV",
  "CHE",
  "CHW",
  "CLF",
  "COU",
  "MXV",
  "USN",
  "UYI",
  "UYW",
  "VED",
  "XAD",
  "XAG",
  "XAU",
  "XBA",
  "XBB",
  "XBC",
  "XBD",
  "XPD",
  "XPT",
  "XTS",
  "XUA",
  "XXX",
]);

const SUPPORTED_CURRENCY_CODES = new Set([
  ...Intl.supportedValuesOf("currency"),
  ...ICU_MISSING_OFFICIAL_ISO_4217_CODES,
]);

/**
 * 将外部币种代码标准化并验证为运行时支持的 ISO 4217 币种。
 * Intl.NumberFormat 负责校验运行时的货币格式能力；成员校验使用包含
 * ICU 支持集合与官方缺失补集，排除形似三位字母但并未获支持的代码。
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
