"use client";

import Link from "next/link";
import {
  BellRingIcon,
  CircleDollarSignIcon,
  CrownIcon,
  InfoIcon,
  MailPlusIcon,
  ReceiptTextIcon,
  Trash2Icon,
  UserRoundPlusIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import { publishNotificationUnreadCount } from "@/lib/notification-unread-count";

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
type Filter = "ALL" | "UNREAD" | "INVITATION" | "SETTLEMENT" | "SYSTEM";

const filters: readonly { readonly id: Filter; readonly label: string }[] = [
  { id: "ALL", label: "全部" },
  { id: "UNREAD", label: "未读" },
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
      return `${row.payload.displayName ?? "新成员"}申请加入活动`;
    case "JOIN_APPROVAL_RESOLVED":
      return row.payload.decision === "APPROVE"
        ? "加入申请已通过"
        : "加入申请未通过";
    case "MEMBER_JOINED":
      return `${row.payload.displayName ?? "新成员"}已加入活动`;
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

function notificationFilter(row: Row): Exclude<Filter, "ALL" | "UNREAD"> {
  if (
    [
      "ACTIVITY_INVITATION",
      "JOIN_APPROVAL_REQUESTED",
      "JOIN_APPROVAL_RESOLVED",
      "MEMBER_JOINED",
    ].includes(row.type)
  )
    return "INVITATION";
  if (row.type === "SETTLEMENT_RECEIVED") return "SETTLEMENT";
  return "SYSTEM";
}

function notificationSummary(row: Row): string {
  switch (row.type) {
    case "ACTIVITY_INVITATION":
      return "点击查看活动详情";
    case "JOIN_APPROVAL_REQUESTED":
      return "等待你处理加入申请";
    case "JOIN_APPROVAL_RESOLVED":
      return row.payload.decision === "APPROVE"
        ? "你现在可以进入活动"
        : "申请已由管理员处理";
    case "MEMBER_JOINED":
      return "成员已加入活动";
    case "PARTICIPATING_EXPENSE_CHANGED":
      return "消费记录发生变更";
    case "PARTICIPATING_EXPENSE_DELETED":
      return "该消费已不再计入活动账务";
    case "SETTLEMENT_RECEIVED": {
      const { amountMinor, currency } = row.payload;
      if (!amountMinor || !currency) return "结算记录已更新";
      try {
        return formatMoney(
          {
            currency: asCurrencyCode(currency),
            amountMinor: BigInt(amountMinor),
          },
          "zh-CN",
        );
      } catch {
        return "结算记录已更新";
      }
    }
    case "ACTIVITY_STATUS_CHANGED":
      return row.payload.status === "ENDED"
        ? "活动已结束"
        : row.payload.status === "ARCHIVED"
          ? "活动已归档"
          : "活动状态发生变更";
    case "OWNERSHIP_CHANGED":
      return "请留意新的活动管理权限";
    default:
      return "查看通知详情";
  }
}

const iconAppearance: Record<
  string,
  { readonly Icon: LucideIcon; readonly className: string }
> = {
  ACTIVITY_INVITATION: {
    Icon: MailPlusIcon,
    className: "bg-primary/10 text-primary",
  },
  JOIN_APPROVAL_REQUESTED: {
    Icon: UserRoundPlusIcon,
    className: "bg-primary/10 text-primary",
  },
  JOIN_APPROVAL_RESOLVED: {
    Icon: UserRoundPlusIcon,
    className: "bg-primary/10 text-primary",
  },
  MEMBER_JOINED: {
    Icon: UserRoundPlusIcon,
    className: "bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300",
  },
  PARTICIPATING_EXPENSE_CHANGED: {
    Icon: ReceiptTextIcon,
    className: "bg-primary/10 text-primary",
  },
  PARTICIPATING_EXPENSE_DELETED: {
    Icon: Trash2Icon,
    className: "bg-destructive/10 text-destructive",
  },
  SETTLEMENT_RECEIVED: {
    Icon: CircleDollarSignIcon,
    className: "bg-orange/15 text-warning",
  },
  ACTIVITY_STATUS_CHANGED: {
    Icon: BellRingIcon,
    className: "bg-orange/15 text-warning",
  },
  OWNERSHIP_CHANGED: {
    Icon: CrownIcon,
    className: "bg-surface-muted text-muted-foreground",
  },
};

function NotificationIcon({ type }: { readonly type: string }) {
  const { Icon, className } = iconAppearance[type] ?? {
    Icon: InfoIcon,
    className: "bg-surface-muted text-muted-foreground",
  };
  return (
    <span
      aria-hidden="true"
      className={`flex size-12 shrink-0 items-center justify-center rounded-md ${className}`}
    >
      <Icon className="size-6" />
    </span>
  );
}

function dateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function localDayNumber(value: Date, timeZone: string) {
  const { year, month, day } = dateParts(value, timeZone);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function formatTimestamp(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
    timeZone,
  }).format(date);
}

type NotificationGroup = {
  readonly label: "未读" | "今天" | "昨天" | "更早";
  readonly items: readonly Row[];
};

/** 未读通知固定置顶；已读通知再按部署时区分组，避免跨时区出现日期错位。 */
function groupNotifications(
  items: readonly Row[],
  timeZone: string,
): readonly NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const unread = items.filter((item) => !item.readAt);
  if (unread.length) groups.push({ label: "未读", items: unread });

  const readBuckets = new Map<NotificationGroup["label"], Row[]>([
    ["今天", []],
    ["昨天", []],
    ["更早", []],
  ]);
  const today = localDayNumber(new Date(Date.now()), timeZone);
  for (const item of items) {
    if (!item.readAt) continue;
    const createdAt = new Date(item.createdAt);
    const difference = Number.isNaN(createdAt.getTime())
      ? 2
      : today - localDayNumber(createdAt, timeZone);
    const label = difference <= 0 ? "今天" : difference === 1 ? "昨天" : "更早";
    readBuckets.get(label)!.push(item);
  }
  for (const label of ["今天", "昨天", "更早"] as const) {
    const bucket = readBuckets.get(label)!;
    if (bucket.length) groups.push({ label, items: bucket });
  }
  return groups;
}

