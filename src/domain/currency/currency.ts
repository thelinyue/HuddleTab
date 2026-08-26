export type CurrencyCode = string & {
  readonly __currencyCode: unique symbol;
};

const ZERO_MINOR_UNITS = new Set([
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
const THREE_MINOR_UNITS = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);
const FOUR_MINOR_UNITS = new Set(["CLF", "UYW"]);

/** 将外部币种输入规范化为 ISO 4217 三字母代码，拒绝不可被运行时识别的币种。 */
export function asCurrencyCode(input: string): CurrencyCode {
  const code = input.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error("币种代码必须是三个大写字母");
  }

  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code }).format(
      0,
    );
  } catch {
    throw new Error(`不支持的币种：${code}`);
  }

  return code as CurrencyCode;
}

/**
 * 正式金额以最小单位整数保存。ISO 4217 的 0/3/4 位例外在此显式列出，
 * 避免设备 locale 或 UI 格式化策略改变账务精度。
 */
export function getCurrencyMinorUnits(input: string): number {
  const code = asCurrencyCode(input);

  if (ZERO_MINOR_UNITS.has(code)) return 0;
  if (THREE_MINOR_UNITS.has(code)) return 3;
  if (FOUR_MINOR_UNITS.has(code)) return 4;

  return 2;
}
