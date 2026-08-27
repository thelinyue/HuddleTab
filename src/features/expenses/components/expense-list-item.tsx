import Link from "next/link";

import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import {
  expenseCategoryLabels,
  type ExpenseCategory,
} from "@/features/expenses/categories";
import type { ExpenseListItemDto } from "@/features/expenses/api";

/** 消费行保持两到三层扫描信息；转账不会进入此列表或消费总额。 */
export function ExpenseListItem({
  activityId,
  expense,
  highlighted = false,
}: {
  readonly activityId: string;
  readonly expense: ExpenseListItemDto;
  readonly highlighted?: boolean;
}) {
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
  return (
    <Link
      href={`/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expense.id)}`}
      className={`block min-h-20 border-b py-3 transition-colors hover:bg-muted/60 focus-visible:rounded-md ${highlighted ? "bg-primary/10" : ""}`}
    >
      <div className="flex items-start justify-between gap-4">
        <strong className="min-w-0 [overflow-wrap:anywhere]">
          {expense.title}
        </strong>
        <strong className="money shrink-0">{baseAmount}</strong>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {expenseCategoryLabels[expense.category as ExpenseCategory]} ·{" "}
        {expense.payerSummary || "未提供付款信息"} ·{" "}
        {expense.participantCount ?? 0} 人参与
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {expense.originalCurrency !== expense.baseCurrency
          ? `${originalAmount} · `
          : ""}
        {new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
          new Date(expense.occurredAt),
        )}
      </p>
    </Link>
  );
}
