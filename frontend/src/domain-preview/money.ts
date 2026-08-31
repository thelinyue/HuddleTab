const ZERO_MINOR_UNITS = new Set([
  "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX",
  "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const THREE_MINOR_UNITS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);
const FOUR_MINOR_UNITS = new Set(["CLF", "UYW"]);

export function normalizeCurrency(input: string): string {
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("币种代码必须是三个字母。");
  return code;
}

export function currencyMinorUnits(input: string): number {
  const code = normalizeCurrency(input);
  if (ZERO_MINOR_UNITS.has(code)) return 0;
  if (THREE_MINOR_UNITS.has(code)) return 3;
  if (FOUR_MINOR_UNITS.has(code)) return 4;
  return 2;
}

/** 沿用旧 UI 的精确文本解析，不让主单位金额经过 JavaScript number。 */
export function amountToMinor(value: string, currency: string): string {
  const precision = currencyMinorUnits(currency);
  const match = value.trim().match(/^(0|[1-9]\d*)(?:\.(\d+))?$/);
  if (!match) throw new Error("金额格式不正确。");
  if ((match[2]?.length ?? 0) > precision) throw new Error("金额小数位超过币种精度。");
  const fraction = (match[2] ?? "").padEnd(precision, "0");
  const minor = BigInt(match[1]) * 10n ** BigInt(precision) + BigInt(fraction || "0");
  if (minor <= 0n) throw new Error("金额必须大于 0。");
  return minor.toString();
}

export function minorToInput(value: string, currency: string): string {
  const precision = currencyMinorUnits(currency);
  const amount = BigInt(value);
  const divisor = 10n ** BigInt(precision);
  if (precision === 0) return amount.toString();
  const absolute = amount < 0n ? -amount : amount;
  const formatted = `${absolute / divisor}.${(absolute % divisor).toString().padStart(precision, "0")}`;
  return amount < 0n ? `-${formatted}` : formatted;
}

export function decimalToHundredths(value: string, label: string): string {
  const match = value.trim().match(/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`${label}格式不正确。`);
  return (BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))).toString();
}

export function formatMoney(currency: string, amountMinor: string | bigint): string {
  const code = normalizeCurrency(currency);
  const minorUnits = currencyMinorUnits(code);
  const amount = typeof amountMinor === "bigint" ? amountMinor : BigInt(amountMinor);
  const divisor = 10n ** BigInt(minorUnits);
  const absolute = amount < 0n ? -amount : amount;
  const major = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(absolute / divisor);
  const fraction = minorUnits === 0 ? "" : `.${(absolute % divisor).toString().padStart(minorUnits, "0")}`;
  const symbol = new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).formatToParts(0).find((part) => part.type === "currency")?.value ?? code;
  return `${amount < 0n ? "-" : ""}${symbol}${major}${fraction}`;
}
