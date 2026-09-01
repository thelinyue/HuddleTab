import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

type ActivitySummaryData = components["schemas"]["ActivitySummaryData"];

export type BalanceState = "payable" | "receivable" | "settled";
export type SummaryState = "zero" | "settled" | "ready";

export type ShareSummary = {
  activityName: string;
  balances: Array<{ amountMinor: string; displayName: string; memberId: string; state: BalanceState }>;
  currency: string;
  currentUserBalanceMinor: string;
  memberCount: number;
  recommendations: Array<{ amountMinor: string; payerName: string; receiverName: string }>;
  state: SummaryState;
  totalExpenseMinor: string;
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
  };
}

async function getActivitySummary(activityId: string): Promise<ShareSummary> {
  const envelope = unwrap(await apiClient.GET("/api/activities/{activity_id}/summary", {
    params: { path: { activity_id: activityId } },
  }));
  return mapActivitySummary(envelope.data);
}

export function useActivitySummaryQuery(userId: string, activityId: string) {
  return useQuery({
    queryKey: queryKeys.activitySummary(userId, activityId),
    queryFn: () => getActivitySummary(activityId),
    enabled: userId.length > 0 && activityId.length > 0,
  });
}
