"use client";

import Link from "next/link";
import {
  ArrowLeftIcon,
  BedDoubleIcon,
  BusFrontIcon,
  CircleHelpIcon,
  FerrisWheelIcon,
  ReceiptTextIcon,
  ShoppingBagIcon,
  TicketIcon,
  UtensilsIcon,
  type LucideIcon,
} from "lucide-react";

import { MemberAvatar } from "@/components/design-system/member-avatar";
import { MoneyAmount } from "@/components/design-system/money-amount";
import { Button } from "@/components/ui/button";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import type { ExpenseDetailResponse } from "@/features/expenses/api";
import type { AvatarPreset } from "@/features/me/avatar-presets";
import {
  expenseCategoryLabels,
  type ExpenseCategory,
} from "@/features/expenses/categories";

const splitModeLabels: Record<string, string> = {
  EQUAL: "均摊",
  EXACT: "按金额",
  PERCENTAGE: "按比例",
  WEIGHT: "按份数",
};

const categoryIcons: Record<ExpenseCategory, LucideIcon> = {
  FOOD: UtensilsIcon,
  TRANSPORT: BusFrontIcon,
  LODGING: BedDoubleIcon,
  TICKET: TicketIcon,
  SHOPPING: ShoppingBagIcon,
  ENTERTAINMENT: FerrisWheelIcon,
  OTHER: ReceiptTextIcon,
};

type SplitRow = {
  readonly memberId: string;
  readonly displayName: string;
  readonly avatarPreset: AvatarPreset | null;
  readonly splitInputMinor: bigint | null;
  readonly shareMinor: bigint;
  readonly paidMinor: bigint;
};

/**
 * 付款人与承担成员并不必然相同，因此明细表使用两组事实的并集。
 * 同一成员的多笔付款在展示层求和，但不会改写服务端返回的账务记录。
 */
function buildRows(data: ExpenseDetailResponse): SplitRow[] {
  const rows = new Map<string, SplitRow>();
  for (const share of data.shares) {
    rows.set(share.memberId, {
      memberId: share.memberId,
      displayName: share.memberDisplayName,
      avatarPreset: share.avatarPreset ?? null,
      splitInputMinor:
        share.splitInputMinor === null ? null : BigInt(share.splitInputMinor),
      shareMinor: BigInt(share.baseAmountMinor),
      paidMinor: 0n,
    });
  }
  for (const payment of data.payments) {
    const current = rows.get(payment.memberId);
    rows.set(payment.memberId, {
      memberId: payment.memberId,
      displayName: current?.displayName ?? payment.memberDisplayName,
      avatarPreset: current?.avatarPreset ?? payment.avatarPreset ?? null,
      splitInputMinor: current?.splitInputMinor ?? null,
      shareMinor: current?.shareMinor ?? 0n,
      paidMinor: (current?.paidMinor ?? 0n) + BigInt(payment.baseAmountMinor),
    });
  }
  return [...rows.values()];
}

