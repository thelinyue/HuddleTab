/**
 * 精确汇率的十进制表示。
 *
 * coefficient / 10^scale 是汇率的唯一含义，两个字段都不能通过 Number 参与正式
 * 金额计算，以免大额账单在 JavaScript 浮点数中丢失精度。
 */
export interface DecimalRate {
  readonly coefficient: bigint;
  readonly scale: number;
}

const DECIMAL_RATE_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,12}))?$/;
const INVALID_DECIMAL_RATE_ERROR = "汇率必须是最多 12 位小数的正十进制数";

/**
 * 将用户输入的正十进制汇率规范化为精确的 coefficient/scale 形式。
 * 小数末尾零不保留，使相同经济含义的汇率拥有唯一领域表示。
 */
export function parseDecimalRate(input: string): DecimalRate {
  if (typeof input !== "string") {
    throw new Error(INVALID_DECIMAL_RATE_ERROR);
  }

  const normalizedInput = input.trim();
  const match = DECIMAL_RATE_PATTERN.exec(normalizedInput);

  if (!match) {
    throw new Error(INVALID_DECIMAL_RATE_ERROR);
  }

  const [integerPart, fractionPart = ""] = normalizedInput.split(".");
  const normalizedFraction = fractionPart.replace(/0+$/, "");
  const coefficient = BigInt(`${integerPart}${normalizedFraction}`);

  if (coefficient <= 0n) {
    throw new Error(INVALID_DECIMAL_RATE_ERROR);
  }

  return { coefficient, scale: normalizedFraction.length };
}

/** 将精确汇率恢复为规范十进制文本，全程不转换为 Number。 */
export function decimalRateToString(rate: DecimalRate): string {
  if (rate.scale === 0) {
    return rate.coefficient.toString();
  }

  const digits = rate.coefficient.toString().padStart(rate.scale + 1, "0");
  const integerLength = digits.length - rate.scale;

  return `${digits.slice(0, integerLength)}.${digits.slice(integerLength)}`;
}

/**
 * 换算一笔 Expense 的完整总额并按 round-half-up（半数向上）取整至目标最小单位。
 *
 * 此处刻意不接收付款行或成员份额行：必须先换算唯一 Expense 总额，再由 Task3 的
 * allocateByWeights 分配行。接口边界禁止“逐行换算后求和”，避免舍入累计导致分配
 * 总和偏离已换算的 Expense 总额。
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
  const denominator =
    10n ** BigInt(originalMinorUnits) * 10n ** BigInt(rate.scale);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}
