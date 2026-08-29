import {
  HeartIcon,
  LandmarkIcon,
  LeafIcon,
  SendIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";

import type { ShareSummaryData, ShareSummaryStatus } from "../types";

import {
  ShareMemberAvatar,
  ShareMoneyAmount,
  ShareSectionCard,
  ShareStatusText,
} from "./share-summary-primitives";

export function ShareSummaryTitleBlock({
  activityName,
  memberCount,
  currency,
  totalAmountMinor,
}: Pick<
  ShareSummaryData,
  "activityName" | "memberCount" | "currency" | "totalAmountMinor"
>) {
  return (
    <header className="flex items-center gap-5 px-1">
      <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-[#DDF2E8] text-[#146B52]">
        <LandmarkIcon aria-hidden="true" className="size-10 stroke-[1.6]" />
      </span>
      <div className="min-w-0">
        <p className="text-[17px] font-bold tracking-[0.16em] text-[#16745B]">
          结算摘要
        </p>
        <h1 className="mt-1 truncate text-[44px] font-bold leading-tight tracking-[-0.045em] text-[#173C30]">
          {activityName}
        </h1>
        <p className="mt-2 text-[21px] font-medium text-[#52665D]">
          {memberCount}人 · 总支出{" "}
          <ShareMoneyAmount
            currency={currency}
            amountMinor={totalAmountMinor}
            className="text-[21px] font-semibold"
          />
        </p>
      </div>
    </header>
  );
}

/** 当前查看者的净额使用最大字号，先给出群成员最关心的个人结论。 */
export function ViewerSettlementCard({
  currency,
  status,
  amountMinor,
}: {
  readonly currency: string;
  readonly status: ShareSummaryStatus;
  readonly amountMinor: bigint;
}) {
  return (
    <section
      aria-labelledby="share-viewer-settlement"
      className="grid grid-cols-[1fr_auto] items-center gap-6 rounded-[28px] border border-[#BFDCCF] bg-[#F4FBF7] px-8 py-6"
    >
      <div className="flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-[#5DC0A7] text-white">
          <UserRoundIcon aria-hidden="true" className="size-7" />
        </span>
        <h2
          id="share-viewer-settlement"
          className="text-[25px] font-bold text-[#146B52]"
        >
          我的结算
        </h2>
      </div>
      <p className="flex items-baseline gap-4">
        <ShareStatusText status={status} />
        <ShareMoneyAmount
          currency={currency}
          amountMinor={amountMinor}
          status={status}
          className="text-[54px] font-bold leading-none tracking-[-0.04em]"
        />
      </p>
    </section>
  );
}

function RecommendationRow({
  fromName,
  toName,
  amountMinor,
  currency,
  index,
}: {
  readonly fromName: string;
  readonly toName: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly index: number;
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border border-[#F4DDB7] bg-white px-4 py-3.5">
      <ShareMemberAvatar name={fromName} index={index + 1} />
      <p className="min-w-0 text-[21px] font-medium text-[#263C32]">
        <span>{fromName} 向 </span>
        <span className="font-bold text-[#146B52]">{toName}</span>
        <span> 支付</span>
      </p>
      <ShareMoneyAmount
        currency={currency}
        amountMinor={amountMinor}
        status="payable"
        className="text-[28px] font-bold"
      />
    </li>
  );
}

/** 推荐区始终用日常语言组织付款方向，不暴露借贷或账务字段。 */
export function RecommendedSettlementCard({
  currency,
  recommendations,
}: Pick<ShareSummaryData, "currency" | "recommendations">) {
  return (
    <ShareSectionCard className="border-[#F5DEB6] bg-[#FFF9EE]">
      <div className="flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-[#FFB54D] text-white">
          <SendIcon aria-hidden="true" className="size-7" />
        </span>
        <h2
          id="share-recommendations"
          className="text-[25px] font-bold text-[#6E4310]"
        >
          推荐结算
        </h2>
      </div>
      <ul
        aria-labelledby="share-recommendations"
        aria-label="推荐结算"
        className="mt-5 space-y-2"
      >
        {recommendations.map((recommendation, index) => (
          <RecommendationRow
            key={`${recommendation.fromName}-${recommendation.toName}-${recommendation.amountMinor}`}
            {...recommendation}
            currency={currency}
            index={index}
          />
        ))}
      </ul>
      <p className="mt-5 flex items-center justify-center gap-2 text-[18px] font-medium text-[#765126]">
        <span aria-hidden="true">✦</span>
        按以上转账即可完成本次结算
      </p>
    </ShareSectionCard>
  );
}

function MemberBalanceRow({
  memberName,
  status,
  amountMinor,
  currency,
  index,
}: {
  readonly memberName: string;
  readonly status: ShareSummaryStatus;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly index: number;
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 py-3">
      <ShareMemberAvatar
        name={memberName}
        index={index}
        className="size-10 text-sm"
      />
      <span className="min-w-0 truncate text-[20px] font-semibold text-[#263C32]">
        {memberName}
      </span>
      <ShareStatusText status={status} />
      <ShareMoneyAmount
        currency={currency}
        amountMinor={amountMinor}
        status={status}
        className="min-w-[106px] text-right text-[23px] font-bold"
      />
    </li>
  );
}

/** 余额区用于核对推荐方案，层级弱于推荐转账但保持逐人可读。 */
export function MemberBalanceCard({
  currency,
  balances,
}: Pick<ShareSummaryData, "currency" | "balances">) {
  return (
    <ShareSectionCard>
      <div className="flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-[#5DC0A7] text-white">
          <UsersRoundIcon aria-hidden="true" className="size-7" />
        </span>
        <h2
          id="share-member-balances"
          className="text-[25px] font-bold text-[#146B52]"
        >
          成员余额
        </h2>
      </div>
      <ul
        aria-labelledby="share-member-balances"
        aria-label="成员余额"
        className="mt-4 divide-y divide-[#E6EEE9]"
      >
        {balances.map((balance, index) => (
          <MemberBalanceRow
            key={balance.memberName}
            {...balance}
            currency={currency}
            index={index}
          />
        ))}
      </ul>
    </ShareSectionCard>
  );
}

export function ShareSummaryNotes() {
  return (
    <section
      aria-label="结算说明"
      className="flex items-center gap-4 rounded-[28px] border border-[#D7E8DD] bg-[#F6FBF7] px-8 py-6"
    >
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[#DDF2E8] text-[#217A55]">
        <LeafIcon aria-hidden="true" className="size-7" />
      </span>
      <p className="text-[19px] leading-8 text-[#395747]">
        金额已根据活动账单自动计算
        <br />
        推荐结算已尽量减少转账次数
      </p>
    </section>
  );
}

export function ShareSummaryBrandFooter() {
  return (
    <footer className="flex items-end justify-between px-2 pt-1">
      <div className="flex items-center gap-4">
        <span className="flex size-[72px] items-center justify-center rounded-[22px] bg-[#146B52] text-[25px] font-bold text-white shadow-[0_8px_16px_rgb(20_107_82/16%)]">
          伙记
        </span>
        <div>
          <p className="text-[30px] font-bold tracking-[-0.035em] text-[#146B52]">
            伙记 <span className="font-amount">HuddleTab</span>
          </p>
          <p className="mt-1 text-[19px] tracking-[0.12em] text-[#52665D]">
            一起消费，清楚结算
          </p>
        </div>
      </div>
      <HeartIcon
        aria-hidden="true"
        className="mb-1 size-9 fill-[#FFB54D] text-[#FFB54D]"
      />
    </footer>
  );
}