function formatHundredths(value: bigint) {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function SignedNetAmount({
  currency,
  amountMinor,
}: {
  readonly currency: string;
  readonly amountMinor: bigint;
}) {
  const absolute = amountMinor < 0n ? -amountMinor : amountMinor;
  const sign = amountMinor > 0n ? "+" : amountMinor < 0n ? "−" : "";
  const label =
    amountMinor > 0n ? "应收" : amountMinor < 0n ? "应付" : "已结清";
  return (
    <span
      aria-label={`${label} ${formatMoney(
        { currency: asCurrencyCode(currency), amountMinor: absolute },
        "zh-CN",
      )}`}
      data-money-tone={
        amountMinor > 0n
          ? "receivable"
          : amountMinor < 0n
            ? "payable"
            : "settled"
      }
      className={`money whitespace-nowrap font-semibold ${
        amountMinor > 0n
          ? "text-receivable"
          : amountMinor < 0n
            ? "text-payable"
            : "text-primary"
      }`}
    >
      {sign}
      {formatMoney(
        { currency: asCurrencyCode(currency), amountMinor: absolute },
        "zh-CN",
      )}
    </span>
  );
}

function SplitValue({
  mode,
  value,
}: {
  readonly mode: string;
  readonly value: bigint | null;
}) {
  if (value === null || (mode !== "PERCENTAGE" && mode !== "WEIGHT"))
    return null;
  return (
    <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {formatHundredths(value)}
      {mode === "PERCENTAGE" ? "%" : "份"}
    </span>
  );
}

/** 分摊明细只读取已经落库的付款与承担事实，不参与账务写入。 */
export function ExpenseSplitDetail({
  data,
  activityName,
}: {
  readonly data: ExpenseDetailResponse;
  readonly activityName: string;
}) {
  const { expense } = data;
  const rows = buildRows(data);
  const category = expense.category as ExpenseCategory;
  const CategoryIcon = categoryIcons[category] ?? categoryIcons.OTHER;
  const currency = expense.baseCurrency;
  const shareTotal = rows.reduce((sum, row) => sum + row.shareMinor, 0n);
  const paymentTotal = rows.reduce((sum, row) => sum + row.paidMinor, 0n);
  const netTotal = paymentTotal - shareTotal;
  const averageMinor =
    data.shares.length > 0
      ? BigInt(expense.baseAmountMinor) / BigInt(data.shares.length)
      : 0n;

  return (
    <article className="-mx-4 min-h-[calc(100dvh-5rem)] bg-surface px-4 pb-6 min-[481px]:-mx-6 min-[481px]:px-6">
      <header className="grid min-h-14 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center">
        <Button
          variant="ghost"
          size="icon"
          asChild
          aria-label="返回账单详情"
          className="-ml-3"
        >
          <Link
            href={`/activities/${encodeURIComponent(expense.activityId)}/expenses/${encodeURIComponent(expense.id)}`}
          >
            <ArrowLeftIcon aria-hidden="true" className="size-5" />
          </Link>
        </Button>
        <h1 className="type-page-title text-center font-semibold">分摊明细</h1>
        <span aria-hidden="true" />
      </header>

      <section
        aria-label="账单摘要"
        className="mt-2 overflow-hidden rounded-sm border bg-surface shadow-sm"
      >
        <div className="flex items-center gap-3 px-3 py-3.5">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-orange text-white dark:text-[#241500]"
          >
            <CategoryIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="type-section-title truncate font-semibold">
              {expense.title}
            </h2>
            <p className="type-caption truncate text-muted-foreground">
              {activityName} ·{" "}
              {expenseCategoryLabels[category] ?? expenseCategoryLabels.OTHER}
            </p>
          </div>
          <MoneyAmount
            currency={currency}
            amountMinor={BigInt(expense.baseAmountMinor)}
            className="type-amount shrink-0 font-semibold"
          />
        </div>
        <dl className="flex flex-wrap items-center gap-2 border-t px-3 py-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1.5">
            <dt className="type-caption text-muted-foreground">分摊方式</dt>
            <dd className="type-caption font-semibold">
              {splitModeLabels[expense.splitMode] ?? expense.splitMode}
            </dd>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1.5">
            <dt className="type-caption text-muted-foreground">分摊人数</dt>
            <dd className="type-caption font-semibold">
              {data.shares.length}人
            </dd>
          </div>
          {expense.splitMode === "EQUAL" ? (
            <div className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1.5 text-primary">
              <dt className="type-caption">人均</dt>
              <dd>
                <MoneyAmount
                  currency={currency}
                  amountMinor={averageMinor}
                  size="sm"
                  tone="receivable"
                  className="font-semibold"
                />
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="mt-5" aria-labelledby="member-split-title">
        <h2
          id="member-split-title"
          className="type-section-title mb-2 font-semibold"
        >
          成员分摊明细
        </h2>
        <div className="overflow-hidden rounded-sm border bg-surface shadow-sm">
          <table aria-label="成员分摊明细" className="w-full table-fixed">
            <thead className="bg-surface-muted text-[11px] text-muted-foreground">
              <tr>
                <th
                  scope="col"
                  className="w-[38%] px-2.5 py-2 text-left font-medium"
                >
                  成员
                </th>
                <th
                  scope="col"
                  className="w-[20%] px-1 py-2 text-right font-medium"
                >
                  应承担
                </th>
                <th
                  scope="col"
                  className="w-[20%] px-1 py-2 text-right font-medium"
                >
                  已支付
                </th>
                <th
                  scope="col"
                  className="w-[22%] px-2.5 py-2 text-right font-medium"
                >
                  <span className="inline-flex items-center gap-0.5">
                    净额
                    <CircleHelpIcon aria-hidden="true" className="size-3" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const netMinor = row.paidMinor - row.shareMinor;
                return (
                  <tr key={row.memberId} className="h-14">
                    <th
                      scope="row"
                      className="px-2.5 py-2 text-left font-medium"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <MemberAvatar
                          memberId={row.memberId}
                          displayName={row.displayName}
                          avatarPreset={row.avatarPreset}
                          className="size-7 shrink-0"
                        />
                        <span className="min-w-0 truncate text-xs">
                          {row.displayName}
                        </span>
                        {row.paidMinor > 0n &&
                        expense.splitMode !== "PERCENTAGE" &&
                        expense.splitMode !== "WEIGHT" ? (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            付款人
                          </span>
                        ) : (
                          <SplitValue
                            mode={expense.splitMode}
                            value={row.splitInputMinor}
                          />
                        )}
                      </span>
                    </th>
                    <td className="money px-1 py-2 text-right text-xs font-semibold">
                      {formatMoney(
                        {
                          currency: asCurrencyCode(currency),
                          amountMinor: row.shareMinor,
                        },
                        "zh-CN",
                      )}
                    </td>
                    <td className="money px-1 py-2 text-right text-xs font-semibold">
                      {formatMoney(
                        {
                          currency: asCurrencyCode(currency),
                          amountMinor: row.paidMinor,
                        },
                        "zh-CN",
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-right text-xs">
                      <SignedNetAmount
                        currency={currency}
                        amountMinor={netMinor}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section
        aria-label="账务校验"
        className="mt-5 rounded-sm border bg-surface px-3 shadow-sm"
      >
        <dl className="divide-y">
          <div className="flex min-h-11 items-center justify-between">
            <dt className="type-label text-muted-foreground">承担合计</dt>
            <dd>
              <MoneyAmount
                currency={currency}
                amountMinor={shareTotal}
                size="sm"
                className="font-semibold"
              />
            </dd>
          </div>
          <div className="flex min-h-11 items-center justify-between">
            <dt className="type-label text-muted-foreground">支付合计</dt>
            <dd>
              <MoneyAmount
                currency={currency}
                amountMinor={paymentTotal}
                size="sm"
                className="font-semibold"
              />
            </dd>
          </div>
          <div className="flex min-h-11 items-center justify-between">
            <dt className="type-label text-muted-foreground">净额合计</dt>
            <dd className="text-sm">
              <SignedNetAmount currency={currency} amountMinor={netTotal} />
            </dd>
          </div>
        </dl>
      </section>

      <p className="type-caption mt-3 flex items-center gap-1.5 text-muted-foreground">
        <CircleHelpIcon aria-hidden="true" className="size-4 shrink-0" />
        正数表示应收，负数表示应付
      </p>
    </article>
  );
}
