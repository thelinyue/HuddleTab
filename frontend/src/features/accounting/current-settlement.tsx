import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { MemberAvatar } from "../../components/member-avatar";
import { ErrorNotice, LoadingState, Money } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import type { ActivityMember } from "../activities/api";
import { useWorkspace } from "../activities/workspace-context";
import { type ExpenseAggregate, useSettlementsQuery } from "./api";
import { currentSettlementLabel, memberAvatarImage, memberAvatarPreset, memberName } from "./shared";

/**
 * 当前余额只读取服务端清偿重放结果；历史记录按固定范围或清偿来源关联，不按金额猜测。
 * 编辑器把余额与历史放入默认收起的区域，展示的始终是已保存事实。
 */
export function CurrentSettlementSection({ aggregate, members, collapsible = false }: { aggregate: ExpenseAggregate; members: readonly ActivityMember[]; collapsible?: boolean }) {
  const { session, activity, offline, snapshot } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const sectionId = useId();
  const query = useSettlementsQuery(session.userId, activity.activityId, expanded && !offline);
  const current = aggregate.currentSettlement;
  const expenseId = aggregate.expense.expenseId;
  const records = (offline ? snapshot?.snapshot.settlements : query.data) ?? [];
  const related = records.filter(record => record.scopeExpenseIds?.includes(expenseId)
    || record.allocations?.some(item => item.expenseId === expenseId)
    || record.applications?.some(item => item.expenseId === expenseId)
    || aggregate.clearings?.some(item => item.settlementId === record.settlementId));
  const offsets = aggregate.clearings?.filter(item => item.kind === "OFFSET") ?? [];
  const status = current ? currentSettlementLabel(aggregate) : "待同步";
  return <section className={`current-settlement${collapsible ? " current-settlement--collapsible" : ""}`} aria-labelledby={`${sectionId}-heading`}>
    {collapsible ? <h2 className="current-settlement__heading">
      <button className="current-settlement__disclosure current-settlement__toggle" type="button" aria-expanded={expanded} aria-controls={`${sectionId}-content`} onClick={() => setExpanded(value => !value)}>
        <span id={`${sectionId}-heading`}>本单结算</span><span className="current-settlement__status">{status}</span><ChevronDown aria-hidden="true" size={16} />
      </button>
    </h2> : <header className="current-settlement__header">
      <h2 id={`${sectionId}-heading`}>当前结算</h2>
      <span className="current-settlement__status">{status}</span>
    </header>}
    <div id={`${sectionId}-content`} className="current-settlement__content" hidden={collapsible && !expanded}>
      {collapsible ? <p className="current-settlement__hint">按已保存账单计算</p> : null}
      {current ? <ul className="current-settlement__members" aria-label="账单成员当前余额">
        {current.members.map(member => {
          const net = BigInt(member.netMinor);
          const name = memberName(member.memberId, members);
          return <li className="current-settlement__row" key={member.memberId}>
            <span className="current-settlement__member"><MemberAvatar memberId={member.memberId} {...memberAvatarImage(member.memberId, members)} displayName={name} avatarPreset={memberAvatarPreset(member.memberId, members)} size="sm" /><span>{name}{member.memberId === activity.currentMemberId ? "（我）" : ""}</span></span>
            <span className={`current-settlement__balance${net === 0n ? " current-settlement__balance--settled" : ""}`}>{net === 0n ? "已结清" : <>{net < 0n ? "待付" : "待收"} <Money value={formatMoney(current.currency, (net < 0n ? -net : net).toString())} /></>}</span>
          </li>;
        })}
      </ul> : <p className="current-settlement__hint">当前结算信息待同步</p>}
      <div id={`${sectionId}-details`} hidden={!expanded} className="current-settlement__details">
        <h3>收付款记录</h3>
        {!offline && query.error ? <ErrorNotice error={query.error} /> : !offline && query.isPending ? <LoadingState label="正在读取收付款记录…" /> : related.length ? <ul className="current-settlement__records">
          {related.map(record => {
            const allocation = record.allocations?.find(item => item.expenseId === expenseId);
            const applied = record.applications?.some(item => item.expenseId === expenseId)
              || aggregate.clearings?.some(item => item.settlementId === record.settlementId);
            const scope = allocation ? `本账单归属 ${formatMoney(record.currency, allocation.amountMinor)}`
              : applied ? "清偿涉及本账单"
                : record.scopeExpenseIds.length === 1 ? "结算范围：本账单" : `结算范围包含本账单 · 共 ${record.scopeExpenseIds.length} 笔`;
            return <li key={record.settlementId}>
              <div className="current-settlement__record-heading"><span>{memberName(record.payerMemberId, members)} → {memberName(record.receiverMemberId, members)}</span><Money value={formatMoney(record.currency, record.amountMinor)} /></div>
              <small><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}</time> · {record.status === "VOID" ? "已作废，不计入余额" : "已记录"}</small>
              <small>{scope} · 转账金额为整笔记录</small>
            </li>;
          })}
        </ul> : <p className="current-settlement__hint">暂无关联收付款记录</p>}
        {offsets.length ? <><h3>抵销记录</h3><ul className="current-settlement__records">{offsets.map((entry, index) => <li key={`${entry.memberId}-${entry.offsetExpenseId}-${index}`}>
          <div className="current-settlement__record-heading"><span>{memberName(entry.memberId, members)} · 与「{entry.offsetExpenseTitle ?? "其他账单"}」抵销</span><Money value={formatMoney(aggregate.expense.baseCurrency, entry.amountMinor)} /></div>
          <small>本账单成员抵销金额{entry.origin === "HISTORICAL_AUTO" ? " · 历史自动对账" : ""}</small>
        </li>)}</ul></> : null}
      </div>
      {!collapsible ? <button className="current-settlement__disclosure" type="button" aria-expanded={expanded} aria-controls={`${sectionId}-details`} onClick={() => setExpanded(value => !value)}>{expanded ? "收起收付款明细" : "查看收付款明细"}<ChevronDown aria-hidden="true" size={16} /></button> : null}
    </div>
  </section>;
}
