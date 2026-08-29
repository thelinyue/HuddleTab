import type { ShareSummaryData } from "../types";

import { ShareSummaryHeaderIllustration } from "./share-summary-cover";
import {
  MemberBalanceCard,
  RecommendedSettlementCard,
  ShareSummaryBrandFooter,
  ShareSummaryNotes,
  ShareSummaryTitleBlock,
  ViewerSettlementCard,
} from "./share-summary-sections";

const defaultCoverSrc = "/share/settlement-cover-beijing.png";

/**
 * 分享卡是刻意独立于产品壳的静态展示面：所有影响导出结果的数据均由 props 明确给出，
 * 根节点不包含导航、动画或网络请求，供未来 PNG 生成器直接捕获。
 */
export function ShareSummaryCard({
  data,
  coverSrc = defaultCoverSrc,
}: {
  readonly data: ShareSummaryData;
  readonly coverSrc?: string;
}) {
  return (
    <article
      id="share-summary-card"
      className="w-[800px] shrink-0 overflow-hidden rounded-[40px] border border-[#E3E9E3] bg-[#FFFDF8] text-[#17211D] shadow-[0_18px_50px_rgb(23_60_48/12%)]"
    >
      <ShareSummaryHeaderIllustration src={coverSrc} />
      <div className="space-y-6 px-9 pb-9 pt-8">
        <ShareSummaryTitleBlock
          activityName={data.activityName}
          memberCount={data.memberCount}
          currency={data.currency}
          totalAmountMinor={data.totalAmountMinor}
        />
        <ViewerSettlementCard
          currency={data.currency}
          status={data.viewerSummary.status}
          amountMinor={data.viewerSummary.amountMinor}
        />
        <RecommendedSettlementCard
          currency={data.currency}
          recommendations={data.recommendations}
        />
        <MemberBalanceCard currency={data.currency} balances={data.balances} />
        <ShareSummaryNotes />
        <ShareSummaryBrandFooter />
      </div>
    </article>
  );
}
