"use client";

import { ArrowLeftIcon, EllipsisIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { MoneyAmount } from "@/components/design-system/money-amount";
import {
  ListReveal,
  ListRevealItem,
} from "@/components/design-system/list-reveal";
import { Button } from "@/components/ui/button";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import { ActivityNavigation } from "@/features/activities/components/activity-navigation";
import { ActivityLifecycleNotice } from "@/features/activities/components/activity-lifecycle-notice";
import type {
  ExpenseFeedSummaryDto,
  ExpenseListItemDto,
  QuickExpenseContextDto,
} from "@/features/expenses/api";
import {
  expenseCategories,
  expenseCategoryLabels,
} from "@/features/expenses/categories";
import { ExpenseCategoryIllustration } from "@/features/expenses/components/expense-category-illustration";
import { ExpenseListItem } from "@/features/expenses/components/expense-list-item";
import { OfflineExpenseStatus } from "@/features/expenses/components/offline-status";
import { QuickExpenseTrigger } from "@/features/expenses/components/quick-expense-trigger";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { inclusiveCalendarDays } from "@/lib/calendar-date";
import type { PendingExpenseMutation } from "@/pwa/indexed-db/schema";

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

/** 将时间戳转换成 TZ 对应的公历日期键，供分组与相对日期判断共同使用。 */
function zonedCalendarDate(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function fullCalendarDateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

function expenseDateHeading(value: string, timeZone: string) {
  const today = zonedCalendarDate(new Date(), timeZone);
  const distance = inclusiveCalendarDays(value, today);
  if (distance === 1) return "今日";
  if (distance === 2) return "昨日";
  return fullCalendarDateLabel(value);
}

const activityStatusLabel = {
  ACTIVE: "进行中",
  ENDED: "已结束",
  ARCHIVED: "已归档",
} as const;

/**
 * 流水页保持参考稿的一屏扫描密度。筛选仍提交给服务端，只从主内容移入 Radix Overlay；
 * 时间戳的日期分组和时刻展示均显式使用服务端运行时 TZ，避免部署地区改变账单归属日。
 */
export function ExpenseFeed({
  activity,
  expenses,
  timeZone,
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
  readonly timeZone: string;
  readonly onFiltersChange?: (filters: ExpenseFeedFilters) => void;
  readonly entryContext?: QuickExpenseContextDto | null;
  readonly onExpenseSaved?: (expenseId: string) => void;
  readonly onExpenseQueued?: (mutationId: string) => void;
  readonly highlightedExpenseId?: string | null;
  readonly pendingMutations?: readonly PendingExpenseMutation[];
  readonly onDiscardPending?: (mutationId: string) => void;
  readonly onRemoveRejectedAttachments?: (mutationId: string) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const balanceDirectionClassName =
    balance < 0n
      ? "text-[var(--amount-payable)]"
      : balance > 0n
        ? "text-[var(--amount-receivable)]"
        : "text-primary";
  const status = entryContext?.activity.status;
  const dayCount = inclusiveCalendarDays(activity.startDate, activity.endDate);
  const meta = [
    dayCount === null ? null : `${dayCount}天`,
    `${memberCount}人`,
    status ? activityStatusLabel[status] : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const groupedExpenses = Object.entries(
    Object.groupBy(expenses, (expense) =>
      zonedCalendarDate(new Date(expense.occurredAt), timeZone),
    ),
  );

  return (
    <div className="-mx-4 min-h-[calc(100dvh-5rem)] bg-surface px-4 pt-0.5 min-[481px]:-mx-6 min-[481px]:px-6">
      <header className="flex min-h-14 items-start gap-1">
        <Button
          variant="ghost"
          size="icon"
          asChild
          aria-label="返回活动"
          className="-ml-4"
        >
          <Link href="/activities">
            <ArrowLeftIcon aria-hidden="true" className="size-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1 pt-1.5">
          <h1 className="truncate text-base font-semibold leading-5">
            {activity.name}
          </h1>
          <p className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground">
            {meta}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="筛选流水"
          onClick={() => setFiltersOpen(true)}
        >
          <EllipsisIcon aria-hidden="true" className="size-5" />
        </Button>
      </header>

      <div className="-mx-4 min-[481px]:-mx-6">
        <ActivityNavigation activityId={activity.id} />
      </div>

      {status ? (
        <ActivityLifecycleNotice status={status} className="mt-3" />
      ) : null}

      <dl
        aria-label="消费摘要"
        className="mt-3 grid grid-cols-3 rounded-lg border border-border/70 bg-surface"
      >
        <div className="min-w-0 border-r border-border/60 px-2.5 py-2.5">
          <dt className="text-[11px] leading-4 text-muted-foreground">
            总消费
          </dt>
          <dd className="mt-0.5">
            <MoneyAmount
              currency={activity.currency}
              amountMinor={BigInt(activity.totalExpenseMinor)}
              size="sm"
              className="font-semibold"
            />
          </dd>
        </div>
        <div className="min-w-0 border-r border-border/60 px-2.5 py-2.5">
          <dt className="text-[11px] leading-4 text-muted-foreground">人均</dt>
          <dd className="mt-0.5">
            <MoneyAmount
              currency={activity.currency}
              amountMinor={averageMinor}
              size="sm"
              className="font-semibold"
            />
          </dd>
        </div>
        <div className="min-w-0 px-2.5 py-2.5">
          <dt className="text-[11px] leading-4 text-muted-foreground">
            我的结算
          </dt>
          <dd className="mt-0.5 flex min-w-0 items-baseline gap-1">
            <span
              className={`shrink-0 text-[11px] font-medium ${balanceDirectionClassName}`}
            >
              {balanceDirection}
            </span>
            <MoneyAmount
              currency={activity.currency}
              amountMinor={balance < 0n ? -balance : balance}
              tone={balanceTone}
              size="sm"
              className="min-w-0 truncate font-semibold"
            />
          </dd>
        </div>
        {activity.originalCurrencyTotals.length > 0 ? (
          <div className="col-span-3 border-t border-border/60 px-2.5 py-1.5 text-[11px] leading-4 text-muted-foreground">
            <dt className="sr-only">原币种合计</dt>
            <dd className="truncate">
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
            </dd>
          </div>
        ) : null}
      </dl>

      {entryContext?.permissions.canCreateExpense && onExpenseSaved ? (
        <QuickExpenseTrigger
          context={entryContext}
          onSaved={onExpenseSaved}
          onQueued={onExpenseQueued}
        />
      ) : null}

      <section aria-label="消费流水" className="mt-4">
        {pendingMutations.map((mutation) => (
          <OfflineExpenseStatus
            key={mutation.id}
            mutation={mutation}
            onDiscard={onDiscardPending ?? (() => undefined)}
            onRemoveRejectedAttachments={onRemoveRejectedAttachments}
          />
        ))}

        {groupedExpenses.map(([date, rows]) => {
          const fullDateLabel = fullCalendarDateLabel(date);
          return (
            <section key={date} aria-labelledby={`expense-date-${date}`}>
              <h2
                id={`expense-date-${date}`}
                className="border-b border-border/60 py-2 text-xs font-semibold"
              >
                {expenseDateHeading(date, timeZone)}
              </h2>
              <ListReveal>
                <ul
                  aria-label={fullDateLabel}
                  className="divide-y divide-border/60"
                >
                  {rows?.map((expense) => (
                    <li key={expense.id}>
                      <ListRevealItem>
                        <ExpenseListItem
                          activityId={activity.id}
                          expense={expense}
                          timeZone={timeZone}
                          highlighted={highlightedExpenseId === expense.id}
                        />
                      </ListRevealItem>
                    </li>
                  ))}
                </ul>
              </ListReveal>
            </section>
          );
        })}

        {expenses.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            没有符合条件的消费
          </p>
        ) : null}
      </section>

      <ResponsiveFormOverlay
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="筛选流水"
      >
        <div className="space-y-4 pt-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">消费名称</span>
            <input
              aria-label="搜索消费名称"
              type="search"
              value={query}
              onChange={(event) => {
                const nextQuery = event.target.value;
                setQuery(nextQuery);
                updateFilters({ query: nextQuery, category, mine });
              }}
              className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
            />
          </label>
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium">分类</legend>
            <div className="grid grid-cols-4 gap-2">
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
                  className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border px-1 text-xs aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  <ExpenseCategoryIllustration
                    category={item}
                    className="size-7"
                  />
                  {expenseCategoryLabels[item]}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mine}
              onChange={(event) => {
                const nextMine = event.target.checked;
                setMine(nextMine);
                updateFilters({ query, category, mine: nextMine });
              }}
              className="size-4 accent-primary"
            />
            只看我参与的
          </label>
        </div>
      </ResponsiveFormOverlay>
    </div>
  );
}
