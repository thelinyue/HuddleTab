import { ArrowLeftIcon, MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";

import { ActivityNavigation } from "@/features/activities/components/activity-navigation";
import { ActivityLifecycleNotice } from "@/features/activities/components/activity-lifecycle-notice";
import { inclusiveCalendarDays } from "@/lib/calendar-date";

function statusLabel(status: "ACTIVE" | "ENDED" | "ARCHIVED") {
  return status === "ACTIVE"
    ? "进行中"
    : status === "ENDED"
      ? "已结束"
      : "已归档";
}

/**
 * 活动头只负责展示由页面加载器提供的已授权事实，不自行请求数据。这样成员、结算和
 * 更多页可复用同一骨架，同时各自保留独立的数据刷新与错误边界。
 */
export function ActivityPageHeader({
  activityId,
  name,
  startDate,
  endDate,
  memberCount,
  status,
  moreAction = true,
}: {
  readonly activityId: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly memberCount: number;
  readonly status: "ACTIVE" | "ENDED" | "ARCHIVED";
  readonly moreAction?: boolean;
}) {
  const days = inclusiveCalendarDays(startDate, endDate);
  const summary = [
    days === null ? null : `${days}天`,
    `${memberCount}人`,
    statusLabel(status),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <header
        aria-label="活动信息"
        className="flex min-h-14 items-center gap-2"
      >
        <Link
          href="/activities"
          aria-label="返回活动列表"
          title="返回活动列表"
          className="flex size-11 shrink-0 items-center justify-center text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-foreground">
            {name}
          </h1>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
        {moreAction ? (
          <Link
            href={`/activities/${encodeURIComponent(activityId)}/more`}
            aria-label="活动更多"
            title="活动更多"
            className="flex size-11 shrink-0 items-center justify-center text-foreground"
          >
            <MoreHorizontalIcon aria-hidden="true" className="size-5" />
          </Link>
        ) : null}
      </header>
      <ActivityNavigation activityId={activityId} />
      <ActivityLifecycleNotice status={status} className="mt-3" />
    </>
  );
}
