import { Bell, BellRing, Check, CheckCheck, CircleDollarSign, Crown, Info, MailPlus, ReceiptText, Trash2, UserRoundPlus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { Button, EmptyState, ErrorNotice, LoadingState } from "../../components/ui";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { formatMoney } from "../../domain-preview/money";
import { useSessionQuery } from "../auth/api";
import { type Notification, useDecideNotificationJoinRequestMutation, useMarkNotificationReadMutation, useNotificationsQuery } from "./api";

type Filter = "ALL" | "UNREAD" | "INVITATION" | "SETTLEMENT" | "SYSTEM";
type Group = "UNREAD" | "TODAY" | "YESTERDAY" | "OLDER";
const filters: Array<[Filter, string]> = [["ALL", "全部"], ["UNREAD", "未读"], ["INVITATION", "邀请"], ["SETTLEMENT", "结算"], ["SYSTEM", "系统"]];
const groupLabels: Record<Group, string> = { UNREAD: "未读", TODAY: "今天", YESTERDAY: "昨天", OLDER: "更早" };

function notificationTitle(notification: Notification): string {
  switch (notification.kind) {
    case "JOIN_APPROVAL_REQUESTED": return `${notification.payload.displayName ?? "新成员"} 申请加入活动`;
    case "JOIN_APPROVAL_RESOLVED": return notification.payload.status === "APPROVED" ? "加入申请已批准" : "加入申请未通过";
    case "MEMBER_JOINED": return `${notification.payload.displayName ?? "新成员"} 已加入活动`;
    case "PARTICIPATING_EXPENSE_CHANGED": return "参与的账单已修改";
    case "PARTICIPATING_EXPENSE_DELETED": return "参与的账单已删除";
    case "SETTLEMENT_RECEIVED": return "收到一笔结算";
    case "ACTIVITY_STATUS_CHANGED": return "活动状态已更新";
    case "OWNERSHIP_CHANGED": return "你已成为活动所有者";
  }
}

function notificationSummary(notification: Notification): string | undefined {
  if (notification.kind === "JOIN_APPROVAL_REQUESTED") return "等待你处理加入申请";
  if (notification.kind === "JOIN_APPROVAL_RESOLVED") return notification.payload.status === "APPROVED" ? "你现在可以进入活动" : "申请已由管理员处理";
  if (notification.kind === "MEMBER_JOINED") return "成员已加入活动";
  if (notification.kind === "PARTICIPATING_EXPENSE_CHANGED") return "消费记录发生变更";
  if (notification.kind === "PARTICIPATING_EXPENSE_DELETED") return "该消费已不再计入活动账务";
  if (notification.kind === "SETTLEMENT_RECEIVED") {
    const { amountMinor, currency } = notification.payload;
    return amountMinor && currency ? formatMoney(currency, amountMinor) : undefined;
  }
  if (notification.kind === "ACTIVITY_STATUS_CHANGED") return notification.payload.status === "ENDED" ? "活动已结束" : notification.payload.status === "ARCHIVED" ? "活动已归档" : "活动状态发生变更";
  if (notification.kind === "OWNERSHIP_CHANGED") return "请留意新的活动管理权限";
  return notification.payload.activityName;
}

/** 深链只由服务端枚举和受控 ID 组合，不读取 payload 中可能出现的 URL。 */
export function notificationDestination(notification: Notification): string | undefined {
  const activity = `/activities/${encodeURIComponent(notification.activityId)}`;
  switch (notification.kind) {
    case "JOIN_APPROVAL_REQUESTED": return `${activity}?panel=members`;
    case "JOIN_APPROVAL_RESOLVED": return notification.payload.status === "APPROVED" ? activity : undefined;
    case "PARTICIPATING_EXPENSE_CHANGED": return `${activity}/expenses/${encodeURIComponent(notification.targetId)}`;
    case "PARTICIPATING_EXPENSE_DELETED": return activity;
    case "SETTLEMENT_RECEIVED": return `${activity}?tab=settlement`;
    case "MEMBER_JOINED":
    case "ACTIVITY_STATUS_CHANGED":
    case "OWNERSHIP_CHANGED": return notification.payload.status === "DELETED" ? undefined : activity;
  }
}

function notificationIcon(notification: Notification): ReactNode {
  if (notification.kind === "JOIN_APPROVAL_REQUESTED") return <UserRoundPlus aria-hidden="true" size={22} />;
  if (notification.kind === "JOIN_APPROVAL_RESOLVED") return <MailPlus aria-hidden="true" size={22} />;
  if (notification.kind === "MEMBER_JOINED") return <UserRoundPlus aria-hidden="true" size={22} />;
  if (notification.kind === "PARTICIPATING_EXPENSE_CHANGED") return <ReceiptText aria-hidden="true" size={22} />;
  if (notification.kind === "PARTICIPATING_EXPENSE_DELETED") return <Trash2 aria-hidden="true" size={22} />;
  if (notification.kind === "SETTLEMENT_RECEIVED") return <CircleDollarSign aria-hidden="true" size={22} />;
  if (notification.kind === "ACTIVITY_STATUS_CHANGED") return <BellRing aria-hidden="true" size={22} />;
  if (notification.kind === "OWNERSHIP_CHANGED") return <Crown aria-hidden="true" size={22} />;
  return <Info aria-hidden="true" size={22} />;
}

function dateNumber(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return Math.floor(Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000);
}

export function notificationGroup(notification: Notification, timeZone: string, now = new Date()): Group {
  if (notification.readAt === null) return "UNREAD";
  const age = dateNumber(now, timeZone) - dateNumber(new Date(notification.createdAt), timeZone);
  if (age <= 0) return "TODAY";
  if (age === 1) return "YESTERDAY";
  return "OLDER";
}

function matchesFilter(notification: Notification, filter: Filter): boolean {
  if (filter === "ALL") return true;
  if (filter === "UNREAD") return notification.readAt === null;
  if (filter === "INVITATION") return notification.kind.startsWith("JOIN_") || notification.kind === "MEMBER_JOINED";
  if (filter === "SETTLEMENT") return notification.kind === "SETTLEMENT_RECEIVED";
  return !notification.kind.startsWith("JOIN_") && notification.kind !== "MEMBER_JOINED" && notification.kind !== "SETTLEMENT_RECEIVED";
}

export function NotificationsPage() {
  const session = useSessionQuery();
  const userId = session.data?.userId ?? "";
  const notifications = useNotificationsQuery(userId);
  const markRead = useMarkNotificationReadMutation(userId);
  const decide = useDecideNotificationJoinRequestMutation(userId);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [operationError, setOperationError] = useState<unknown>();

  async function read(notificationId: string) {
    setOperationError(undefined);
    try { await markRead.mutateAsync(notificationId); } catch (reason) { setOperationError(reason); }
  }

  async function readAll(items: Notification[]) {
    setOperationError(undefined);
    let failed = 0;
    for (const item of items.filter((notification) => notification.readAt === null)) {
      try { await markRead.mutateAsync(item.notificationId); } catch { failed += 1; }
    }
    if (failed) setOperationError(new Error(`${failed} 条通知未能标记为已读，请重试。`));
  }

  async function decideRequest(notification: Notification, decision: "APPROVE" | "REJECT") {
    const requestId = notification.payload.requestId;
    if (!requestId) return;
    setOperationError(undefined);
    try { await decide.mutateAsync({ activityId: notification.activityId, requestId, decision }); } catch (reason) { setOperationError(reason); }
  }

  if (session.isPending || notifications.isPending) return <LoadingState label="正在读取通知…" />;
  if (session.error || notifications.error) return <ErrorNotice error={session.error ?? notifications.error} />;
  const allItems = notifications.data?.items ?? [];
  const items = allItems.filter((item) => matchesFilter(item, filter));
  const timeZone = notifications.data?.timeZone ?? "Asia/Shanghai";
  const groups = (["UNREAD", "TODAY", "YESTERDAY", "OLDER"] as Group[]).map((group) => ({ group, items: items.filter((item) => notificationGroup(item, timeZone) === group) })).filter((group) => group.items.length);

  return <div className="top-level-page">
    <main className="app-frame app-frame--with-nav">
      <header className="home-header"><div><h1>通知</h1>{notifications.data?.unreadCount ? <span className="notification-count">{notifications.data.unreadCount} 条未读</span> : null}</div>{notifications.data?.unreadCount ? <Button variant="ghost" busy={markRead.isPending} onClick={() => void readAll(allItems)}><CheckCheck aria-hidden="true" size={17} />全部已读</Button> : null}</header>
      <div className="notification-filters" role="group" aria-label="通知筛选">{filters.map(([value, label]) => <button type="button" aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div>
      {operationError ? <ErrorNotice error={operationError} /> : null}
      {!items.length ? <EmptyState icon={<Bell size={28} />} title="暂无通知" description={filter === "ALL" ? "活动变化与结算消息会显示在这里。" : "当前筛选下没有通知。"} /> : groups.map(({ group, items: groupItems }) => <section className="notification-group" aria-labelledby={`notification-group-${group}`} key={group}>
        <h2 id={`notification-group-${group}`}>{groupLabels[group]}</h2>
        <div className="notification-list">{groupItems.map((notification) => {
          const destination = notificationDestination(notification);
          const summary = notificationSummary(notification);
          const content = <><span className="notification-row__icon">{notificationIcon(notification)}</span><span className="notification-row__content"><strong>{notificationTitle(notification)}</strong>{summary ? <span>{summary}</span> : null}<small>{new Date(notification.createdAt).toLocaleString("zh-CN", { timeZone })}</small></span></>;
          const actionable = notification.kind === "JOIN_APPROVAL_REQUESTED" && notification.readAt === null && !notification.payload.status && notification.payload.requestId;
          return <article className="notification-row" data-testid={`notification-${notification.notificationId}`} data-kind={notification.kind} data-unread={notification.readAt === null} key={notification.notificationId}>
            {destination ? <Link className="notification-row__link" to={destination}>{content}</Link> : <div className="notification-row__link">{content}</div>}
            <div className="notification-row__actions">{actionable ? <><Button variant="ghost" busy={decide.isPending} onClick={() => void decideRequest(notification, "REJECT")}>拒绝</Button><Button busy={decide.isPending} onClick={() => void decideRequest(notification, "APPROVE")}>通过</Button></> : null}{notification.readAt === null && !actionable ? <Button className="notification-read-button" variant="ghost" busy={markRead.isPending} aria-label="标记通知为已读" title="标记通知为已读" onClick={() => void read(notification.notificationId)}><Check aria-hidden="true" size={18} /></Button> : null}</div>
          </article>;
        })}</div>
      </section>)}
    </main>
    <ProductBottomNavigation />
  </div>;
}
