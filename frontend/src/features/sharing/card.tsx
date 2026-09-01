import { ArrowRight, CheckCircle2, ReceiptText, UsersRound } from "lucide-react";
import { Money } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import type { ShareSummary } from "./adapter";

export function ShareSummaryCard({ summary, id }: { summary: ShareSummary; id?: string }) {
  return (
    <article id={id} className="share-summary-card" data-state={summary.state} aria-label={`${summary.activityName}结算摘要`}>
      <img className="share-summary-card__cover" src="/share/settlement-cover-beijing.png" width={800} height={280} alt="" />
      <div className="share-summary-card__content">
        <header>
          <p className="eyebrow">HuddleTab 结算摘要</p>
          <h2>{summary.activityName}</h2>
          <p>{summary.memberCount} 位成员 · 总消费 {formatMoney(summary.currency, summary.totalExpenseMinor)}</p>
        </header>
        {summary.state === "empty" ? <div className="share-summary-card__state"><ReceiptText aria-hidden="true" size={22} /><div><strong>还没有账单</strong><p>录入账单后可生成结算建议。</p></div></div> : null}
        {summary.state === "settled" ? <div className="share-summary-card__state"><CheckCircle2 aria-hidden="true" size={22} /><div><strong>全部已结清</strong><p>当前没有待处理的转账。</p></div></div> : null}
        {summary.state === "ready" ? <section className="share-summary-card__recommendations" aria-labelledby={`${id ?? "share"}-recommendations`}><h3 id={`${id ?? "share"}-recommendations`}>推荐转账</h3>{summary.recommendations.map((item, index) => <div className="share-transfer" key={`${item.payerName}-${item.receiverName}-${index}`}><span><strong>{item.payerName}</strong><ArrowRight aria-hidden="true" size={16} /><strong>{item.receiverName}</strong></span><Money value={formatMoney(summary.currency, item.amountMinor)} /></div>)}</section> : null}
        <section className="share-summary-card__balances" aria-labelledby={`${id ?? "share"}-balances`}><h3 id={`${id ?? "share"}-balances`}><UsersRound aria-hidden="true" size={17} />成员余额</h3>{summary.balances.map((balance) => <div className="share-balance" key={balance.memberId}><strong>{balance.displayName}</strong><span>{balance.state === "receivable" ? "应收" : balance.state === "payable" ? "应付" : "已结清"}{balance.state !== "settled" ? <Money value={formatMoney(summary.currency, balance.amountMinor)} tone={balance.state === "receivable" ? "positive" : "negative"} /> : null}</span></div>)}</section>
      </div>
    </article>
  );
}
