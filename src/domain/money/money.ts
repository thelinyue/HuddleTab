import {
  asCurrencyCode,
  getCurrencyMinorUnits,
  type CurrencyCode,
} from "@/domain/currency/currency";

export interface Money {
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
}

export interface MoneyApi {
  readonly currency: string;
  readonly amountMinor: string;
}

const INTEGER_MINOR_AMOUNT = /^-?(0|[1-9]\d*)$/;

/** API 层传递十进制字符串；在 Domain 边界立刻转为 bigint，杜绝金额浮点化。 */
export function moneyFromApi(input: MoneyApi): Money {
  if (!INTEGER_MINOR_AMOUNT.test(input.amountMinor)) {
    throw new Error("金额必须是最小货币单位整数");
  }

  return {
    currency: asCurrencyCode(input.currency),
    amountMinor: BigInt(input.amountMinor),
  };
}

/** 返回 JSON 可序列化的金额表示，不将可能超出安全范围的金额转为 number。 */
export function moneyToApi(input: Money): MoneyApi {
  return {
    currency: input.currency,
    amountMinor: input.amountMinor.toString(),
  };
}

/** 账务金额不允许隐式换汇，只有相同币种才能直接相加。 */
export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new Error("不能直接运算不同币种的金额");
  }

  return {
    currency: left.currency,
    amountMinor: left.amountMinor + right.amountMinor,
  };
}

/**
 * 只将 bigint 拆成主单位和小数余数后格式化，绝不先转换完整金额为 number。
 * 这样极大金额仍保留精确值，且不同币种精度始终来自 Currency Domain。
 */
export function formatMoney(input: Money, locale: string): string {
  const minorUnits = getCurrencyMinorUnits(input.currency);
  const divisor = 10n ** BigInt(minorUnits);
  const isNegative = input.amountMinor < 0n;
  const absolute = isNegative ? -input.amountMinor : input.amountMinor;
  const symbol =
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: input.currency,
      maximumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? input.currency;
  const major = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  }).format(absolute / divisor);
  const fraction =
    minorUnits === 0
      ? ""
      : `.${(absolute % divisor).toString().padStart(minorUnits, "0")}`;

  return `${isNegative ? "-" : ""}${symbol}${major}${fraction}`;
}
