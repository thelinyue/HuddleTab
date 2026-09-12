import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { unwrap } from "../../api/error";
import type { Activity } from "../activities/api";
import type { ExpenseAggregate } from "../accounting/api";
import type { ActivityMember } from "../activities/api";
import { queryKeys } from "../../api/query-keys";

export type ReceiptData = { activity: Activity; members: ActivityMember[]; expenses: ExpenseAggregate[] };

async function loadReceipt(activityId: string): Promise<ReceiptData> {
  const [activity, members, expenses] = await Promise.all([
    apiClient.GET("/api/activities/{activity_id}", { params: { path: { activity_id: activityId } } }),
    apiClient.GET("/api/activities/{activity_id}/members", { params: { path: { activity_id: activityId } } }),
    apiClient.GET("/api/activities/{activity_id}/expenses", { params: { path: { activity_id: activityId } } }),
  ]);
  return { activity: unwrap(activity).data, members: unwrap(members).data, expenses: unwrap(expenses).data };
}

export function useReceiptDataQuery(userId: string, activityId: string) {
  return useQuery({ queryKey: [...queryKeys.expenses(userId, activityId), "receipt"], queryFn: () => loadReceipt(activityId), enabled: Boolean(userId && activityId) });
}

export function receiptDate(value: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(new Date(value));
}

export function receiptTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
