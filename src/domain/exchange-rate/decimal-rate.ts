export interface DecimalRate {
  readonly coefficient: bigint;
  readonly scale: number;
}

const DECIMAL_RATE = /^(?:0|[1-9]\d*)(?:\.(\d{1,12}))?$/;

/** 将用户输入的十进制汇率转为精确系数与标度，正式账务不经过 JavaScript number。 */
export function parseDecimalRate(input: string): DecimalRate {
  const value = input.trim();
  const match = DECIMAL_RATE.exec(value);

  if (!match) {
    throw new Error("汇率必须是最多 12 位小数的正十进制数");
  }

  const fraction = (match[1] ?? "").replace(/0+$/, "");
  const coefficient = BigInt(`${value.split(".")[0]}${fraction}`);

  if (coefficient <= 0n) {
    throw new Error("汇率必须是最多 12 位小数的正十进制数");
  }

  return { coefficient, scale: fraction.length };
}

/** 将精确汇率转换为无多余尾零的字符串，供 API 与界面显示使用。 */
export function decimalRateToString(rate: DecimalRate): string {
  if (rate.scale === 0) return rate.coefficient.toString();

  const digits = rate.coefficient.toString().padStart(rate.scale + 1, "0");

  return `${digits.slice(0, -rate.scale)}.${digits.slice(-rate.scale)}`;
}

/**
 * 外币消费只在总额上换算一次，避免逐行换算的尾差累积。
 * 商规定价半分统一向上取整，之后的 Payment/Share 分配交由稳定分摊算法处理。
 */
export function convertMinorAmount(
  originalMinor: bigint,
  originalMinorUnits: number,
  baseMinorUnits: number,
  rate: DecimalRate,
): bigint {
  if (originalMinor < 0n) {
    throw new Error("待换算金额不能为负数");
  }

  const numerator =
    originalMinor * rate.coefficient * 10n ** BigInt(baseMinorUnits);
  const denominator = 10n ** BigInt(originalMinorUnits + rate.scale);
  const quotient = numerator / denominator;

  return (numerator % denominator) * 2n >= denominator
    ? quotient + 1n
    : quotient;
}
