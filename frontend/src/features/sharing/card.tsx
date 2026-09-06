import { Heart, Landmark, Leaf, Send, Sparkles, UserRound, UsersRound } from "lucide-react";
import { formatMoney } from "../../domain-preview/money";
import type { BalanceState, ShareSummary } from "./adapter";

const statusLabels: Record<BalanceState, string> = {
  receivable: "应收",
  payable: "应付",
  settled: "已结清",
};

function viewerSettlement(summary: ShareSummary) {
  const amount = BigInt(summary.currentUserBalanceMinor);
  return {
    amountMinor: (amount < 0n ? -amount : amount).toString(),
    state: amount > 0n ? "receivable" as const : amount < 0n ? "payable" as const : "settled" as const,
  };
}

function ShareMoney({ currency, amountMinor, state }: { currency: string; amountMinor: string; state?: BalanceState }) {
  return <span className="share-summary-money" data-share-money-state={state}>{formatMoney(currency, amountMinor)}</span>;
}

/** 纯文字头像不依赖远程资源，避免 PNG 捕获时出现头像空白。 */
function ShareAvatar({ name, index }: { name: string; index: number }) {
  return <span className="share-summary-avatar" data-avatar-tone={index % 5} aria-hidden="true">{name.trim().slice(0, 2) || "友"}</span>;
}

/**
 * 分享卡保持 v0.0.2 的固定浅色画布和信息层级，避免跟随应用主题改变导出结果。
 * DOM ID 由调用方提供，使页面预览与离屏导出可以同时存在而不产生重复关联。
 */
export function ShareSummaryCard({ summary, id = "share-summary-preview-card" }: { summary: ShareSummary; id?: string }) {
  const viewer = viewerSettlement(summary);
  const recommendationHeadingId = `${id}-recommendations`;
  const balanceHeadingId = `${id}-balances`;
  const viewerHeadingId = `${id}-viewer`;
  return (
    <article id={id} className="share-summary-card" data-state={summary.state} aria-label={`${summary.activityName}结算摘要`}>
      <img className="share-summary-card__cover" src="/share/settlement-cover-beijing.png" width={800} height={400} alt="" />
      <div className="share-summary-card__content">
        <header className="share-summary-title">
          <span className="share-summary-title__icon"><Landmark aria-hidden="true" size={40} strokeWidth={1.6} /></span>
          <div>
            <p className="share-summary-eyebrow">结算摘要</p>
            <h2>{summary.activityName}</h2>
            <p>{summary.memberCount}人 · 总支出 <ShareMoney currency={summary.currency} amountMinor={summary.totalExpenseMinor} /></p>
          </div>
        </header>

        <section className="share-summary-viewer" aria-labelledby={viewerHeadingId}>
          <div className="share-summary-section-heading">
            <span className="share-summary-section-icon share-summary-section-icon--mint"><UserRound aria-hidden="true" size={28} /></span>
            <h3 id={viewerHeadingId}>我的结算</h3>
          </div>
          <p className="share-summary-viewer__amount" data-share-state={viewer.state}>
            <strong>{statusLabels[viewer.state]}</strong>
            <ShareMoney currency={summary.currency} amountMinor={viewer.amountMinor} state={viewer.state} />
          </p>
        </section>

        <section className="share-summary-section share-summary-section--recommendations" aria-labelledby={recommendationHeadingId}>
          <div className="share-summary-section-heading">
            <span className="share-summary-section-icon share-summary-section-icon--orange"><Send aria-hidden="true" size={28} /></span>
            <h3 id={recommendationHeadingId}>推荐结算</h3>
          </div>
          <ul className="share-summary-recommendations" aria-label="推荐结算">
            {summary.recommendations.length ? summary.recommendations.map((item, index) => (
              <li key={`${item.payerName}-${item.receiverName}-${item.amountMinor}-${index}`}>
                <ShareAvatar name={item.payerName} index={index + 1} />
                <p><span>{item.payerName} 向 </span><strong>{item.receiverName}</strong><span> 支付</span></p>
                <ShareMoney currency={summary.currency} amountMinor={item.amountMinor} state="payable" />
              </li>
            )) : <li className="share-summary-empty">{summary.state === "zero" ? "当前总消费为零，无需转账" : "当前无需推荐转账"}</li>}
          </ul>
          <p className="share-summary-recommendation-note"><Sparkles aria-hidden="true" size={18} />{summary.recommendations.length ? "按以上转账即可完成本次结算" : "当前无需转账"}</p>
        </section>

        <section className="share-summary-section" aria-labelledby={balanceHeadingId}>
          <div className="share-summary-section-heading">
            <span className="share-summary-section-icon share-summary-section-icon--mint"><UsersRound aria-hidden="true" size={28} /></span>
            <h3 id={balanceHeadingId}>成员余额</h3>
          </div>
          <ul className="share-summary-balances" aria-label="成员余额">
            {summary.balances.length ? summary.balances.map((balance, index) => (
              <li key={balance.memberId}>
                <ShareAvatar name={balance.displayName} index={index} />
                <strong>{balance.displayName}</strong>
                <span className="share-summary-status" data-share-state={balance.state}>{statusLabels[balance.state]}</span>
                <ShareMoney currency={summary.currency} amountMinor={balance.amountMinor} state={balance.state} />
              </li>
            )) : <li className="share-summary-empty">暂无成员余额</li>}
          </ul>
        </section>

        <section className="share-summary-notes" aria-label="结算说明">
          <span className="share-summary-section-icon share-summary-section-icon--soft"><Leaf aria-hidden="true" size={28} /></span>
          <p>金额已根据活动账单自动计算<br />推荐结算已尽量减少转账次数</p>
        </section>

        <footer className="share-summary-brand">
          <div><span className="share-summary-brand__mark">伙记</span><div><p>伙记 <span>HuddleTab</span></p><small>一起消费，清楚结算</small></div></div>
          <Heart aria-hidden="true" size={36} fill="currentColor" />
        </footer>
      </div>
    </article>
  );
}
