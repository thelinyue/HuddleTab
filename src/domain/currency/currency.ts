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
 * Intl.supportedValuesOf("currency") 可能遗漏冻结计划明确支持的 ISO 基金/单位代码。
 * UYI 与 CLF/UYW 分别来自上方的零位、四位精度规则，因此该例外集合必须与
 * minor-unit 列表保持一致，避免运行时 ICU 差异导致这些合法金额在校验阶段被拒绝。
 */
const SUPPORTED_CURRENCY_CODES = new Set([
  ...Intl.supportedValuesOf("currency"),
  "UYI",
  ...FOUR_MINOR_UNIT_CURRENCIES,
]);

/**
 * 将外部币种代码标准化并验证为运行时支持的 ISO 4217 币种。
 * Intl.NumberFormat 负责校验运行时的货币格式能力；成员校验使用包含
 * supportedValuesOf 与冻结精度例外的集合，排除形似三位字母但并未获支持的代码。
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
