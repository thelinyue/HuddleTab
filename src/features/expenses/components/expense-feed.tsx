"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
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
import { OfflineExpenseStatus } from "@/features/expenses/components/offline-status";
import type { PendingExpenseMutation } from "@/pwa/indexed-db/schema";
import { AppHeader } from "@/components/design-system/app-header";
import {
  ListReveal,
  ListRevealItem,
} from "@/components/design-system/list-reveal";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { StatusBadge } from "@/components/design-system/status-badge";
import { Button } from "@/components/ui/button";

type FeedActivity = Pick<
  ExpenseFeedSummaryDto,
  | "currency"
  | "totalExpenseMinor"
  | "originalCurrencyTotals"
  | "startDate"
  | "endDate"
  | "memberCount"
  | "currentUserBalanceMinor"
> & { readonly id: string; readonly name: string };
export interface ExpenseFeedFilters {
  readonly query: string;
  readonly category: string | null;
  readonly mine: boolean;
}

function expenseDateLabel(occurredAt: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(
    new Date(occurredAt),
  );
}

/** 流水筛选只保留冻结的三种条件，显示的总额与原币种摘要来自服务端 summary。 */
export function ExpenseFeed({
  activity,
  expenses,
  onFiltersChange,
  entryContext,
  onExpenseSaved,
  onExpenseQueued,
  highlightedExpenseId,
  pendingMutations = [],
  onDiscardPending,
  onRemoveRejectedAttachments,
}: {
  readonly activity: FeedActivity;
  readonly expenses: readonly ExpenseListItemDto[];
  readonly onFiltersChange?: (filters: ExpenseFeedFilters) => void;
  readonly entryContext?: QuickExpenseContextDto | null;
  readonly onExpenseSaved?: (expenseId: string) => void;
  readonly onExpenseQueued?: (mutationId: string) => void;
  readonly highlightedExpenseId?: string | null;
  readonly pendingMutations?: readonly PendingExpenseMutation[];
  readonly onDiscardPending?: (mutationId: string) => void;
  readonly onRemoveRejectedAttachments?: (mutationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const updateFilters = (next: ExpenseFeedFilters) => onFiltersChange?.(next);
  const memberCount = activity.memberCount;
  const averageMinor =
    memberCount > 0
      ? BigInt(activity.totalExpenseMinor) / BigInt(memberCount)
      : 0n;
  const balance = BigInt(activity.currentUserBalanceMinor);
  const balanceTone =
    balance < 0n ? "payable" : balance > 0n ? "receivable" : "settled";
  const balanceDirection =
    balance < 0n ? "应付" : balance > 0n ? "应收" : "已结清";
  const status = entryContext?.activity.status;
  return (
    <>
      <AppHeader
        title={activity.name}
        subtitle={`${activity.startDate ?? "未设置开始日期"}${activity.endDate ? ` 至 ${activity.endDate}` : ""} · ${memberCount} 人`}
        leading={
          <Button variant="ghost" size="icon" asChild aria-label="返回活动">
            <Link href="/activities">
              <ArrowLeftIcon aria-hidden="true" />
            </Link>
          </Button>
        }
        actions={
          status ? (
            <StatusBadge
              tone={
                status === "ACTIVE"
                  ? "success"
                  : status === "ENDED"
                    ? "warning"
                    : "neutral"
              }
              icon={status === "ACTIVE" ? "success" : "info"}
            >
              {status === "ACTIVE"
                ? "进行中"
                : status === "ENDED"
                  ? "已结束"
                  : "已归档"}
            </StatusBadge>
          ) : undefined
        }
      />
      <section
        className="mt-4 grid grid-cols-3 gap-2 rounded-lg bg-surface-muted p-3"
        aria-label="消费摘要"
      >
        <div>
          <span className="block text-xs text-muted-foreground">总支出</span>
          <MoneyAmount
            currency={activity.currency}
            amountMinor={BigInt(activity.totalExpenseMinor)}
            size="lg"
          />
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">人均</span>
          <MoneyAmount
            currency={activity.currency}
            amountMinor={averageMinor}
            size="sm"
          />
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">
            我的余额{balanceDirection}
          </span>
          <MoneyAmount
            currency={activity.currency}
            amountMinor={balance < 0n ? -balance : balance}
            tone={balanceTone}
            size="sm"
          />
        </div>
        <div className="col-span-3 text-xs text-muted-foreground">
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
        </div>
      </section>
      <div className="mt-4 flex items-start justify-end">
        {entryContext?.permissions.canCreateExpense && onExpenseSaved && (
          <QuickExpenseTrigger
            context={entryContext}
            onSaved={onExpenseSaved}
            onQueued={onExpenseQueued}
          />
        )}
      </div>
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
        {pendingMutations.map((mutation) => (
          <OfflineExpenseStatus
            key={mutation.id}
            mutation={mutation}
            onDiscard={onDiscardPending ?? (() => undefined)}
            onRemoveRejectedAttachments={onRemoveRejectedAttachments}
          />
        ))}
        {Object.entries(
          Object.groupBy(expenses, (expense) =>
            expenseDateLabel(expense.occurredAt),
          ),
        ).map(([date, rows]) => (
          <section key={date} aria-labelledby={`expense-date-${date}`}>
            <h2
              id={`expense-date-${date}`}
              className="sticky top-0 z-10 border-b bg-background py-2 text-sm font-medium text-muted-foreground"
            >
              {date}
            </h2>
            <ListReveal>
              {rows?.map((expense) => (
                <ListRevealItem key={expense.id}>
                  <ExpenseListItem
                    activityId={activity.id}
                    expense={expense}
                    highlighted={highlightedExpenseId === expense.id}
                  />
                </ListRevealItem>
              ))}
            </ListReveal>
          </section>
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
