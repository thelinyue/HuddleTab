import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, ErrorNotice, Money } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import type { ActivityMember } from "../activities/api";
import type { ExpenseAggregate, Settlement } from "./api";
import { memberName } from "./shared";

type CashApplication = NonNullable<Settlement["cashApplications"]>[number];

function billTime(value: string, options: Intl.DateTimeFormatOptions) {
  return new Date(value).toLocaleString("zh-CN", options);
}

function billDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function cashExpenseIds(applications: readonly CashApplication[]) {
  return [...new Set(applications.flatMap(item => item.expenseIds))];
}

/** 摘要与弹窗使用相同的现金路径和设备时区，不把原始结算范围当作实际清偿。 */
export function settlementCashBillSummary(settlement: Settlement, byId: ReadonlyMap<string, ExpenseAggregate>, pending: boolean) {
  if (settlement.status === "VOID") return "查看结算明细";
  const applications = settlement.cashApplications;
  if (!applications) return "清偿明细待同步";
  if (!applications.length) return "清偿明细待核对";
  const expenseIds = cashExpenseIds(applications);
  if (!expenseIds.length) return "未关联账单";
  const dates = new Set<string>();
  for (const id of expenseIds) {
    const bill = byId.get(id);
    if (!bill) return `清偿账单 ${pending ? "日期读取中" : "日期暂不可用"} · ${expenseIds.length} 笔`;
    dates.add(billDateKey(bill.expense.occurredAt));
  }
  const sorted = [...dates].sort();
  const sameYear = sorted.every(date => date.slice(0, 4) === sorted[0].slice(0, 4));
  const label = sorted.length > 2 ? `${sorted.length} 天` : sorted.map(date => {
    const [year, month, day] = date.split("-");
    return `${sameYear ? "" : `${year}/`}${Number(month)}/${Number(day)}`;
  }).join("、");
  return `清偿账单 ${label} · ${expenseIds.length} 笔`;
}

function BillTitle({ title }: { title: string }) {
  return <span className="settlement-bill__title"><strong>{title}</strong><ChevronRight size={14} aria-hidden="true" /></span>;
}

