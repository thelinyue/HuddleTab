import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { unwrap } from "../../api/error";
import type { Activity } from "../activities/api";
import type { ExpenseAggregate } from "../accounting/api";
import type { ActivityMember } from "../activities/api";
import { queryKeys } from "../../api/query-keys";
import { calendarDayDifference } from "../../lib/calendar-date";

export type ReceiptData = { activity: Activity; members: ActivityMember[]; expenses: ExpenseAggregate[] };
export type ReceiptDateGroup = { date: string; dayNumber: number | null; expenses: ExpenseAggregate[] };

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

/** 将选中的流水按活动日期分组，导出和预览共用同一份稳定顺序的数据。 */
export function groupReceiptExpenses(expenses: readonly ExpenseAggregate[], selectedDates: readonly string[], activityStartDate: string): ReceiptDateGroup[] {
  const selected = new Set(selectedDates);
  const groups = new Map<string, ExpenseAggregate[]>();
  for (const item of expenses) {
    const date = receiptDate(item.expense.occurredAt);
    if (!selected.has(date)) continue;
    const group = groups.get(date) ?? [];
    group.push(item);
    groups.set(date, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, groupedExpenses]) => ({
      date,
      dayNumber: calendarDayDifference(activityStartDate, date),
      expenses: groupedExpenses,
    }));
}

export function receiptDayLabel(group: Pick<ReceiptDateGroup, "date" | "dayNumber">): string {
  return group.dayNumber !== null && group.dayNumber >= 0 ? `第 ${group.dayNumber + 1} 天 · ${group.date}` : group.date;
}
