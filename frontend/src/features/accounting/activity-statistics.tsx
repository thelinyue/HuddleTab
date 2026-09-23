import { useMemo, useRef, useState, type ReactNode } from "react";
import { BarChart3, CalendarDays, ChevronDown, Info, ListOrdered, PieChart, UsersRound } from "lucide-react";
import { Popover } from "radix-ui";
import { DayPicker } from "react-day-picker";
import { zhCN } from "react-day-picker/locale";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { MemberAvatar } from "../../components/member-avatar";
import { Button, ErrorNotice, Money } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import { useWorkspace } from "../activities/workspace-context";
import { useExpensesQuery } from "./api";
import { AccountingSkeleton } from "./skeleton";
import {
  buildActivityStatistics, categoryDetails, chartPercent, compareAmount, percentageLabel, validStatisticsRange,
  type CategoryStatistic, type DailyStatistic, type StatisticsRange,
} from "./activity-statistics-model";

export { buildActivityStatistics, type ActivityStatistics } from "./activity-statistics-model";

function Choices({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <div className="statistics-choices" role="group" aria-label={label}>
    {options.map(([key, text]) => <button key={key} type="button" aria-pressed={key === value} onClick={() => onChange(key)}>{text}</button>)}
  </div>;
}

function Help({ label, children }: { label: string; children: ReactNode }) {
  return <Popover.Root>
    <Popover.Trigger asChild><button className="expense-summary__info-trigger" type="button" aria-label={label}><Info aria-hidden="true" size={14} /></button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="expense-summary__info-popover" side="top" align="start" sideOffset={8} collisionPadding={12}>
      <p>{children}</p><Popover.Arrow className="expense-summary__info-arrow" />
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

function localDate(value: string): Date { return new Date(`${value}T00:00:00`); }
function isoDate(value: Date): string { return `${value.getFullYear().toString().padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }

/** 日历中的草稿只在应用后写入 URL；关闭或 Escape 均保留已应用范围。 */
function DateRangeFilter({ range, initialDate, onChange }: { range?: StatisticsRange; initialDate?: string; onChange: (range?: StatisticsRange) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [step, setStep] = useState<"from" | "to">("from");
  const [month, setMonth] = useState(new Date());
  const heading = useRef<HTMLDivElement>(null);
  function changeOpen(next: boolean) {
    if (next) {
      setFrom(range?.from ?? ""); setTo(range?.to ?? ""); setStep("from");
      setMonth(range ? localDate(range.from) : initialDate ? localDate(initialDate) : new Date());
    }
    setOpen(next);
  }
  return <div className="statistics-filter">
    <Popover.Root open={open} onOpenChange={changeOpen} modal>
      <Popover.Trigger asChild><Button variant="secondary" aria-label="选择统计日期范围"><CalendarDays aria-hidden="true" size={17} /><span>{range ? `${range.from} – ${range.to}` : "整个活动"}</span><ChevronDown aria-hidden="true" size={16} /></Button></Popover.Trigger>
      <Popover.Portal><Popover.Content className="management-date-popover statistics-date-popover" align="start" sideOffset={8} collisionPadding={12} onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus(); }}>
        <div className="management-date-popover__heading" ref={heading} tabIndex={-1}>选择统计日期</div>
        <div className="management-date-popover__range" aria-live="polite"><span>开始日期<strong>{from || "请选择"}</strong></span><span>结束日期<strong>{to || "请选择"}</strong></span></div>
        <DayPicker mode="range" locale={zhCN} month={month} onMonthChange={setMonth} selected={from ? { from: localDate(from), to: to ? localDate(to) : undefined } : undefined}
          disabled={step === "to" && from ? { before: localDate(from) } : undefined}
          onDayClick={day => { if (step === "from") { setFrom(isoDate(day)); setTo(""); setStep("to"); } else { setTo(isoDate(day)); setStep("from"); } }} />
        <div className="management-date-popover__actions">
          <Button variant="ghost" onClick={() => { onChange(); setOpen(false); }}>整个活动</Button>
          <Button variant="secondary" onClick={() => setOpen(false)}>取消</Button>
          <Button disabled={!validStatisticsRange(from, to)} onClick={() => { onChange(validStatisticsRange(from, to)); setOpen(false); }}>应用</Button>
        </div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>
    {range ? <Button variant="ghost" onClick={() => onChange()}>重置</Button> : null}
    <small>按本地消费日期 · 含起止日</small>
  </div>;
}

function CategoryChart({ statistics, currency, metric, view }: { statistics: readonly CategoryStatistic[]; currency: string; metric: string; view: string }) {
  const value = (item: CategoryStatistic) => metric === "count" ? BigInt(item.count) : item.amountMinor;
  const sorted = [...statistics].sort((a, b) => compareAmount(value(a), value(b)) || a.key.localeCompare(b.key));
  const total = sorted.reduce((sum, item) => sum + value(item), 0n);
  const maximum = value(sorted[0]!);
  let consumed = 0n;
  const gradient = sorted.map(item => {
    const start = chartPercent(consumed, total);
    consumed += value(item);
    return `${item.color} ${start}% ${chartPercent(consumed, total)}%`;
  }).join(", ");
  return <div className={`activity-statistics-category-layout${view === "bar" ? " statistics-category--bar" : ""}`}>
    {view === "donut" ? <div className="activity-statistics-donut" style={{ background: `conic-gradient(${gradient})` }} role="img" aria-label={`分类消费圆形图，${metric === "count" ? `账单${total}笔` : `总消费${formatMoney(currency, total)}`}`}>
      <div><small>{metric === "count" ? "账单笔数" : "总消费"}</small><Money value={metric === "count" ? `${total} 笔` : formatMoney(currency, total)} /></div>
    </div> : null}
    <ul className="statistics-category-list" aria-label="分类消费明细">
      {sorted.map(item => <li key={item.key}>
        <div className="statistics-category-label"><i style={{ background: item.color }} aria-hidden="true" /><strong>{item.label}</strong><small>{percentageLabel(value(item), total)}</small></div>
        <div className="statistics-category-value"><Money value={formatMoney(currency, item.amountMinor)} /><small>{item.count} 笔</small></div>
        {view === "bar" ? <div className="statistics-track" aria-hidden="true"><i style={{ width: `${chartPercent(value(item), maximum)}%`, background: item.color }} /></div> : null}
      </li>)}
    </ul>
  </div>;
}

/** 同一连续日期序列驱动柱图、折线和明细；零消费日不伪造最小柱高。 */
function TrendChart({ days, currency, cumulative }: { days: readonly DailyStatistic[]; currency: string; cumulative: boolean }) {
  const maximum = days.reduce((max, item) => (cumulative ? item.cumulativeMinor : item.amountMinor) > max ? (cumulative ? item.cumulativeMinor : item.amountMinor) : max, 0n);
  const columnWidth = Math.max(100, formatMoney(currency, maximum).length * 8 + 24);
  const width = Math.max(280, days.length * columnWidth);
  const x = (index: number) => days.length === 1 ? width / 2 : columnWidth / 2 + index * (width - columnWidth) / (days.length - 1);
  const y = (item: DailyStatistic) => 160 - chartPercent(item.cumulativeMinor, maximum) * 1.4;
  return <>
    <div className="activity-statistics-bars-scroll" tabIndex={0} role="region" aria-label={cumulative ? "累计消费图表，可横向滚动" : "每日消费图表，可横向滚动"}>
      {cumulative ? <div className="statistics-line" style={{ minWidth: width }}>
        <svg width="100%" height="200" viewBox={`0 0 ${width} 200`} role="img" aria-label={`累计消费折线图，累计${formatMoney(currency, days[days.length - 1]!.cumulativeMinor)}`}>
          <line x1="20" y1="160" x2={width - 20} y2="160" className="statistics-line-axis" />
          <polyline points={days.map((item, index) => `${x(index)},${y(item)}`).join(" ")} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinejoin="round" />
          {days.map((item, index) => <g key={item.date}><circle cx={x(index)} cy={y(item)} r="4" fill="var(--primary)" /><text x={x(index)} y={y(item) - 10} textAnchor="middle">{formatMoney(currency, item.cumulativeMinor)}</text><text x={x(index)} y="188" textAnchor="middle">{item.date.slice(5)}</text></g>)}
        </svg>
      </div> : <div className="activity-statistics-bars" aria-label="每日消费柱状图">
        {days.map(item => <div className="activity-statistics-bar-column" key={item.date} role="img" aria-label={`${item.date}消费${formatMoney(currency, item.amountMinor)}`}>
          <small>{formatMoney(currency, item.amountMinor)}</small>
          <div className="activity-statistics-bar-track"><i style={{ height: `${chartPercent(item.amountMinor, maximum)}%` }} /></div>
          <span>{item.date.slice(5)}</span>
        </div>)}
      </div>}
    </div>
    <details className="statistics-data"><summary>查看每日明细</summary><div className="statistics-table-scroll"><table><caption>每日消费与累计消费</caption><thead><tr><th>日期</th><th>每日消费</th><th>累计消费</th></tr></thead><tbody>
      {days.map(item => <tr key={item.date}><th scope="row">{item.date}</th><td>{formatMoney(currency, item.amountMinor)}</td><td>{formatMoney(currency, item.cumulativeMinor)}</td></tr>)}
    </tbody></table></div></details>
  </>;
}

/** URL 只记录展示状态，不触发账单写入；保留进入工作区时的 state 以维持返回路径。 */
export function ActivityStatisticsPage() {
  const { activity, members, offline, session, snapshot } = useWorkspace();
  const expenses = useExpensesQuery(session.userId, activity.activityId, !offline);
  const allExpenses = expenses.data ?? snapshot?.snapshot.expenses;
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const from = params.get("from"); const to = params.get("to");
  const range = useMemo(() => validStatisticsRange(from, to), [from, to]);
  const metric = params.get("categoryMetric") === "count" ? "count" : "amount";
  const categoryView = params.get("categoryView") === "bar" ? "bar" : "donut";
  const trend = params.get("trend") === "cumulative" ? "cumulative" : "daily";
  const memberSort = params.get("memberSort") === "payment" ? "payment" : "consumption";
  const memberView = params.get("memberView") === "list" ? "list" : "compare";
  function update(values: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
    setParams(next, { replace: true, state: location.state });
  }
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const statistics = useMemo(() => buildActivityStatistics(allExpenses ?? [], members, timeZone, range), [allExpenses, members, timeZone, range]);
  const currency = activity.baseCurrency;
  const money = (value: bigint | null) => value === null ? "—" : formatMoney(currency, value);
  const sortedMembers = [...statistics.members].sort((a, b) => compareAmount(memberSort === "payment" ? a.billPaymentMinor : a.consumptionMinor, memberSort === "payment" ? b.billPaymentMinor : b.consumptionMinor));
  const memberMaximum = statistics.members.reduce((max, item) => [max, item.billPaymentMinor, item.consumptionMinor].reduce((a, b) => a > b ? a : b), 0n);

  if (offline && !allExpenses) return <div className="activity-statistics-page"><p className="notice" role="status">离线快照不可用，请联网后重新加载活动统计。</p></div>;
  if (!allExpenses && expenses.isPending) return <AccountingSkeleton kind="feed" />;
  if (!allExpenses && expenses.error) return <div className="activity-statistics-page"><ErrorNotice error={expenses.error} /><Button variant="secondary" onClick={() => void expenses.refetch()}>重试</Button></div>;

  return <div className="activity-statistics-page">
    {offline ? <div className="notice" role="status"><Info aria-hidden="true" size={18} /><span>当前离线，统计使用最近一次同步的活动数据。</span></div> : null}
    {expenses.error && allExpenses ? <div className="notice" role="alert">统计更新失败，当前显示已加载内容。<Button variant="ghost" onClick={() => void expenses.refetch()}>重试</Button></div> : null}
    <DateRangeFilter range={range} initialDate={statistics.days[0]?.date} onChange={value => update({ from: value?.from, to: value?.to })} />
    <section className="activity-statistics-overview" aria-label="活动消费总览">
      <div className="statistics-total"><small>{range ? "所选日期总消费" : "总消费"}<span>{currency}</span></small><Money value={money(statistics.totalMinor)} /></div>
      <div><small>人均消费<Help label="人均消费说明">所选范围总消费除以当前活动成员数（不含已移除成员）。人均消费仅为统计平均值，不代表任何成员实际应承担金额。</Help></small><Money value={money(statistics.averageMemberMinor)} /></div>
      <div><small>单笔均额</small><Money value={money(statistics.averageBillMinor)} /></div>
      <div><small>账单笔数</small><strong>{statistics.billCount} 笔</strong></div>
      <div><small>消费天数</small><strong>{statistics.consumptionDays} 天</strong></div>
    </section>
    {!statistics.billCount ? <div className="statistics-empty" role="status"><BarChart3 aria-hidden="true" size={30} /><h2>{allExpenses?.length ? "所选日期暂无账单" : "活动暂无账单"}</h2><p>{allExpenses?.length ? "调整日期范围后，再查看消费分析。" : "记录账单后，这里将展示消费分布与趋势。"}</p>{range ? <Button variant="secondary" onClick={() => update({ from: undefined, to: undefined })}>查看整个活动</Button> : null}</div> : <>
      <section className="activity-statistics-section" aria-labelledby="category-statistics-heading">
        <header><span><PieChart aria-hidden="true" size={19} /><h2 id="category-statistics-heading">分类消费</h2></span><small>{currency}</small></header>
        <div className="statistics-controls"><Choices label="分类统计指标" value={metric} options={[["amount", "金额"], ["count", "笔数"]]} onChange={value => update({ categoryMetric: value })} /><Choices label="分类图表样式" value={categoryView} options={[["donut", "环形"], ["bar", "条形"]]} onChange={value => update({ categoryView: value })} /></div>
        <CategoryChart statistics={statistics.categories} currency={currency} metric={metric} view={categoryView} />
      </section>
      <section className="activity-statistics-section" aria-labelledby="daily-statistics-heading">
        <header><span><BarChart3 aria-hidden="true" size={19} /><h2 id="daily-statistics-heading">消费趋势</h2></span><small>按消费发生日期</small></header>
        <div className="statistics-controls"><Choices label="消费趋势类型" value={trend} options={[["daily", "每日消费"], ["cumulative", "累计消费"]]} onChange={value => update({ trend: value })} /><small>{statistics.days[0]?.date} – {statistics.days.at(-1)?.date}</small></div>
        <TrendChart days={statistics.days} currency={currency} cumulative={trend === "cumulative"} />
      </section>
      <section className="activity-statistics-section" aria-labelledby="member-statistics-heading">
        <header><span><UsersRound aria-hidden="true" size={19} /><h2 id="member-statistics-heading">成员费用</h2><Help label="成员费用说明"><strong>总消费：</strong><span>按账单分摊结果统计到该成员名下的消费金额。</span><br /><strong>总支出：</strong><span>该成员实际支付给商家的账单金额。</span></Help></span></header>
        <div className="statistics-controls"><Choices label="成员费用排序" value={memberSort} options={[["consumption", "按总消费"], ["payment", "按总支出"]]} onChange={value => update({ memberSort: value })} /><Choices label="成员费用样式" value={memberView} options={[["compare", "对比"], ["list", "明细"]]} onChange={value => update({ memberView: value })} /></div>
        <div className={`activity-statistics-member-list${memberView === "compare" ? " statistics-members--compare" : ""}`}>
          <div className="activity-statistics-member-head"><span>成员</span><span>总消费</span><span>总支出</span></div>
          {sortedMembers.map(item => <div className="activity-statistics-member-row" key={item.member.memberId}>
            <div><MemberAvatar memberId={item.member.memberId} userId={item.member.userId} displayName={item.member.displayName} avatarPreset={item.member.avatarPreset} avatarImageId={item.member.avatarImageId} size="sm" /><span><strong title={item.member.displayName}>{item.member.displayName}</strong>{item.member.status === "LEFT" ? <small>已移除</small> : null}</span></div>
            <span><small>总消费</small><Money value={money(item.consumptionMinor)} />{memberView === "compare" ? <i className="statistics-track" aria-hidden="true"><i style={{ width: `${chartPercent(item.consumptionMinor, memberMaximum)}%` }} /></i> : null}</span>
            <span><small>总支出</small><Money value={money(item.billPaymentMinor)} />{memberView === "compare" ? <i className="statistics-track statistics-track--payment" aria-hidden="true"><i style={{ width: `${chartPercent(item.billPaymentMinor, memberMaximum)}%` }} /></i> : null}</span>
          </div>)}
        </div>
      </section>
      <section className="activity-statistics-section" aria-labelledby="top-expenses-heading">
        <header><span><ListOrdered aria-hidden="true" size={19} /><h2 id="top-expenses-heading">大额账单</h2></span><small>金额最高的前 5 笔</small></header>
        <ol className="statistics-top-expenses">{statistics.topExpenses.map((item, index) => <li key={item.expense.expenseId}><Link to={`/activities/${encodeURIComponent(activity.activityId)}/expenses/${encodeURIComponent(item.expense.expenseId)}?view=readonly`} state={{ expenseDetailFromStatistics: true }}>
          <span className="statistics-rank">{index + 1}</span><span className="statistics-bill-label"><strong>{item.expense.title}</strong><small>{new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(item.expense.occurredAt))} · {categoryDetails.get(item.expense.category)?.label ?? "其他"}</small></span><Money value={money(BigInt(item.expense.baseAmountMinor))} />
        </Link></li>)}</ol>
      </section>
    </>}
  </div>;
}
