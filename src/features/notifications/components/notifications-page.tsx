"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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

export function NotificationsPage() {
  const [data, setData] = useState<NotificationList | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const markRead = (row: Row) => {
    if (row.readAt) return;
    void fetch(`/api/notifications/${row.id}/read`, { method: "POST" }).then(
      (response) => {
        if (!response.ok) return;
        setData((current) => {
          if (!current) return current;
          return {
            items: current.items.map((item) =>
              item.id === row.id
                ? { ...item, readAt: new Date().toISOString() }
                : item,
            ),
            unreadCount: Math.max(0, current.unreadCount - 1),
          };
        });
      },
    );
  };
  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!data) return <p className="py-8 text-muted-foreground">正在加载通知…</p>;
  return (
    <section className="py-5">
      <h1 className="text-2xl font-bold">通知</h1>
      {data.items.length ? (
        <div className="mt-4">
          {data.items.map((row) => {
            const href = notificationHref(row);
            const title = notificationTitle(row);
            const content = (
              <>
                <strong>{title}</strong>
                <p className="mt-1 text-sm text-muted-foreground">
                  {row.readAt ? "已读" : "未读"}
                </p>
              </>
            );
            return href ? (
              <Link
                key={row.id}
                href={href}
                aria-label={title}
                onClick={() => markRead(row)}
                className="block border-b py-3"
              >
                {content}
              </Link>
            ) : (
              <div key={row.id} className="border-b py-3">
                {content}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-8 text-center text-muted-foreground">暂时没有通知。</p>
      )}
    </section>
  );
}
