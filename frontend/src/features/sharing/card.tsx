import { Fragment } from 'react';
import { formatMoney } from '../../domain-preview/money';
import type { ShareSummary } from './adapter';
import { summaryItems, type SummaryItem } from './pagination';

const labels = { receivable: '应收', payable: '应付', settled: '已结清' };
/** 预览、测量和导出使用同一张卡；固定浅色保证群聊截图不受应用主题影响。 */
export function ShareSummaryCard({ summary, id = 'share-summary-preview-card', items = summaryItems(summary), page = 1, pageCount = 1 }: { summary: ShareSummary; id?: string; items?: readonly SummaryItem[]; page?: number; pageCount?: number }) {
  return <article id={id} className="share-summary-card" aria-label={`${summary.activityName}结算摘要`}>
    <header className="share-card-heading"><p>结算摘要 <span>{summary.currency}</span></p><h2>{summary.activityName}</h2><small>{summary.startDate}{summary.endDate && summary.endDate !== summary.startDate ? ` — ${summary.endDate}` : ''} · {summary.memberCount}人 · {summary.expenseCount}笔账单</small>
      <div className="share-card-stats"><span>总支出 <strong>{formatMoney(summary.currency, summary.totalExpenseMinor)}</strong></span><span>人均 <strong>{formatMoney(summary.currency, summary.averageExpenseMinor)}</strong></span></div>
    </header>
    <div className="share-card-body">
      {!summary.recommendations.length ? <p className="share-card-empty">{summary.state === 'zero' ? '当前总消费为零，无需转账' : summary.state === 'settled' ? '全部已结清，无需转账' : '当前暂无推荐转账'}</p> : null}
      {items.map((item, position) => <Fragment key={item.key}>
        {items[position - 1]?.kind !== item.kind ? <h3 className="share-card-section-heading">{item.kind === 'transfer' ? '推荐转账' : '成员余额'}</h3> : null}
        {item.kind === 'transfer' ? <div className="share-card-row share-card-row--transfer" data-summary-row={item.key}><span>{summary.recommendations[item.index].payerName}<span className="share-card-direction"> → </span>{summary.recommendations[item.index].receiverName}</span><strong>{formatMoney(summary.currency, summary.recommendations[item.index].amountMinor)}</strong></div> : <div className="share-card-row" data-summary-row={item.key}><span>{summary.balances[item.index].displayName}</span><small data-balance-state={summary.balances[item.index].state}>{labels[summary.balances[item.index].state]}</small><strong>{formatMoney(summary.currency, summary.balances[item.index].amountMinor)}</strong></div>}
      </Fragment>)}
      {!summary.balances.length ? <p className="share-card-empty">暂无成员余额</p> : null}
    </div>
    <footer className="share-card-footer"><span>伙记 · HuddleTab</span><span>第 {page} / {pageCount} 页</span></footer>
  </article>;
}
