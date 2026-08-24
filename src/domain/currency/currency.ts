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
 * 将外部币种代码标准化并验证为运行时支持的 ISO 4217 币种。
 * Intl.NumberFormat 负责校验运行时的货币格式能力，supportedValuesOf 则排除
 * 虽然形似三位字母、但不在当前运行时支持币种集合内的代码。
 */
export function asCurrencyCode(input: string): CurrencyCode {
  const code = input.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error("币种代码必须是三个大写字母");
  }

  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
  } catch {
    throw new Error(`不支持的币种：${code}`);
  }

  if (!Intl.supportedValuesOf("currency").includes(code)) {
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
