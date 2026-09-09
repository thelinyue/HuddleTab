import type { Activity } from "./api";
import { inclusiveCalendarDays } from "../../lib/calendar-date";

/** 活动列表、工作区与管理面板共用的展示文案，不参与业务状态判断。 */
export function activityStatus(status: string): string {
  if (status === "ACTIVE") return "进行中";
  if (status === "ENDED") return "已结束";
  return "已归档";
}

/** 活动列表沿用 v0.0.2 的可扫描元数据：优先显示包含首尾两天的持续天数。 */
export function activityPeriodLabel(activity: Activity): string {
  const days = inclusiveCalendarDays(activity.startDate, activity.endDate);
  if (days !== null) return `${days}天`;
  return [activity.location, activity.startDate].filter(Boolean).join(" · ");
}
