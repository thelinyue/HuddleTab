import {
  ArrowLeftIcon,
  MoreHorizontalIcon,
  UsersRoundIcon,
} from "lucide-react";
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
  activeTab = "feed",
  moreAction = true,
}: {
  readonly activityId: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly memberCount: number;
  readonly status: "ACTIVE" | "ENDED" | "ARCHIVED";
  readonly activeTab?: "feed" | "settlement";
  readonly moreAction?: boolean;
}) {
  const days = inclusiveCalendarDays(startDate, endDate);
  const statusText = statusLabel(status);
  const query = (panel: "members" | "manage") => {
    const params = new URLSearchParams();
    if (activeTab === "settlement") params.set("tab", "settlement");
    params.set("panel", panel);
    return `/activities/${encodeURIComponent(activityId)}?${params.toString()}`;
  };
  return (
    <header
      aria-label="活动信息"
      className="-mx-4 border-b border-border/70 bg-surface px-4 min-[481px]:-mx-6 min-[481px]:px-6"
    >
      <div className="flex min-h-14 items-center gap-2">
        <Link
          href="/activities"
          aria-label="返回活动列表"
          title="返回活动列表"
          className="flex size-11 shrink-0 items-center justify-center text-foreground"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-5" />
        </Link>
        <div className="min-w-0 flex-1" />
        <Link
          href={query("members")}
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("huddletab:panel-open", {
                detail: "members",
              }),
            );
          }}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 px-2 text-sm font-medium text-foreground underline-offset-2 hover:underline"
          aria-label={`查看成员，${memberCount}人`}
        >
          <UsersRoundIcon aria-hidden="true" className="size-4" />
          成员 {memberCount}
        </Link>
        {moreAction ? (
          <Link
            href={query("manage")}
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("huddletab:panel-open", {
                  detail: "manage",
                }),
              );
            }}
            aria-label="活动更多"
            title="活动更多"
            className="flex size-11 shrink-0 items-center justify-center text-foreground"
          >
            <MoreHorizontalIcon aria-hidden="true" className="size-5" />
          </Link>
        ) : null}
      </div>
      <div className="px-1 pb-3 pt-1">
        <h1 className="truncate text-lg font-semibold text-foreground">{name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {days === null ? null : `${days}天 · `}
          {memberCount}人 · {statusText}
        </p>
      </div>
      <ActivityNavigation activityId={activityId} />
      <ActivityLifecycleNotice status={status} className="mt-3" />
    </header>
  );
}