function BillMeta({ bill, members, withDate }: { bill: ExpenseAggregate; members: readonly ActivityMember[]; withDate: boolean }) {
  const { expense, payments } = bill;
  return <>
    <small className="settlement-bill__meta">
      <time dateTime={expense.occurredAt}>{billTime(expense.occurredAt, withDate
        ? { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
        : { hour: "2-digit", minute: "2-digit", hour12: false })}</time>
      <span> · {payments.length ? `${payments.map(payment => memberName(payment.memberId, members)).join("、")}付款` : "付款人未知"}</span>
    </small>
    <small className="settlement-bill__total">账单总额 {formatMoney(expense.originalCurrency, expense.originalAmountMinor)}</small>
  </>;
}

function UnavailableBill({ amountMinor, settlement, pending, className = "settlement-bill" }: {
  amountMinor?: string; settlement: Settlement; pending: boolean; className?: string;
}) {
  return <div className={`${className} settlement-bill--unavailable`}>
    <span className="settlement-bill__title"><strong>账单详情暂不可用</strong></span>
    {amountMinor ? <Money value={formatMoney(settlement.currency, amountMinor)} /> : null}
    <small className="settlement-bill__meta">{pending ? "正在读取账单…" : "金额已保留，可稍后重试。"}</small>
  </div>;
}

function DirectBill({ item, bill, settlement, members }: {
  item: CashApplication; bill: ExpenseAggregate; settlement: Settlement; members: readonly ActivityMember[];
}) {
  return <Link
    className="settlement-bill"
    to={`/activities/${encodeURIComponent(settlement.activityId)}/expenses/${encodeURIComponent(bill.expense.expenseId)}?view=readonly`}
    state={{ expenseDetailFromSettlement: true }}
  >
    <BillTitle title={bill.expense.title} />
    <Money value={formatMoney(settlement.currency, item.amountMinor)} />
    <BillMeta bill={bill} members={members} withDate={false} />
  </Link>;
}

function CrossBillPath({ item, bills, settlement, members, pending }: {
  item: CashApplication; bills: readonly (ExpenseAggregate | undefined)[]; settlement: Settlement; members: readonly ActivityMember[]; pending: boolean;
}) {
  return <article className="settlement-cross-bill">
    <div className="settlement-cross-bill__amount"><span>{item.expenseIds.length} 张账单</span><Money value={formatMoney(settlement.currency, item.amountMinor)} /></div>
    {item.expenseIds.map((expenseId, index) => {
      const bill = bills[index];
      if (!bill) return <UnavailableBill key={`${expenseId}-${index}`} settlement={settlement} pending={pending} className="settlement-cross-bill__link" />;
      return <Link
        className="settlement-cross-bill__link"
        key={expenseId}
        to={`/activities/${encodeURIComponent(settlement.activityId)}/expenses/${encodeURIComponent(expenseId)}?view=readonly`}
        state={{ expenseDetailFromSettlement: true }}
      >
        <BillTitle title={bill.expense.title} />
        <BillMeta bill={bill} members={members} withDate />
      </Link>;
    })}
  </article>;
}

/** 只展示服务端逐笔现金拆分；双侧进度与整单金额都不能充当本次付款的组成金额。 */
export function SettlementCashBills({ settlement, expenses, members, pending, error, retry }: {
  settlement: Settlement; expenses: readonly ExpenseAggregate[]; members: readonly ActivityMember[];
  pending: boolean; error: unknown; retry: () => void;
}) {
  if (settlement.status === "VOID") return <p className="settlement-bills-empty">已作废，不计入余额。</p>;
  const applications = settlement.cashApplications;
  if (!applications) return <p className="settlement-bills-empty">金额明细待同步，请联网刷新。</p>;
  const byId = new Map(expenses.map(item => [item.expense.expenseId, item]));
  const expenseIds = cashExpenseIds(applications);
  const missingCount = expenseIds.filter(id => !byId.has(id)).length;
  const total = applications.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
  const byOccurredAt = (left: CashApplication, right: CashApplication) => {
    const leftBill = byId.get(left.expenseIds[0]);
    const rightBill = byId.get(right.expenseIds[0]);
    return (leftBill?.expense.occurredAt ?? "~").localeCompare(rightBill?.expense.occurredAt ?? "~")
      || left.expenseIds.join(",").localeCompare(right.expenseIds.join(","));
  };
  const direct = applications.filter(item => item.expenseIds.length === 1 && byId.has(item.expenseIds[0])).sort(byOccurredAt);
  const missing = applications.filter(item => item.expenseIds.length === 1 && !byId.has(item.expenseIds[0])).sort(byOccurredAt);
  const cross = applications.filter(item => item.expenseIds.length > 1).sort(byOccurredAt);
  const unassigned = applications.filter(item => item.expenseIds.length === 0);
  const dateGroups: Array<{ key: string; label: string; items: CashApplication[] }> = [];
  for (const item of direct) {
    const bill = byId.get(item.expenseIds[0])!;
    const key = billDateKey(bill.expense.occurredAt);
    let group = dateGroups.at(-1);
    if (group?.key !== key) {
      group = { key, label: billTime(bill.expense.occurredAt, { year: "numeric", month: "long", day: "numeric" }), items: [] };
      dateGroups.push(group);
    }
    group.items.push(item);
  }

  return <section className="settlement-bills-list" aria-label="本次清偿明细">
    <div className="settlement-bills-scroll">
      {error ? <div className="settlement-load-error"><ErrorNotice error={error} /><Button variant="ghost" onClick={retry}>重试</Button></div> : null}
      {missingCount > 0 && !pending ? <p className="settlement-bills-missing" role="status">{missingCount} 笔账单详情暂不可用，金额已保留。</p> : null}
      {dateGroups.map(group => <section className="settlement-bill-group" key={group.key} aria-label={`${group.label}账单`}>
        <header className="settlement-bill-group__header"><h3>{group.label}</h3><span>本次结算</span></header>
        {group.items.map(item => <DirectBill key={item.expenseIds[0]} item={item} bill={byId.get(item.expenseIds[0])!} settlement={settlement} members={members} />)}
      </section>)}
      {cross.length ? <section className="settlement-bill-group" aria-label="跨账清偿">
        <header className="settlement-bill-group__header"><h3>跨账清偿</h3><span>金额仅计一次</span></header>
        {cross.map(item => <CrossBillPath key={item.expenseIds.join(",")} item={item} bills={item.expenseIds.map(id => byId.get(id))} settlement={settlement} members={members} pending={pending} />)}
      </section> : null}
      {unassigned.length ? <section className="settlement-bill-group" aria-label="未关联账单">
        <header className="settlement-bill-group__header"><h3>未关联账单</h3><span>现金往来</span></header>
        {unassigned.map((item, index) => <div className="settlement-bill settlement-bill--unassigned" key={`${item.amountMinor}-${index}`}>
          <span className="settlement-bill__title"><strong>未清偿具体账单</strong></span>
          <Money value={formatMoney(settlement.currency, item.amountMinor)} />
        </div>)}
      </section> : null}
      {missing.length ? <section className="settlement-bill-group" aria-label="账单详情待同步">
        <header className="settlement-bill-group__header"><h3>账单详情待同步</h3><span>金额已保留</span></header>
        {missing.map(item => <UnavailableBill key={item.expenseIds[0]} amountMinor={item.amountMinor} settlement={settlement} pending={pending} />)}
      </section> : null}
      {!applications.length ? <p className="settlement-bills-none">暂无具体清偿关联。</p> : null}
    </div>
    <div className="settlement-bills-footer">
      {total !== BigInt(settlement.amountMinor) ? <p role="alert">明细合计与转账金额不符，请刷新。</p> : null}
      <div className="settlement-bills-total" aria-label="清偿明细合计"><strong>合计</strong><Money value={formatMoney(settlement.currency, total)} /></div>
    </div>
  </section>;
}
