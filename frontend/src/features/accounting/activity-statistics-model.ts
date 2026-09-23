import type { ActivityMember } from "../activities/api";
import type { ExpenseAggregate } from "./api";
import { calendarDayDifference } from "../../lib/calendar-date";
import { categories } from "./shared";

export type StatisticsRange = { from: string; to: string };
export type CategoryStatistic = { amountMinor: bigint; count: number; color: string; key: string; label: string };
export type DailyStatistic = { amountMinor: bigint; cumulativeMinor: bigint; date: string };
export type MemberStatistic = { billPaymentMinor: bigint; consumptionMinor: bigint; member: ActivityMember };
export type ActivityStatistics = {
  categories: CategoryStatistic[];
  days: DailyStatistic[];
  members: MemberStatistic[];
  totalMinor: bigint;
  billCount: number;
  consumptionDays: number;
  averageMemberMinor: bigint | null;
  averageBillMinor: bigint | null;
  topExpenses: ExpenseAggregate[];
};

export const categoryDetails = new Map(categories.map(([key, label], index) => [key as string, { color: `var(--chart-${index + 1})`, label }]));

export function validStatisticsRange(from: string | null, to: string | null): StatisticsRange | undefined {
  const difference = calendarDayDifference(from, to);
  return from && to && difference !== null && difference >= 0 ? { from, to } : undefined;
}

function average(total: bigint, count: number): bigint | null {
  return count ? (total + BigInt(count) / 2n) / BigInt(count) : null;
}

/**
 * 只汇总服务端已固化的主币种事实：Share 是成员消费，Payment 是向商家的付款。
 * 日期筛选与聚合共用设备时区；连续日期用 UTC 公历递增，避免夏令时造成漏日。
 * 人均分母沿用当前 ACTIVE 成员数，不以账单参与人数代替，也不混入成员间结算。
 */
export function buildActivityStatistics(
  expenses: readonly ExpenseAggregate[], members: readonly ActivityMember[], timeZone: string, range?: StatisticsRange,
): ActivityStatistics {
  const formatter = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone });
  const memberTotals = new Map(members.map(member => [member.memberId, { billPaymentMinor: 0n, consumptionMinor: 0n, member }]));
  const categoryTotals = new Map<string, CategoryStatistic>();
  const dailyTotals = new Map<string, bigint>();
  const selected: ExpenseAggregate[] = [];
  let totalMinor = 0n;
  for (const item of expenses) {
    const parts = formatter.formatToParts(new Date(item.expense.occurredAt));
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
    const date = `${read("year")}-${read("month")}-${read("day")}`;
    if (range && (date < range.from || date > range.to)) continue;
    selected.push(item);
    const amount = BigInt(item.expense.baseAmountMinor);
    const key = categoryDetails.has(item.expense.category) ? item.expense.category : "OTHER";
    const category = categoryTotals.get(key) ?? { ...categoryDetails.get(key)!, key, amountMinor: 0n, count: 0 };
    category.amountMinor += amount;
    category.count++;
    categoryTotals.set(key, category);
    totalMinor += amount;
    dailyTotals.set(date, (dailyTotals.get(date) ?? 0n) + amount);
    for (const share of item.shares) {
      const member = memberTotals.get(share.memberId);
      if (member) member.consumptionMinor += BigInt(share.baseAmountMinor);
    }
    for (const payment of item.payments) {
      const member = memberTotals.get(payment.memberId);
      if (member) member.billPaymentMinor += BigInt(payment.baseAmountMinor);
    }
  }
  const dates = [...dailyTotals.keys()].sort();
  const days: DailyStatistic[] = [];
  let cumulativeMinor = 0n;
  // 无结果时直接使用页面空态，不为一个空范围生成大量零值节点。
  if (dates.length) {
    const cursor = new Date(`${range?.from ?? dates[0]}T00:00:00Z`);
    const end = range?.to ?? dates[dates.length - 1]!;
    const dayCount = calendarDayDifference(range?.from ?? dates[0]!, end)! + 1;
    for (let index = 0; index < dayCount; index++, cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = cursor.toISOString().slice(0, 10);
      const amountMinor = dailyTotals.get(date) ?? 0n;
      cumulativeMinor += amountMinor;
      days.push({ date, amountMinor, cumulativeMinor });
    }
  }
  return {
    categories: [...categoryTotals.values()].sort((a, b) => compareAmount(a.amountMinor, b.amountMinor) || a.key.localeCompare(b.key)),
    days,
    members: [...memberTotals.values()],
    totalMinor,
    billCount: selected.length,
    consumptionDays: dates.length,
    averageMemberMinor: average(totalMinor, members.filter(member => member.status === "ACTIVE").length),
    averageBillMinor: average(totalMinor, selected.length),
    topExpenses: selected.sort((a, b) => compareAmount(BigInt(a.expense.baseAmountMinor), BigInt(b.expense.baseAmountMinor)) || b.expense.occurredAt.localeCompare(a.expense.occurredAt) || a.expense.expenseId.localeCompare(b.expense.expenseId)).slice(0, 5),
  };
}

export function compareAmount(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

/** 金额始终保留整数精度，只把有界的绘图比例转换为 Number。 */
export function chartPercent(amount: bigint, total: bigint): number {
  return total === 0n ? 0 : Number(amount * 10_000n / total) / 100;
}

export function percentageLabel(amount: bigint, total: bigint): string {
  if (total === 0n) return "0%";
  const tenths = (amount * 1_000n + total / 2n) / total;
  return tenths % 10n === 0n ? `${tenths / 10n}%` : `${tenths / 10n}.${tenths % 10n}%`;
}
