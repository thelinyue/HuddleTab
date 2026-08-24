import {
  asCurrencyCode,
  getCurrencyMinorUnits,
  type CurrencyCode,
} from "@/domain/currency/currency";

/**
 * 领域层中的正式金额。
 * amountMinor 始终以最小货币单位保存为 bigint，避免 JavaScript Number 在大额
 * 金额上丢失精度；currency 必须是已经验证过的 ISO 4217 币种代码。
 */
export interface Money {
  readonly currency: CurrencyCode;
  readonly amountMinor: bigint;
}

/**
 * API / 数据库边界使用的金额表示。
 * bigint 不能直接安全地通过 JSON 传输，因此最小货币单位在边界处保持十进制整数
 * 字符串，并由 moneyFromApi 与 moneyToApi 负责显式转换。
 */
export interface MoneyApi {
  readonly currency: string;
  readonly amountMinor: string;
}

const MINOR_AMOUNT_PATTERN = /^-?(0|[1-9]\d*)$/;

/** 将 API 的十进制整数金额转换为精确的领域金额。 */
export function moneyFromApi(money: MoneyApi): Money {
  if (
    typeof money.amountMinor !== "string" ||
    !MINOR_AMOUNT_PATTERN.test(money.amountMinor)
  ) {
    throw new Error("金额必须是最小货币单位整数");
  }

  return {
    currency: asCurrencyCode(money.currency),
    amountMinor: BigInt(money.amountMinor),
  };
}

/** 将领域金额转换为适合 API 与数据库适配器传输的十进制字符串。 */
export function moneyToApi(money: Money): MoneyApi {
  return {
    currency: money.currency,
    amountMinor: money.amountMinor.toString(),
  };
}

/**
 * 同币种金额相加。
 * 不在这里做汇率换算：不同币种的相加必须由上层先完成明确的换汇规则，防止隐式
 * 产生没有经济含义的金额。
 */
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
 * 在不把完整金额转为 Number 的前提下格式化展示。
 * 先用 bigint 拆出主单位与余数，再让 Intl 仅格式化主单位、分组和货币符号；最后
 * 用 bigint 得到的余数替换 Intl 补出的零，从而保留任意大整数的精确值。
 */
export function formatMoney(money: Money, locale: string): string {
  const minorUnits = getCurrencyMinorUnits(money.currency);
  const divisor = 10n ** BigInt(minorUnits);
  const isNegative = money.amountMinor < 0n;
  const absoluteAmount = isNegative ? -money.amountMinor : money.amountMinor;
  const majorAmount = absoluteAmount / divisor;
  const remainder = absoluteAmount % divisor;
  const formattedMajor =
    isNegative && majorAmount === 0n
      ? -1n
      : isNegative
        ? -majorAmount
        : majorAmount;
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    currencyDisplay: "symbol",
    minimumFractionDigits: minorUnits,
    maximumFractionDigits: minorUnits,
  });
  const fraction = remainder.toString().padStart(minorUnits, "0");

  return formatter
    .formatToParts(formattedMajor)
    .map((part) => {
      if (part.type === "fraction") return fraction;
      if (isNegative && majorAmount === 0n && part.type === "integer") {
        return "0";
      }
      return part.value;
    })
    .join("");
}
