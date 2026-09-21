import type { CSSProperties } from "react";
import { BarChart3, Info, PieChart, UsersRound } from "lucide-react";
import { Popover } from "radix-ui";

import { MemberAvatar } from "../../components/member-avatar";
import { Button, ErrorNotice, Money } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import type { ActivityMember } from "../activities/api";
import { useWorkspace } from "../activities/workspace-context";
import { type ExpenseAggregate, useExpensesQuery } from "./api";
import { categories } from "./shared";
import { AccountingSkeleton } from "./skeleton";

type CategoryStatistic = {
  amountMinor: bigint;
  color: string;
  key: string;
  label: string;
};

type DailyStatistic = {
  amountMinor: bigint;
  date: string;
};

type MemberStatistic = {
  billPaymentMinor: bigint;
  consumptionMinor: bigint;
  member: ActivityMember;
};

export type ActivityStatistics = {
  categories: CategoryStatistic[];
  days: DailyStatistic[];
  members: MemberStatistic[];
  totalMinor: bigint;
};

const categoryDetails = new Map<string, { color: string; label: string }>(
  categories.map(([key, label], index) => [key, { color: `var(--chart-${index + 1})`, label }]),
);

function calendarDate(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/**
 * 活动统计只汇总服务端已经固化的账单事实，不重新执行分摊规则。
 * Share 表示按账单分摊结果归集到成员名下的总消费，Payment 表示成员向商家支付的总支出；
 * 两者均使用活动主币种金额，因此不会把不同原币种直接相加。
 */
export function buildActivityStatistics(
  expenses: readonly ExpenseAggregate[],
  members: readonly ActivityMember[],
  timeZone: string,
): ActivityStatistics {
  const memberTotals = new Map(members.map((member, index) => [member.memberId, {
    billPaymentMinor: 0n,
    consumptionMinor: 0n,
    index,
    member,
  }]));
  const categoryTotals = new Map<string, bigint>();
  const dailyTotals = new Map<string, bigint>();
  let totalMinor = 0n;

  for (const item of expenses) {
    const amount = BigInt(item.expense.baseAmountMinor);
    const category = categoryDetails.has(item.expense.category) ? item.expense.category : "OTHER";
    const date = calendarDate(item.expense.occurredAt, timeZone);
    totalMinor += amount;
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0n) + amount);
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

  const categoryStats = [...categoryTotals]
    .map(([key, amountMinor]) => ({
      amountMinor,
      color: categoryDetails.get(key)?.color ?? "var(--chart-7)",
      key,
      label: categoryDetails.get(key)?.label ?? "其他",
    }))
    .sort((left, right) => left.amountMinor === right.amountMinor ? left.key.localeCompare(right.key) : left.amountMinor > right.amountMinor ? -1 : 1);
  const days = [...dailyTotals]
    .map(([date, amountMinor]) => ({ amountMinor, date }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const memberStats = [...memberTotals.values()]
    .sort((left, right) => left.consumptionMinor === right.consumptionMinor ? left.index - right.index : left.consumptionMinor > right.consumptionMinor ? -1 : 1)
    .map(({ index: _index, ...member }) => member);

  return { categories: categoryStats, days, members: memberStats, totalMinor };
}

function percentageLabel(amount: bigint, total: bigint): string {
  if (total === 0n) return "0%";
  const tenths = (amount * 1_000n + total / 2n) / total;
  return tenths % 10n === 0n ? `${tenths / 10n}%` : `${tenths / 10n}.${tenths % 10n}%`;
}

function donutGradient(statistics: readonly CategoryStatistic[], total: bigint): string {
  let consumed = 0n;
  return statistics.map((item) => {
    const start = Number((consumed * 10_000n) / total) / 100;
    consumed += item.amountMinor;
    const end = Number((consumed * 10_000n) / total) / 100;
    return `${item.color} ${start}% ${end}%`;
  }).join(", ");
}

function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function MemberExpenseHelp() {
  return <Popover.Root>
    <Popover.Trigger asChild>
      <button className="expense-summary__info-trigger" type="button" aria-label="成员费用说明">
        <Info aria-hidden="true" size={14} />
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="expense-summary__info-popover" side="top" align="start" sideOffset={8}>
        <p><strong>总消费：</strong><span>按账单分摊结果统计到该成员名下的消费金额。</span><br /><strong>总支出：</strong><span>该成员实际支付给商家的账单金额。</span></p>
        <Popover.Arrow className="expense-summary__info-arrow" />
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

function CategoryChart({ statistics, currency, total }: { statistics: readonly CategoryStatistic[]; currency: string; total: bigint }) {
  if (total === 0n) return <p className="activity-statistics-empty">还没有可统计的分类消费。</p>;
  const style = { background: `conic-gradient(${donutGradient(statistics, total)})` } as CSSProperties;
  return <div className="activity-statistics-category-layout">
    <div className="activity-statistics-donut" style={style} role="img" aria-label={`分类消费圆形图，总消费${formatMoney(currency, total.toString())}`}>
      <div><small>总消费</small><Money value={formatMoney(currency, total.toString())} /></div>
    </div>
    <ul className="activity-statistics-legend" aria-label="分类消费明细">
      {statistics.map((item) => <li key={item.key}>
        <i style={{ background: item.color }} aria-hidden="true" />
        <span><strong>{item.label}</strong><small>{percentageLabel(item.amountMinor, total)}</small></span>
        <Money value={formatMoney(currency, item.amountMinor.toString())} />
      </li>)}
    </ul>
  </div>;
}

function DailyChart({ statistics, currency }: { statistics: readonly DailyStatistic[]; currency: string }) {
  if (!statistics.length) return <p className="activity-statistics-empty">还没有可统计的每日消费。</p>;
  const maximum = statistics.reduce((result, item) => item.amountMinor > result ? item.amountMinor : result, 0n);
  return <div className="activity-statistics-bars-scroll">
    <div className="activity-statistics-bars" aria-label="每日消费柱状图">
      {statistics.map((item) => {
        const height = maximum === 0n ? 0 : Math.max(6, Number((item.amountMinor * 10_000n) / maximum) / 100);
        return <div className="activity-statistics-bar-column" key={item.date} role="img" aria-label={`${shortDate(item.date)}消费${formatMoney(currency, item.amountMinor.toString())}`}>
          <small>{formatMoney(currency, item.amountMinor.toString())}</small>
          <div className="activity-statistics-bar-track"><i style={{ height: `${height}%` }} /></div>
          <span>{shortDate(item.date)}</span>
        </div>;
      })}
    </div>
  </div>;
}

export function ActivityStatisticsPage() {
  const { activity, members, offline, session, snapshot } = useWorkspace();
  const expenses = useExpensesQuery(session.userId, activity.activityId, !offline);
  const allExpenses = expenses.data ?? snapshot?.snapshot.expenses;

  if (!allExpenses && expenses.isPending) return <AccountingSkeleton kind="feed" />;
  if (!allExpenses && expenses.error) return <div className="activity-statistics-page"><ErrorNotice error={expenses.error} /><Button variant="secondary" onClick={() => void expenses.refetch()}>重试</Button></div>;

  const statistics = buildActivityStatistics(
    allExpenses ?? [],
    members,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const currency = activity.baseCurrency;

  return <div className="activity-statistics-page">
    {offline ? <div className="notice" role="status"><Info aria-hidden="true" size={18} /><span>当前离线，统计使用最近一次同步的活动快照。</span></div> : null}
    {expenses.error && allExpenses ? <div className="notice" role="alert">统计更新失败，当前显示已加载内容。<Button variant="ghost" onClick={() => void expenses.refetch()}>重试</Button></div> : null}
    <section className="activity-statistics-overview" aria-label="活动消费总览">
      <div><small>总消费</small><Money value={formatMoney(currency, statistics.totalMinor.toString())} /></div>
      <div><small>账单</small><strong>{allExpenses?.length ?? 0} 笔</strong></div>
      <div><small>消费天数</small><strong>{statistics.days.length} 天</strong></div>
    </section>

    <section className="activity-statistics-section" aria-labelledby="category-statistics-heading">
      <header><span><PieChart aria-hidden="true" size={19} /><h2 id="category-statistics-heading">分类消费</h2></span><small>{currency}</small></header>
      <CategoryChart statistics={statistics.categories} currency={currency} total={statistics.totalMinor} />
    </section>

    <section className="activity-statistics-section" aria-labelledby="daily-statistics-heading">
      <header><span><BarChart3 aria-hidden="true" size={19} /><h2 id="daily-statistics-heading">每日消费</h2></span><small>按消费发生日期</small></header>
      <DailyChart statistics={statistics.days} currency={currency} />
    </section>

    <section className="activity-statistics-section" aria-labelledby="member-statistics-heading">
      <header><span><UsersRound aria-hidden="true" size={19} /><h2 id="member-statistics-heading">成员费用</h2><MemberExpenseHelp /></span><small>按总消费排序</small></header>
      <div className="activity-statistics-member-list">
        <div className="activity-statistics-member-head"><span>成员</span><span>总消费</span><span>总支出</span></div>
        {statistics.members.map((item) => <div className="activity-statistics-member-row" key={item.member.memberId}>
          <div><MemberAvatar memberId={item.member.memberId} userId={item.member.userId} displayName={item.member.displayName} avatarPreset={item.member.avatarPreset} avatarImageId={item.member.avatarImageId} size="sm" /><span><strong>{item.member.displayName}</strong>{item.member.status === "LEFT" ? <small>已移除</small> : null}</span></div>
          <span><small>总消费</small><Money value={formatMoney(currency, item.consumptionMinor.toString())} /></span>
          <span><small>总支出</small><Money value={formatMoney(currency, item.billPaymentMinor.toString())} /></span>
        </div>)}
      </div>
    </section>
  </div>;
}
