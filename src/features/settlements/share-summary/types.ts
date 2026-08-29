/** 分享卡只承载结算结论；金额使用最小货币单位，避免展示层重新引入浮点数误差。 */
export type ShareSummaryStatus = "receivable" | "payable" | "settled";

export interface ShareSummaryData {
  readonly activityName: string;
  readonly memberCount: number;
  readonly currency: string;
  readonly totalAmountMinor: bigint;
  readonly viewerSummary: {
    readonly status: ShareSummaryStatus;
    readonly amountMinor: bigint;
  };
  readonly recommendations: readonly {
    readonly fromName: string;
    readonly toName: string;
    readonly amountMinor: bigint;
  }[];
  readonly balances: readonly {
    readonly memberName: string;
    readonly status: ShareSummaryStatus;
    readonly amountMinor: bigint;
  }[];
}
