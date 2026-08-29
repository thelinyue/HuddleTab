import type { ShareSummaryData, ShareSummaryStatus } from "./types";

/**
 * 分享卡只读取活动摘要 API 中已经经过服务端授权的字段。
 * 金额在浏览器边界立即恢复为 bigint，避免分享展示再次经过浮点数。
 */
interface ActivitySummaryPayload {
  readonly activityName: string;
  readonly memberCount: number;
  readonly totalExpenseMinor: string;
  readonly currency: string;
  readonly currentUserBalanceMinor: string;
  readonly balances: readonly {
    readonly memberId: string;
    readonly displayName: string;
    readonly netMinor: string;
  }[];
  readonly recommendations: readonly {
    readonly payerMemberId: string;
    readonly receiverMemberId: string;
    readonly amountMinor: string;
  }[];
}

function statusFor(amountMinor: bigint): ShareSummaryStatus {
  if (amountMinor > 0n) return "receivable";
  if (amountMinor < 0n) return "payable";
  return "settled";
}

function absoluteAmount(amountMinor: bigint) {
  return amountMinor < 0n ? -amountMinor : amountMinor;
}

/** 将服务端的有符号净额转换为分享卡使用的状态和非负展示金额。 */
export function toShareSummaryData(
  summary: ActivitySummaryPayload,
): ShareSummaryData {
  const displayNameByMemberId = new Map(
    summary.balances.map((balance) => [balance.memberId, balance.displayName]),
  );
  const memberName = (memberId: string) =>
    displayNameByMemberId.get(memberId) || "成员";
  const viewerBalanceMinor = BigInt(summary.currentUserBalanceMinor);

  return {
    activityName: summary.activityName,
    memberCount: summary.memberCount,
    currency: summary.currency,
    totalAmountMinor: BigInt(summary.totalExpenseMinor),
    viewerSummary: {
      status: statusFor(viewerBalanceMinor),
      amountMinor: absoluteAmount(viewerBalanceMinor),
    },
    recommendations: summary.recommendations.map((recommendation) => ({
      fromName: memberName(recommendation.payerMemberId),
      toName: memberName(recommendation.receiverMemberId),
      amountMinor: BigInt(recommendation.amountMinor),
    })),
    balances: summary.balances.map((balance) => {
      const netMinor = BigInt(balance.netMinor);
      return {
        memberName: balance.displayName || "成员",
        status: statusFor(netMinor),
        amountMinor: absoluteAmount(netMinor),
      };
    }),
  };
}

/** 通过现有摘要接口取得当前成员可见的实时结算快照。 */
export async function getShareSummary(
  activityId: string,
): Promise<ShareSummaryData> {
  const response = await fetch(
    `/api/activities/${encodeURIComponent(activityId)}/summary`,
    { cache: "no-store" },
  );
  const body = (await response.json()) as {
    readonly data?: ActivitySummaryPayload;
    readonly error?: { readonly message?: string };
  };

  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? "结算摘要加载失败，请稍后重试。");
  }

  return toShareSummaryData(body.data);
}
