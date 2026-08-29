import Link from "next/link";

import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import type { ExpenseCategory } from "@/features/expenses/categories";
import type { ExpenseListItemDto } from "@/features/expenses/api";
import { ExpenseCategoryIllustration } from "@/features/expenses/components/expense-category-illustration";

/** 消费行保持两到三层扫描信息；转账不会进入此列表或消费总额。 */
export function ExpenseListItem({
  activityId,
  expense,
  timeZone,
  highlighted = false,
}: {
  readonly activityId: string;
  readonly expense: ExpenseListItemDto;
  readonly timeZone: string;
  readonly highlighted?: boolean;
}) {
  const category = expense.category as ExpenseCategory;
  const baseAmount = formatMoney(
    {
      currency: asCurrencyCode(expense.baseCurrency),
      amountMinor: BigInt(expense.baseAmountMinor),
    },
    "zh-CN",
  );
  const originalAmount = formatMoney(
    {
      currency: asCurrencyCode(expense.originalCurrency),
      amountMinor: BigInt(expense.originalAmountMinor),
    },
    "zh-CN",
  );
  const occurredTime = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(expense.occurredAt));
  return (
    <Link
      href={`/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expense.id)}`}
      className={`flex min-h-14 items-center gap-2.5 px-1 py-2 transition-colors hover:bg-muted/60 focus-visible:rounded-md ${highlighted ? "bg-primary/10" : ""}`}
    >
      <ExpenseCategoryIllustration category={category} className="size-8" />
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm font-medium">
          {expense.title}
        </strong>
        <span className="mt-0.5 block truncate text-[11px] leading-4 text-muted-foreground">
          {expense.payerSummary || "未提供付款信息"} 付款 ·{" "}
          {expense.participantCount ?? 0}人
        </span>
      </span>
      <span className="shrink-0 text-right">
        <strong className="money block text-sm font-semibold">
          {baseAmount}
        </strong>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
          {expense.originalCurrency !== expense.baseCurrency
            ? `${originalAmount} · `
            : ""}
          {occurredTime}
        </span>
      </span>
    </Link>
  );
}
