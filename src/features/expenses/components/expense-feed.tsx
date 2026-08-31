"use client";

import { ChevronRightIcon, FilterIcon, InfoIcon } from "lucide-react";
import { useState } from "react";
import Link from "next/link";

import { MoneyAmount } from "@/components/design-system/money-amount";
import {
  ListReveal,
  ListRevealItem,
} from "@/components/design-system/list-reveal";
import { Button } from "@/components/ui/button";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
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
> & {
  readonly id: string;
  readonly name: string;
  readonly expenseCount?: number;
  readonly participatingMemberCount?: number;
  readonly averageExpenseMinor?: string;
  readonly currentUserBalanceMinor?: string;
};

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
  if (distance === 1) {
    const [, month, day] = value.split("-").map(Number);
    return `今天 · ${month}月${day}日`;
  }
  if (distance === 2) {
    const [, month, day] = value.split("-").map(Number);
    return `昨天 · ${month}月${day}日`;
  }
  return fullCalendarDateLabel(value);
}

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
  const [appliedFilters, setAppliedFilters] = useState<ExpenseFeedFilters>({
    query: "",
    category: null,
    mine: false,
  });
  const applyFilters = () => {
    const next = { query, category, mine };
    setAppliedFilters(next);
    onFiltersChange?.(next);
    setFiltersOpen(false);
  };

  const status = entryContext?.activity.status;
  const expenseCount = activity.expenseCount ?? expenses.length;
  const participatingMemberCount = activity.participatingMemberCount ?? 0;
  const averageExpenseMinor =
    activity.averageExpenseMinor ??
    (participatingMemberCount > 0
      ? (BigInt(activity.totalExpenseMinor) +
          BigInt(participatingMemberCount) / 2n) /
        BigInt(participatingMemberCount)
      : 0n
    ).toString();
  const baseCurrency = asCurrencyCode(activity.currency);
  const foreignCurrencyTotals = activity.originalCurrencyTotals.filter(
    (item) => asCurrencyCode(item.currency) !== baseCurrency,
  );
  const foreignCurrencyText = foreignCurrencyTotals
    .map((item) =>
      formatMoney(
        {
          currency: asCurrencyCode(item.currency),
          amountMinor: BigInt(item.amountMinor),
        },
        "zh-CN",
        { currencyDisplay: "code" },
      ),
    )
    .join(" · ");
  const groupedExpenses = Object.entries(
    Object.groupBy(expenses, (expense) =>
      zonedCalendarDate(new Date(expense.occurredAt), timeZone),
    ),
  );
  const formalActiveMemberCount =
    (entryContext?.members ?? []).filter(
      (member) =>
        member.status === "ACTIVE" && (member.memberType ?? "USER") === "USER",
    ).length ?? 0;
  const canManageMembers = Boolean(
    entryContext?.permissions.canManageMembers && status === "ACTIVE",
  );
  const membersHref = `/activities/${encodeURIComponent(activity.id)}?panel=members`;

  return (
    <div className="min-w-0 pb-20">
      {canManageMembers && formalActiveMemberCount === 1 ? (
        <Link
          href={membersHref}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("huddletab:panel-open", {
                detail: { panel: "members", initialView: "invite" },
              }),
            );
          }}
          className="mt-4 flex min-h-14 items-center gap-3 rounded-sm border border-primary/10 bg-summary px-3 py-2.5 transition-colors hover:bg-summary/80"
        >
          <span className="min-w-0 flex-1">
            <strong className="block text-sm font-semibold text-foreground">
              邀请成员一起记账
            </strong>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              分享链接或二维码即可加入
            </span>
          </span>
          <ChevronRightIcon
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
        </Link>
      ) : null}

      <section
        aria-label="消费摘要"
        className="mt-4 rounded-sm bg-summary px-4 py-4"
      >
        <p className="text-xs font-medium text-muted-foreground">总消费</p>
        <MoneyAmount
          currency={activity.currency}
          amountMinor={BigInt(activity.totalExpenseMinor)}
          size="lg"
          className="type-display-amount mt-0.5"
        />
        {foreignCurrencyTotals.length > 0 ? (
          <div className="mt-2">
            <p className="text-xs font-medium text-muted-foreground">
              其中外币消费
            </p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              <span>{foreignCurrencyText}</span>
              <span className="text-xs"> · 已折算</span>
            </p>
          </div>
        ) : null}
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <span>
            {expenseCount} 笔消费 · 人均消费{" "}
            <MoneyAmount
              currency={activity.currency}
              amountMinor={BigInt(averageExpenseMinor)}
              size="sm"
              className="font-medium text-foreground"
            />
          </span>
          <span title="人均消费仅为统计平均值，不代表任何成员实际应承担金额">
            <InfoIcon aria-label="人均消费说明" className="size-3.5" />
          </span>
        </p>
      </section>

      {entryContext?.permissions.canCreateExpense && onExpenseSaved ? (
        <QuickExpenseTrigger
          context={entryContext}
          timeZone={timeZone}
          onSaved={onExpenseSaved}
          onQueued={onExpenseQueued}
        />
      ) : null}

      <div className="mt-6 flex min-h-11 items-center justify-between gap-3">
        <h2 className="text-base font-semibold">全部流水</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="筛选流水"
          onClick={() => setFiltersOpen(true)}
          className={
            appliedFilters.query ||
            appliedFilters.category ||
            appliedFilters.mine
              ? "text-primary"
              : "text-muted-foreground"
          }
        >
          <FilterIcon aria-hidden="true" className="size-4" />
          筛选
          {appliedFilters.query ||
          appliedFilters.category ||
          appliedFilters.mine ? (
            <span>
              ·{" "}
              {
                [
                  appliedFilters.query,
                  appliedFilters.category,
                  appliedFilters.mine ? "mine" : "",
                ].filter(Boolean).length
              }
            </span>
          ) : null}
        </Button>
      </div>

      <section aria-label="消费流水" className="mt-1">
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
            <section
              key={date}
              className="mt-4"
              aria-labelledby={`expense-date-${date}`}
            >
              <h3
                id={`expense-date-${date}`}
                className="text-xs font-semibold text-muted-foreground"
              >
                {expenseDateHeading(date, timeZone)}
              </h3>
              <ListReveal>
                <ul
                  aria-label={fullDateLabel}
                  className="mt-2 divide-y divide-border/60 overflow-hidden rounded-sm border bg-surface"
                >
                  {rows?.map((expense) => (
                    <li key={expense.id} className="px-3 py-3">
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
              }}
              className="size-4 accent-primary"
            />
            只看我参与的
          </label>
          <Button type="button" className="w-full" onClick={applyFilters}>
            应用筛选
          </Button>
        </div>
      </ResponsiveFormOverlay>
    </div>
  );
}