/** 通知已读状态始终以服务器逐条确认的结果为准，批量操作不会覆盖失败项。 */
export function NotificationsPage({ timeZone }: { readonly timeZone: string }) {
  const [data, setData] = useState<NotificationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    readonly text: string;
    readonly level: "status" | "alert";
  } | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
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
  useEffect(() => {
    if (data) publishNotificationUnreadCount(data.unreadCount);
  }, [data]);

  const visibleItems = useMemo(
    () =>
      data?.items.filter((row) => {
        if (filter === "UNREAD") return !row.readAt;
        return filter === "ALL" || notificationFilter(row) === filter;
      }) ?? [],
    [data, filter],
  );
  const groups = useMemo(
    () => groupNotifications(visibleItems, timeZone),
    [timeZone, visibleItems],
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
        setNotice({
          text:
            reason instanceof Error
              ? reason.message
              : "通知未能标为已读，请稍后重试。",
          level: "alert",
        }),
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
        setNotice({
          text: "部分通知未能标为已读，请稍后重试。",
          level: "alert",
        });
    });
  };
  const decideJoinRequest = async (
    row: Row,
    decision: "APPROVE" | "REJECT",
  ) => {
    const requestId = row.payload.requestId;
    const displayName = row.payload.displayName ?? "该成员";
    if (!row.activityId || !requestId || decidingId) return;
    setDecidingId(row.id);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/activities/${row.activityId}/invitations/join-requests/${requestId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!response.ok) throw new Error("加入申请处理失败，请稍后重试。");
      setData((current) =>
        current
          ? {
              items: current.items.filter((item) => item.id !== row.id),
              unreadCount: Math.max(
                0,
                current.unreadCount - (row.readAt ? 0 : 1),
              ),
            }
          : current,
      );
      setNotice({
        text:
          decision === "APPROVE"
            ? `已通过${displayName}的加入申请。`
            : `已拒绝${displayName}的加入申请。`,
        level: "status",
      });
    } catch (reason) {
      setNotice({
        text:
          reason instanceof Error
            ? reason.message
            : "加入申请处理失败，请稍后重试。",
        level: "alert",
      });
    } finally {
      setDecidingId(null);
    }
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

  const rowContent = (row: Row) => (
    <>
      <NotificationIcon type={row.type} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <strong className="type-body min-w-0 flex-1 truncate font-medium">
            {notificationTitle(row)}
          </strong>
          <time
            dateTime={row.createdAt}
            className="type-caption shrink-0 text-muted-foreground"
          >
            {formatTimestamp(row.createdAt, timeZone)}
          </time>
        </span>
        <span className="type-label mt-0.5 block truncate text-muted-foreground">
          {notificationSummary(row)}
        </span>
      </span>
      {!row.readAt ? (
        <span
          aria-label="未读标记"
          className="size-2 shrink-0 rounded-full bg-primary"
        />
      ) : null}
    </>
  );

  const renderRow = (row: Row) => {
    const href = notificationHref(row);
    const title = notificationTitle(row);
    if (
      row.type === "JOIN_APPROVAL_REQUESTED" &&
      row.activityId &&
      row.payload.requestId
    ) {
      const displayName = row.payload.displayName ?? "该成员";
      return (
        <article key={row.id} data-notification-row className="border-b py-3">
          <div className="flex min-h-16 items-center gap-3">
            {rowContent(row)}
          </div>
          <div className="ml-[3.75rem] mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={decidingId !== null}
              className="min-h-11 rounded-sm border px-3 text-sm font-semibold disabled:opacity-50"
              aria-label={`拒绝${displayName}的申请`}
              onClick={() => void decideJoinRequest(row, "REJECT")}
            >
              拒绝
            </button>
            <button
              type="button"
              disabled={decidingId !== null}
              className="min-h-11 rounded-sm bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              aria-label={`通过${displayName}的申请`}
              onClick={() => void decideJoinRequest(row, "APPROVE")}
            >
              {decidingId === row.id ? "处理中…" : "通过"}
            </button>
          </div>
        </article>
      );
    }
    const className =
      "flex min-h-20 items-center gap-3 border-b py-3 text-left";
    return href ? (
      <Link
        key={row.id}
        href={href}
        aria-label={title}
        data-notification-row
        onClick={() => markRead(row)}
        className={className}
      >
        {rowContent(row)}
      </Link>
    ) : (
      <div key={row.id} data-notification-row className={className}>
        {rowContent(row)}
      </div>
    );
  };

  return (
    <section className="py-2">
      <header className="flex min-h-12 items-center justify-between gap-3">
        <h1 className="type-page-title font-semibold">通知</h1>
        <button
          type="button"
          className="min-h-11 px-1 text-sm font-medium text-primary disabled:text-muted-foreground"
          disabled={!data.unreadCount}
          onClick={markAllRead}
        >
          全部已读
        </button>
      </header>

      <div
        role="group"
        aria-label="通知筛选"
        className="mt-3 grid h-12 grid-cols-5 gap-0.5 rounded-md border bg-surface-muted p-0.5"
      >
        {filters.map((item) => {
          const selected = filter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={selected}
              className={`min-h-11 rounded-sm text-xs font-medium transition-colors ${
                selected
                  ? "bg-surface text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {notice ? (
        <p
          role={notice.level}
          className={`mt-3 text-sm ${notice.level === "status" ? "text-success" : "text-destructive"}`}
        >
          {notice.text}
        </p>
      ) : null}

      {groups.length ? (
        <div className="mt-5">
          {groups.map((group, index) => (
            <section
              key={group.label}
              aria-labelledby={`notification-group-${group.label}`}
              className={index ? "mt-5" : undefined}
            >
              <h2
                id={`notification-group-${group.label}`}
                className="type-section-title border-b pb-2 font-semibold"
              >
                {group.label}
              </h2>
              <div>{group.items.map(renderRow)}</div>
            </section>
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-muted-foreground">
          该筛选下没有通知。
        </p>
      )}
    </section>
  );
}
