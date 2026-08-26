"use client";

import { useState } from "react";

import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import {
  expenseCategories,
  expenseCategoryLabels,
} from "@/features/expenses/categories";
import type {
  ExpenseFeedSummaryDto,
  ExpenseListItemDto,
  QuickExpenseContextDto,
} from "@/features/expenses/api";
import { ExpenseListItem } from "@/features/expenses/components/expense-list-item";
import { QuickExpenseTrigger } from "@/features/expenses/components/quick-expense-trigger";

type FeedActivity = Pick<
  ExpenseFeedSummaryDto,
  "currency" | "totalExpenseMinor" | "originalCurrencyTotals"
> & { readonly id: string; readonly name: string };
export interface ExpenseFeedFilters {
  readonly query: string;
  readonly category: string | null;
  readonly mine: boolean;
}

/** 流水筛选只保留冻结的三种条件，显示的总额与原币种摘要来自服务端 summary。 */
export function ExpenseFeed({
  activity,
  expenses,
  onFiltersChange,
  entryContext,
  onExpenseSaved,
  highlightedExpenseId,
}: {
  readonly activity: FeedActivity;
  readonly expenses: readonly ExpenseListItemDto[];
  readonly onFiltersChange?: (filters: ExpenseFeedFilters) => void;
  readonly entryContext?: QuickExpenseContextDto | null;
  readonly onExpenseSaved?: (expenseId: string) => void;
  readonly highlightedExpenseId?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const updateFilters = (next: ExpenseFeedFilters) => onFiltersChange?.(next);
  const total = formatMoney(
    {
      currency: asCurrencyCode(activity.currency),
      amountMinor: BigInt(activity.totalExpenseMinor),
    },
    "zh-CN",
  );
  return (
    <>
      <header className="flex items-start justify-between gap-4 py-5">
        <div>
          <p className="text-sm text-muted-foreground">{activity.name}</p>
          <h1 className="money mt-1 text-2xl font-bold">总支出 {total}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activity.originalCurrencyTotals
              .map((item) =>
                formatMoney(
                  {
                    currency: asCurrencyCode(item.currency),
                    amountMinor: BigInt(item.amountMinor),
                  },
                  "zh-CN",
                ),
              )
              .join(" · ")}
          </p>
        </div>
        {entryContext?.permissions.canCreateExpense && onExpenseSaved && (
          <QuickExpenseTrigger
            context={entryContext}
            onSaved={onExpenseSaved}
          />
        )}
      </header>
      <div className="space-y-3 border-y py-4">
        <label className="block">
          <span className="sr-only">搜索消费名称</span>
          <input
            aria-label="搜索消费名称"
            type="search"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              updateFilters({ query: nextQuery, category, mine });
            }}
            className="min-h-11 w-full border bg-background px-3"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {expenseCategories.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={category === item}
              onClick={() => {
                const nextCategory = category === item ? null : item;
                setCategory(nextCategory);
                updateFilters({ query, category: nextCategory, mine });
              }}
              className="min-h-11 border px-3 text-sm aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {expenseCategoryLabels[item]}
            </button>
          ))}
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={mine}
            onChange={(event) => {
              const nextMine = event.target.checked;
              setMine(nextMine);
              updateFilters({ query, category, mine: nextMine });
            }}
          />
          只看我参与的
        </label>
      </div>
      <section aria-label="消费流水" className="mt-3">
        {expenses.map((expense) => (
          <ExpenseListItem
            key={expense.id}
            expense={expense}
            highlighted={highlightedExpenseId === expense.id}
          />
        ))}
        {expenses.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">
            没有符合条件的消费。
          </p>
        )}
      </section>
    </>
  );
}
