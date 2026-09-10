import { ArrowLeft, Bell, BellRing, CheckCheck, CircleDollarSign, Crown, Ellipsis, Info, MailPlus, ReceiptText, Trash2, UserRoundPlus } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, ConfirmDialog, EmptyState, ErrorNotice, LoadingState, StateIllustration } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import { errorMessage } from "../../api/error";
import { useSessionQuery } from "../auth/api";
import {
  type Notification,
  type NotificationFilter,
  useClearNotificationsMutation,
  useDecideNotificationJoinRequestMutation,
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsQuery,
} from "./api";

type Filter = NotificationFilter;
type Group = "UNREAD" | "TODAY" | "YESTERDAY" | "OLDER";
const filters: Array<[Filter, string]> = [["ALL", "全部"], ["UNREAD", "未读"], ["INVITATION", "邀请"], ["SETTLEMENT", "结算"], ["SYSTEM", "系统"]];
const filterLabels: Record<Filter, string> = Object.fromEntries(filters) as Record<Filter, string>;
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
  if (notification.activityDeleted) return undefined;
  const activity = `/activities/${encodeURIComponent(notification.activityId)}`;
  switch (notification.kind) {
    case "JOIN_APPROVAL_REQUESTED": return `${activity}?panel=members`;
    case "JOIN_APPROVAL_RESOLVED": return notification.payload.status === "APPROVED" ? activity : undefined;
    case "PARTICIPATING_EXPENSE_CHANGED": return `${activity}/expenses/${encodeURIComponent(notification.targetId)}`;
    case "PARTICIPATING_EXPENSE_DELETED": return activity;
    case "SETTLEMENT_RECEIVED": return `${activity}?tab=settlement`;
    case "MEMBER_JOINED":
    case "ACTIVITY_STATUS_CHANGED":
    case "OWNERSHIP_CHANGED": return activity;
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

const notificationSwipeSpring = { stiffness: 420, damping: 42, mass: 1 } as const;
const notificationSwipeHysteresis = 10;
const notificationSwipeProjectionMs = 180;
const notificationSwipeOpenRatio = 0.4;
const notificationSwipeFlingVelocity = -600;

/** 通知滑动只在超过操作区边界时使用阻尼，避免轻触行内容产生跳动。 */
function notificationRubberband(distance: number, dimension: number, constant = 0.55): number {
  const safeDimension = Math.max(dimension, 1);
  return (distance * safeDimension * constant) / (safeDimension + constant * Math.abs(distance));
}

export function projectNotificationSwipe(offset: number, velocity: number): number {
  return offset + velocity * (notificationSwipeProjectionMs / 1000);
}

export function notificationSwipeShouldOpen(offset: number, width: number, velocity: number): boolean {
  return projectNotificationSwipe(offset, velocity) <= -Math.max(width, 1) * notificationSwipeOpenRatio
    || velocity <= notificationSwipeFlingVelocity;
}

type NotificationRowProps = {
  notification: Notification;
  title: string;
  summary?: string;
  icon: ReactNode;
  timeZone: string;
  destination?: string;
  actionable: boolean;
  operationBusy: boolean;
  readBusy: boolean;
  deleteBusy: boolean;
  decideBusy: boolean;
  openRowId: string | null;
  onOpenRow: (notificationId: string | null) => void;
  onRead: (notificationId: string) => void;
  onDelete: (notificationId: string) => void;
  onDecision: (notification: Notification, decision: "APPROVE" | "REJECT") => void;
  onOpenNotification?: (notification: Notification, destination: string) => void;
};

/**
 * 通知行把正文、审批和次级操作放在同一物理表面上。
 * 移动端通过 Pointer Events 连续跟手，桌面和键盘通过省略号菜单获得同一组操作。
 */
function NotificationRow({
  notification,
  title,
  summary,
  icon,
  timeZone,
  destination,
  actionable,
  operationBusy,
  readBusy,
  deleteBusy,
  decideBusy,
  openRowId,
  onOpenRow,
  onRead,
  onDelete,
  onDecision,
  onOpenNotification,
}: NotificationRowProps) {
  const actionWidth = notification.readAt === null ? 128 : 64;
  const isOpen = openRowId === notification.notificationId;
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const offsetRef = useRef(0);
  const animationFrame = useRef<number | undefined>(undefined);
  const pointer = useRef<{
    id: number;
    startX: number;
    startY: number;
    startOffset: number;
    lastX: number;
    lastTime: number;
    velocity: number;
    horizontal: boolean;
  } | undefined>(undefined);
  const suppressClick = useRef(false);
  const reducedMotion = useRef(false);

  const setOffsetValue = useCallback((value: number) => {
    offsetRef.current = value;
    setOffset(value);
  }, []);

  const cancelAnimation = useCallback(() => {
    if (animationFrame.current !== undefined) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = undefined;
  }, []);

  const animateTo = useCallback((target: number, initialVelocity = 0) => {
    cancelAnimation();
    if (reducedMotion.current) {
      setOffsetValue(target);
      return;
    }
    let position = offsetRef.current;
    let velocity = initialVelocity;
    let previousTime = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(Math.max(now - previousTime, 1), 32);
      previousTime = now;
      const steps = Math.max(1, Math.ceil(elapsed / 8));
      const delta = elapsed / steps / 1000;
      for (let index = 0; index < steps; index += 1) {
        const acceleration = (
          -notificationSwipeSpring.stiffness * (position - target)
          - notificationSwipeSpring.damping * velocity
        ) / notificationSwipeSpring.mass;
        velocity += acceleration * delta;
        position += velocity * delta;
      }
      setOffsetValue(position);
      if (Math.abs(position - target) > 0.5 || Math.abs(velocity) > 5) {
        animationFrame.current = requestAnimationFrame(tick);
      } else {
        animationFrame.current = undefined;
        setOffsetValue(target);
      }
    };
    animationFrame.current = requestAnimationFrame(tick);
  }, [cancelAnimation, setOffsetValue]);

  useEffect(() => {
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!media) return;
    const update = () => { reducedMotion.current = media.matches; };
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    animateTo(isOpen ? -actionWidth : 0);
  }, [actionWidth, animateTo, isOpen]);

  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  function releasePointer(event: ReactPointerEvent<HTMLDivElement>) {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    pointer.current = undefined;
    setDragging(false);
    if (!current.horizontal) return;
    const shouldOpen = notificationSwipeShouldOpen(offsetRef.current, actionWidth, current.velocity);
    onOpenRow(shouldOpen ? notification.notificationId : null);
    animateTo(shouldOpen ? -actionWidth : 0, current.velocity);
    suppressClick.current = true;
    requestAnimationFrame(() => { suppressClick.current = false; });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button")) return;
    cancelAnimation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointer.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offsetRef.current,
      lastX: event.clientX,
      lastTime: performance.now(),
      velocity: 0,
      horizontal: false,
    };
    setDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.horizontal) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < notificationSwipeHysteresis) return;
      if (Math.abs(dy) >= Math.abs(dx) * 0.83) {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
        pointer.current = undefined;
        setDragging(false);
        animateTo(isOpen ? -actionWidth : 0);
        suppressClick.current = true;
        requestAnimationFrame(() => { suppressClick.current = false; });
        return;
      }
      current.horizontal = true;
    }
    const now = performance.now();
    const elapsed = Math.max(1, now - current.lastTime);
    current.velocity = ((event.clientX - current.lastX) / elapsed) * 1000;
    current.lastX = event.clientX;
    current.lastTime = now;
    const raw = Math.min(0, current.startOffset + dx);
    const next = raw < -actionWidth
      ? -actionWidth + notificationRubberband(raw + actionWidth, actionWidth)
      : raw;
    setOffsetValue(next);
    event.preventDefault();
  }

  function handleContentClick(event: ReactMouseEvent<HTMLAnchorElement | HTMLDivElement>) {
    if (suppressClick.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (isOpen) {
      event.preventDefault();
      onOpenRow(null);
      return;
    }
    if (destination && onOpenNotification) {
      event.preventDefault();
      onOpenNotification(notification, destination);
      return;
    }
    if (!destination && notification.readAt === null) {
      event.preventDefault();
      onRead(notification.notificationId);
    }
  }

  const content = (
    <>
      <span className="notification-row__icon">{icon}</span>
      <span className="notification-row__content">
        <strong>{title}</strong>
        {summary ? <span>{summary}</span> : null}
        {notification.activityDeleted ? <span className="notification-row__status">活动已删除，无法打开</span> : null}
        <small>{new Date(notification.createdAt).toLocaleString("zh-CN", { timeZone })}</small>
      </span>
    </>
  );

  return (
    <article
      className="notification-row"
      data-testid={`notification-${notification.notificationId}`}
      data-kind={notification.kind}
      data-activity-deleted={notification.activityDeleted}
      data-actionable={actionable ? "true" : "false"}
      data-unread={notification.readAt === null}
      data-swipe-open={isOpen ? "true" : "false"}
    >
      <div className="notification-row__viewport">
        <div className="notification-row__swipe-actions" aria-label={`${title}操作`} aria-hidden={!isOpen}>
          {notification.readAt === null ? <button className="notification-row__swipe-action notification-row__swipe-action--read" type="button" aria-label="标记通知为已读" disabled={operationBusy && !readBusy} tabIndex={isOpen ? 0 : -1} onClick={() => onRead(notification.notificationId)}>标为已读</button> : null}
          <button className="notification-row__swipe-action notification-row__swipe-action--delete" type="button" aria-label="删除通知" disabled={operationBusy && !deleteBusy} tabIndex={isOpen ? 0 : -1} onClick={() => onDelete(notification.notificationId)}>删除</button>
        </div>
        <div
          className="notification-row__surface"
          data-dragging={dragging ? "true" : "false"}
          style={{ transform: `translate3d(${offset}px, 0, 0)` }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
        >
          <div className="notification-row__body">
            {destination ? <Link className="notification-row__link" to={destination} onClick={handleContentClick}>{content}</Link> : <div className="notification-row__link" onClick={handleContentClick}>{content}</div>}
            {actionable ? <div className="notification-row__inline-actions">
              <Button variant="ghost" busy={decideBusy} disabled={operationBusy && !decideBusy} onClick={() => onDecision(notification, "REJECT")}>拒绝</Button>
              <Button busy={decideBusy} disabled={operationBusy && !decideBusy} onClick={() => onDecision(notification, "APPROVE")}>通过</Button>
            </div> : null}
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="icon-button notification-row__menu-trigger" type="button" aria-label="通知操作" title="通知操作"><Ellipsis aria-hidden="true" size={20} /></button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="notification-action-menu" align="end" sideOffset={6}>
                {notification.readAt === null ? <DropdownMenu.Item asChild disabled={operationBusy && !readBusy}><button type="button" role="menuitem" onClick={() => onRead(notification.notificationId)}>标为已读</button></DropdownMenu.Item> : null}
                <DropdownMenu.Item asChild disabled={operationBusy && !deleteBusy}><button type="button" role="menuitem" onClick={() => onDelete(notification.notificationId)}>删除</button></DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </article>
  );
}

function pendingApproval(notification: Notification, resolvedRequestIds: ReadonlySet<string>): boolean {
  return notification.kind === "JOIN_APPROVAL_REQUESTED"
    && !notification.activityDeleted
    && Boolean(notification.payload.requestId)
    && !resolvedRequestIds.has(notification.payload.requestId ?? "");
}

export function NotificationsPage() {
  const session = useSessionQuery();
  const userId = session.data?.userId ?? "";
  const notifications = useNotificationsQuery(userId);
  const markRead = useMarkNotificationReadMutation(userId);
  const markAllRead = useMarkAllNotificationsReadMutation(userId);
  const clearNotifications = useClearNotificationsMutation(userId);
  const deleteNotification = useDeleteNotificationMutation(userId);
  const decide = useDecideNotificationJoinRequestMutation(userId);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [clearOpen, setClearOpen] = useState(false);
  const [operationError, setOperationError] = useState<unknown>();
  const [resolvedRequestIds, setResolvedRequestIds] = useState<Set<string>>(() => new Set());
  const [deletedNotificationIds, setDeletedNotificationIds] = useState<Set<string>>(() => new Set());
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const operationBusy = markRead.isPending || markAllRead.isPending || clearNotifications.isPending || deleteNotification.isPending || decide.isPending;

  async function read(notificationId: string) {
    setOperationError(undefined);
    try { await markRead.mutateAsync(notificationId); } catch (reason) { setOperationError(reason); }
  }

  async function openNotification(notification: Notification, destination: string) {
    setOperationError(undefined);
    if (notification.readAt === null) {
      try { await markRead.mutateAsync(notification.notificationId); }
      catch (reason) { setOperationError(reason); return; }
    }
    navigate(destination);
  }

  async function readAll() {
    setOperationError(undefined);
    try {
      await markAllRead.mutateAsync();
      toast.success("全部通知已标记为已读");
    } catch (reason) { setOperationError(reason); }
  }

  async function clearCurrent() {
    setOperationError(undefined);
    try {
      await clearNotifications.mutateAsync(filter);
      setClearOpen(false);
      toast.success(`已清理“${filterLabels[filter]}”通知`);
    } catch (reason) { setOperationError(reason); }
  }

  async function deleteOne(notificationId: string) {
    setOperationError(undefined);
    setDeletedNotificationIds((current) => new Set(current).add(notificationId));
    try { await deleteNotification.mutateAsync(notificationId); toast.success("通知已删除"); }
    catch (reason) {
      setDeletedNotificationIds((current) => {
        const next = new Set(current);
        next.delete(notificationId);
        return next;
      });
      setOperationError(reason);
    }
  }

  async function decideRequest(notification: Notification, decision: "APPROVE" | "REJECT") {
    const requestId = notification.payload.requestId;
    if (!requestId) return;
    setOperationError(undefined);
    setResolvedRequestIds((current) => new Set(current).add(requestId));
    try { await decide.mutateAsync({ activityId: notification.activityId, requestId, decision }); }
    catch (reason) {
      setResolvedRequestIds((current) => {
        const next = new Set(current);
        next.delete(requestId);
        return next;
      });
      setOperationError(reason);
    }
  }

  if (session.isPending || notifications.isPending) return <LoadingState label="正在读取通知…" />;
  if (session.error || notifications.error) return <ErrorNotice error={session.error ?? notifications.error} />;
  const allItems = (notifications.data?.items ?? []).filter((item) => !deletedNotificationIds.has(item.notificationId));
  const items = allItems.filter((item) => matchesFilter(item, filter));
  const timeZone = notifications.data?.timeZone ?? "Asia/Shanghai";
  const groups = (["UNREAD", "TODAY", "YESTERDAY", "OLDER"] as Group[]).map((group) => ({ group, items: items.filter((item) => notificationGroup(item, timeZone) === group) })).filter((group) => group.items.length);
  const goBack = () => navigate("/activities", { replace: true });

  return <div className="top-level-page notification-page">
    <main className="app-frame notification-page__frame">
      <header className="home-header notification-header">
        <div className="notification-header__title">
          <button className="icon-button" type="button" aria-label="返回活动" title="返回活动" onClick={goBack}><ArrowLeft aria-hidden="true" size={20} /></button>
          <div><h1>通知</h1>{notifications.data?.unreadCount ? <span className="notification-count">{notifications.data.unreadCount} 条未读</span> : null}</div>
        </div>
        <div className="notification-header__actions">
          {notifications.data?.unreadCount ? <button className="icon-button" type="button" aria-label="全部已读" title="全部已读" disabled={operationBusy && !markAllRead.isPending} onClick={() => void readAll()}>{markAllRead.isPending ? <span className="spinner" aria-hidden="true" /> : <CheckCheck aria-hidden="true" size={20} />}</button> : null}
          {items.length ? <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><button className="icon-button" type="button" aria-label="通知更多操作" title="通知更多操作"><Ellipsis aria-hidden="true" size={21} /></button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="notification-action-menu" align="end" sideOffset={6}><DropdownMenu.Item disabled={operationBusy && !clearNotifications.isPending} onSelect={() => { setOperationError(undefined); setClearOpen(true); }}>清理当前</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root> : null}
        </div>
      </header>
      <div className="notification-filters" role="group" aria-label="通知筛选">{filters.map(([value, label]) => <button type="button" aria-pressed={filter === value} key={value} onClick={() => setFilter(value)}>{label}</button>)}</div>
      {operationError && !clearOpen ? <ErrorNotice error={operationError} /> : null}
      {!items.length ? <EmptyState icon={<Bell size={28} />} visual={filter === "ALL" && !allItems.length ? <StateIllustration src="/illustrations/notifications-empty.webp" /> : undefined} title="暂无通知" description={filter === "ALL" ? "活动变化与结算消息会显示在这里。" : "当前筛选下没有通知。"} /> : groups.map(({ group, items: groupItems }) => <section className="notification-group" aria-labelledby={`notification-group-${group}`} key={group}>
        <h2 id={`notification-group-${group}`}>{groupLabels[group]}</h2>
        <div className="notification-list">{groupItems.map((notification) => <NotificationRow
          key={notification.notificationId}
          notification={notification}
          title={notificationTitle(notification)}
          summary={notificationSummary(notification)}
          icon={notificationIcon(notification)}
          timeZone={timeZone}
          destination={notificationDestination(notification)}
          actionable={pendingApproval(notification, resolvedRequestIds)}
          operationBusy={operationBusy}
          readBusy={markRead.isPending && markRead.variables === notification.notificationId}
          deleteBusy={deleteNotification.isPending && deleteNotification.variables === notification.notificationId}
          decideBusy={decide.isPending}
          openRowId={openRowId}
          onOpenRow={setOpenRowId}
          onRead={(notificationId) => void read(notificationId)}
          onDelete={(notificationId) => void deleteOne(notificationId)}
          onDecision={(current, decision) => void decideRequest(current, decision)}
          onOpenNotification={(current, destination) => void openNotification(current, destination)}
        />)}</div>
      </section>)}
    </main>
    <ConfirmDialog open={clearOpen} title={`清理${filterLabels[filter]}通知`} message={`将永久删除当前账号中全部符合“${filterLabels[filter]}”筛选的通知，包括当前列表未加载的旧通知。不会删除活动、账单、结算或加入申请，此操作无法恢复。`} error={clearOpen && operationError ? <span role="alert">{errorMessage(operationError)}</span> : undefined} confirmLabel="确认清理" busy={clearNotifications.isPending} onConfirm={() => void clearCurrent()} onCancel={() => { if (!clearNotifications.isPending) setClearOpen(false); }} />
  </div>;
}
