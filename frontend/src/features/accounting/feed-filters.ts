import { calendarDayDifference } from "../../lib/calendar-date";
import type { ExpenseAggregate, ExpenseDraft } from "./api";

/** 同一维度取并集，不同维度取交集；仅选择流水，不改变任何账务事实或汇总。 */
export type FeedFilters = {
  categories: string[];
  from: string;
  to: string;
  payerIds: string[];
  participantIds: string[];
};

export function emptyFeedFilters(): FeedFilters {
  return { categories: [], from: "", to: "", payerIds: [], participantIds: [] };
}

export function feedFilterCount(filters: FeedFilters): number {
  return [filters.categories.length > 0, Boolean(filters.from || filters.to), filters.payerIds.length > 0, filters.participantIds.length > 0].filter(Boolean).length;
}

export function feedDateError(from: string, to: string): string | undefined {
  if (!from && !to) return undefined;
  if (!from || !to) return "请选择完整的开始和结束日期。";
  const days = calendarDayDifference(from, to);
  if (days === null) return "请选择有效日期。";
  if (days < 0) return "结束日期不能早于开始日期。";
  return undefined;
}

export function feedCalendarDate(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** 已同步账单读 payments/shares；离线草稿读实际分摊模式对应的成员，二者共用匹配口径。 */
export function matchesFeedExpense(item: ExpenseAggregate | ExpenseDraft, filters: FeedFilters, query: string, timeZone: string): boolean {
  const saved = "expense" in item;
  const expense = saved ? item.expense : item;
  const keyword = query.trim().toLocaleLowerCase();
  if (keyword && !`${expense.title} ${expense.note ?? ""}`.toLocaleLowerCase().includes(keyword)) return false;
  if (filters.categories.length && !filters.categories.includes(expense.category)) return false;
  if (filters.from || filters.to) {
    const date = feedCalendarDate(expense.occurredAt, timeZone);
    if (date < filters.from || date > filters.to) return false;
  }
  if (filters.payerIds.length && !item.payments.some(payment => filters.payerIds.includes(payment.memberId))) return false;
  const participants = saved ? item.shares.map(share => share.memberId)
    : item.split.mode === "EQUAL" ? item.split.members ?? [] : (item.split.entries ?? []).map(entry => entry.memberId);
  return !filters.participantIds.length || participants.some(id => filters.participantIds.includes(id));
}
