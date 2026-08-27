"use client";

import Link from "next/link";
import {
  BellRingIcon,
  CircleDollarSignIcon,
  InfoIcon,
  MailPlusIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ActivityCover } from "@/components/design-system/activity-cover";
import { AppHeader } from "@/components/design-system/app-header";

type Row = {
  readonly id: string;
  readonly type: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly activityId: string | null;
  readonly payload: Readonly<Record<string, string>>;
  readonly readAt: string | null;
  readonly createdAt: string;
};
type NotificationList = {
  readonly items: readonly Row[];
  readonly unreadCount: number;
};
type Filter = "ALL" | "INVITATION" | "SETTLEMENT" | "SYSTEM";

const filters: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: "ALL", label: "全部" },
  { id: "INVITATION", label: "邀请" },
  { id: "SETTLEMENT", label: "结算" },
  { id: "SYSTEM", label: "系统" },
];

/** 跳转地址只从通知表的受控目标字段生成，payload 绝不参与 URL 组装。 */
export function notificationHref(row: Row): string | null {
  if (!row.activityId) return null;
  if (row.targetType === "ACTIVITY") return `/activities/${row.activityId}`;
  if (row.targetType === "EXPENSE")
    return `/activities/${row.activityId}/expenses/${row.targetId}`;
  if (row.targetType === "SETTLEMENT")
    return `/activities/${row.activityId}/settlements`;
  return null;
}

function notificationTitle(row: Row): string {
  switch (row.type) {
    case "ACTIVITY_INVITATION":
      return "收到活动邀请";
    case "JOIN_APPROVAL_REQUESTED":
      return "收到加入审批申请";
    case "JOIN_APPROVAL_RESOLVED":
      return row.payload.decision === "APPROVE"
        ? "加入申请已通过"
        : "加入申请未通过";
    case "PARTICIPATING_EXPENSE_CHANGED":
      return `你参与的消费“${row.payload.title ?? ""}”已被修改`;
    case "PARTICIPATING_EXPENSE_DELETED":
      return `你参与的消费“${row.payload.title ?? ""}”已被删除`;
    case "SETTLEMENT_RECEIVED":
      return "收到一笔结算";
    case "ACTIVITY_STATUS_CHANGED":
      return "活动状态已更新";
    case "OWNERSHIP_CHANGED":
      return "活动所有权已变更";
    default:
      return "收到一条通知";
  }
}

function notificationFilter(row: Row): Exclude<Filter, "ALL"> {
  if (
    [
      "ACTIVITY_INVITATION",
      "JOIN_APPROVAL_REQUESTED",
      "JOIN_APPROVAL_RESOLVED",
    ].includes(row.type)
  )
    return "INVITATION";
  if (row.type === "SETTLEMENT_RECEIVED") return "SETTLEMENT";
  return "SYSTEM";
}

function NotificationIcon({ type }: { readonly type: string }) {
  const filter = notificationFilter({ type } as Row);
  const Icon =
    filter === "INVITATION"
      ? MailPlusIcon
      : filter === "SETTLEMENT"
        ? CircleDollarSignIcon
        : type === "ACTIVITY_STATUS_CHANGED"
          ? BellRingIcon
          : InfoIcon;
  return <Icon aria-hidden="true" className="size-5 text-muted-foreground" />;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** 通知已读状态始终以服务器逐条确认的结果为准，批量操作不会覆盖失败项。 */
export function NotificationsPage() {
  const [data, setData] = useState<NotificationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  useEffect(() => {
    void fetch("/api/notifications", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("通知加载失败，请稍后重试。");
        return (await response.json()).data as NotificationList;
      })
      .then(setData)
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "通知加载失败，请稍后重试。",
        ),
      );
  }, []);

  const visibleItems = useMemo(
    () =>
      data?.items.filter(
        (row) => filter === "ALL" || notificationFilter(row) === filter,
      ) ?? [],
    [data, filter],
  );
  const updateReadRows = (readIds: ReadonlySet<string>) => {
    if (!readIds.size) return;
    setData((current) => {
      if (!current) return current;
      const markedCount = current.items.filter(
        (item) => !item.readAt && readIds.has(item.id),
      ).length;
      return {
        items: current.items.map((item) =>
          readIds.has(item.id)
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ),
        unreadCount: Math.max(0, current.unreadCount - markedCount),
      };
    });
  };
  const markRead = (row: Row) => {
    if (row.readAt) return;
    void fetch(`/api/notifications/${row.id}/read`, { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("通知未能标为已读，请稍后重试。");
        updateReadRows(new Set([row.id]));
      })
      .catch((reason: unknown) =>
        setNotice(
          reason instanceof Error
            ? reason.message
            : "通知未能标为已读，请稍后重试。",
        ),
      );
  };
  const markAllRead = () => {
    const unreadRows = data?.items.filter((row) => !row.readAt) ?? [];
    if (!unreadRows.length) return;
    void Promise.all(
      unreadRows.map(async (row) => {
        try {
          const response = await fetch(`/api/notifications/${row.id}/read`, {
            method: "POST",
          });
          return response.ok ? row.id : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      const successfulIds = new Set(
        results.filter((id): id is string => Boolean(id)),
      );
      updateReadRows(successfulIds);
      if (successfulIds.size !== unreadRows.length)
        setNotice("部分通知未能标为已读，请稍后重试。");
    });
  };

  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!data)
    return (
      <p role="status" className="py-8 text-muted-foreground">
        正在加载通知…
      </p>
    );
  return (
    <section className="py-5">
      <AppHeader
        title="通知"
        subtitle={data.unreadCount ? `${data.unreadCount} 条未读` : "全部已读"}
        actions={
          <button
            type="button"
            className="min-h-11 text-sm font-medium text-primary disabled:text-muted-foreground"
            disabled={!data.unreadCount}
            onClick={markAllRead}
          >
            全部已读
          </button>
        }
      />
      <div className="mt-4 flex gap-2" aria-label="通知筛选">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            className="min-h-9 border px-3 text-sm aria-pressed:bg-muted"
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {notice ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {notice}
        </p>
      ) : null}
      {visibleItems.length ? (
        <div className="mt-4 divide-y border-y">
          {visibleItems.map((row) => {
            const href = notificationHref(row);
            const title = notificationTitle(row);
            const content = (
              <>
                {row.activityId ? (
                  <ActivityCover
                    activityId={row.activityId}
                    className="size-11 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center bg-muted">
                    <NotificationIcon type={row.type} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <strong className="flex items-center gap-2">
                    <NotificationIcon type={row.type} />
                    {title}
                  </strong>
                  <span className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <time dateTime={row.createdAt}>
                      {formatTimestamp(row.createdAt)}
                    </time>
                    <span>{row.readAt ? "已读" : "未读"}</span>
                  </span>
                </span>
                {!row.readAt ? (
                  <span
                    aria-label="未读标记"
                    className="mt-1 size-2 shrink-0 rounded-full bg-primary"
                  />
                ) : null}
              </>
            );
            const className = "flex min-h-16 items-center gap-3 py-3 text-left";
            return href ? (
              <Link
                key={row.id}
                href={href}
                aria-label={title}
                onClick={() => markRead(row)}
                className={className}
              >
                {content}
              </Link>
            ) : (
              <div key={row.id} className={className}>
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-8 text-center text-muted-foreground">
          该筛选下没有通知。
        </p>
      )}
    </section>
  );
}
