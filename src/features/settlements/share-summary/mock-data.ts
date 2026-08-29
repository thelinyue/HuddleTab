import type { ShareSummaryData } from "./types";

/** 首版路由使用固定样例校准视觉；后续由已授权的活动数据适配器替换，不改动卡片契约。 */
export const mockShareSummaryData: ShareSummaryData = {
  activityName: "北京之旅",
  memberCount: 5,
  currency: "CNY",
  totalAmountMinor: 12200n,
  viewerSummary: {
    status: "receivable",
    amountMinor: 8660n,
  },
  recommendations: [
    { fromName: "VV", toName: "林樾", amountMinor: 3780n },
    { fromName: "B", toName: "林樾", amountMinor: 2440n },
    { fromName: "A", toName: "林樾", amountMinor: 2440n },
  ],
  balances: [
    { memberName: "C", status: "settled", amountMinor: 0n },
    { memberName: "VV", status: "payable", amountMinor: 3780n },
    { memberName: "B", status: "payable", amountMinor: 2440n },
    { memberName: "林樾", status: "receivable", amountMinor: 8660n },
    { memberName: "A", status: "payable", amountMinor: 2440n },
  ],
};
