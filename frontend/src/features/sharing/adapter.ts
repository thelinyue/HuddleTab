import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";
import type { RecommendationSelection } from "../accounting/api";

type ActivitySummaryData = components["schemas"]["ActivitySummaryData"];

export type BalanceState = "payable" | "receivable" | "settled";
export type SummaryState = "zero" | "settled" | "ready";

export type ShareSummary = {
  activityName: string;
  startDate: string;
  endDate: string | null;
  expenseCount: number;
  participatingMemberCount: number;
  averageExpenseMinor: string;
  originalCurrencyTotals: Array<{ currency: string; amountMinor: string }>;
  categoryTotals: Array<{ category: string; amountMinor: string }>;
  balances: Array<{ amountMinor: string; displayName: string; memberId: string; state: BalanceState }>;
  currency: string;
  currentUserBalanceMinor: string;
  memberCount: number;
  recommendations: Array<{ amountMinor: string; payerName: string; receiverName: string }>;
  state: SummaryState;
  totalExpenseMinor: string;
  effectiveStrategy: "MIN_TRANSFERS" | "CENTRALIZED";
  hubMemberId: string | null;
  hubName: string | null;
};

/** 将 Rust 权威账本摘要转为纯展示模型，组件不接触 OpenAPI DTO 或成员 ID 反查。 */
export function mapActivitySummary(data: ActivitySummaryData): ShareSummary {
  const names = new Map(data.balances.map((balance) => [balance.memberId, balance.displayName]));
  const balances: ShareSummary["balances"] = data.balances.map((balance) => {
    const amount = BigInt(balance.netMinor);
    return {
      amountMinor: (amount < 0n ? -amount : amount).toString(),
      displayName: balance.displayName,
      memberId: balance.memberId,
      state: amount > 0n ? "receivable" : amount < 0n ? "payable" : "settled",
    };
  });
  const totalExpense = BigInt(data.totalExpenseMinor);
  return {
    activityName: data.activityName,
    startDate: data.startDate,
    endDate: data.endDate ?? null,
    expenseCount: data.expenseCount,
    participatingMemberCount: data.participatingMemberCount,
    averageExpenseMinor: data.averageExpenseMinor,
    originalCurrencyTotals: data.originalCurrencyTotals.map((item) => ({ currency: item.currency, amountMinor: item.amountMinor })),
    categoryTotals: data.categoryTotals.map((item) => ({ category: item.category, amountMinor: item.amountMinor })),
    balances,
    currency: data.currency,
    currentUserBalanceMinor: data.currentUserBalanceMinor,
    memberCount: data.memberCount,
    recommendations: data.recommendations.map((recommendation) => ({
      amountMinor: recommendation.amountMinor,
      payerName: names.get(recommendation.payerMemberId) ?? "未知成员",
      receiverName: names.get(recommendation.receiverMemberId) ?? "未知成员",
    })),
    state: totalExpense === 0n ? "zero" : data.recommendations.length === 0 && balances.every((balance) => balance.state === "settled") ? "settled" : "ready",
    totalExpenseMinor: data.totalExpenseMinor,
    effectiveStrategy: data.effectiveStrategy === "CENTRALIZED" ? "CENTRALIZED" : "MIN_TRANSFERS",
    hubMemberId: data.hubMemberId ?? null,
    hubName: data.hubMemberId ? names.get(data.hubMemberId) ?? "未知成员" : null,
  };
}

async function getActivitySummary(activityId: string, selection: RecommendationSelection = {}): Promise<ShareSummary> {
  const envelope = unwrap(await apiClient.GET("/api/activities/{activity_id}/summary", {
    params: {
      path: { activity_id: activityId },
      query: {
        strategy: selection.strategy,
        hubMemberId: selection.hubMemberId,
      },
    },
  }));
  return mapActivitySummary(envelope.data);
}

export function useActivitySummaryQuery(
  userId: string,
  activityId: string,
  selection: RecommendationSelection = {},
) {
  return useQuery({
    queryKey: queryKeys.activitySummary(userId, activityId, selection.strategy, selection.hubMemberId),
    queryFn: () => getActivitySummary(activityId, selection),
    enabled: userId.length > 0 && activityId.length > 0,
  });
}
