import { MoneyAmount } from "@/components/design-system/money-amount";
import { cn } from "@/lib/utils";

/** 成员余额只表达相对活动的净结算方向，不在成员页推导总应收或总应付。 */
export function MemberBalance({
  netMinor,
  currency,
  className,
}: {
  readonly netMinor: bigint;
  readonly currency: string;
  readonly className?: string;
}) {
  if (netMinor === 0n) {
    return (
      <span
        className={cn(
          "whitespace-nowrap text-sm font-medium text-muted-foreground",
          className,
        )}
      >
        已结清
      </span>
    );
  }

  const receivable = netMinor > 0n;
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 whitespace-nowrap text-sm font-medium",
        receivable
          ? "text-[var(--amount-receivable)]"
          : "text-[var(--amount-payable)]",
        className,
      )}
    >
      <span>{receivable ? "应收" : "应付"}</span>{" "}
      <MoneyAmount
        currency={currency}
        amountMinor={receivable ? netMinor : -netMinor}
        tone={receivable ? "receivable" : "payable"}
        size="sm"
        className="tabular-nums font-semibold"
      />
    </span>
  );
}
