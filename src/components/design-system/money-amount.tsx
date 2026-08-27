import { formatMoney } from "@/domain/money/money";
import { asCurrencyCode } from "@/domain/currency/currency";
import { cn } from "@/lib/utils";

type MoneyTone = "neutral" | "receivable" | "payable" | "settled" | "danger";
type MoneySize = "sm" | "md" | "lg";

const toneClassName: Record<MoneyTone, string> = {
  neutral: "text-foreground",
  receivable: "text-[var(--amount-receivable)]",
  payable: "text-[var(--amount-payable)]",
  settled: "text-primary",
  danger: "text-[var(--amount-danger)]",
};

const sizeClassName: Record<MoneySize, string> = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl font-semibold",
};

/** 所有账务金额都在最小单位 bigint 上格式化，界面不引入浮点数。 */
export function MoneyAmount({
  currency,
  amountMinor,
  tone = "neutral",
  size = "md",
  className,
}: {
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly tone?: MoneyTone;
  readonly size?: MoneySize;
  readonly className?: string;
}) {
  const amount = formatMoney(
    { currency: asCurrencyCode(currency), amountMinor },
    "zh-CN",
  );

  return (
    <span
      data-money-tone={tone}
      className={cn("money", toneClassName[tone], sizeClassName[size], className)}
    >
      {amount}
    </span>
  );
}
