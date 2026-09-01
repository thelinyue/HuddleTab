import { Bell, Check, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, EmptyState, ErrorNotice, LoadingState } from "../../components/ui";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { useSessionQuery } from "../auth/api";
import {
  type Notification,
  useMarkNotificationReadMutation,
  useNotificationsQuery,
} from "./api";

function notificationTitle(notification: Notification): string {
  if (notification.kind === "JOIN_APPROVAL_REQUESTED") {
    return `${notification.payload.displayName ?? "新成员"} 申请加入活动`;
  }
  return notification.payload.status === "APPROVED" ? "加入申请已批准" : "加入申请未通过";
}

function notificationDestination(notification: Notification): string | undefined {
  if (notification.kind === "JOIN_APPROVAL_REQUESTED") {
    return `/activities/${encodeURIComponent(notification.activityId)}?panel=members`;
  }
  if (notification.payload.status === "APPROVED") {
    return `/activities/${encodeURIComponent(notification.activityId)}`;
  }
  return undefined;
}

export function NotificationsPage() {
  const session = useSessionQuery();
  const notifications = useNotificationsQuery(session.data?.userId ?? "");
  const markRead = useMarkNotificationReadMutation(session.data?.userId ?? "");
  const [readError, setReadError] = useState<unknown>();

  async function read(notificationId: string) {
    setReadError(undefined);
    try {
      await markRead.mutateAsync(notificationId);
    } catch (reason) {
      setReadError(reason);
    }
  }

  if (session.isPending || notifications.isPending) {
    return <LoadingState label="正在读取通知…" />;
  }
  if (session.error || notifications.error) {
    return <ErrorNotice error={session.error ?? notifications.error} />;
  }
  const items = notifications.data?.items ?? [];
  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="home-header">
          <h1>通知</h1>
          {notifications.data?.unreadCount ? <span className="notification-count">{notifications.data.unreadCount} 条未读</span> : null}
        </header>
        {readError ? <ErrorNotice error={readError} /> : null}
        {!items.length ? <EmptyState icon={<Bell size={28} />} title="暂无通知" description="加入审批结果会显示在这里。" /> : (
          <div className="notification-list">
            {items.map((notification) => {
              const destination = notificationDestination(notification);
              const title = notificationTitle(notification);
              const content = (
                <>
                  <span className="notification-row__icon"><UserPlus aria-hidden="true" size={19} /></span>
                  <span className="notification-row__content">
                    <strong>{title}</strong>
                    <small>{new Date(notification.createdAt).toLocaleString("zh-CN")}</small>
                  </span>
                </>
              );
              return (
                <article
                  className="notification-row"
                  data-testid={`notification-${notification.notificationId}`}
                  data-unread={notification.readAt === null}
                  key={notification.notificationId}
                >
                  {destination ? <Link className="notification-row__link" to={destination}>{content}</Link> : <div className="notification-row__link">{content}</div>}
                  {notification.readAt === null ? (
                    <Button
                      className="notification-read-button"
                      variant="ghost"
                      busy={markRead.isPending}
                      aria-label="标记通知为已读"
                      title="标记通知为已读"
                      onClick={() => void read(notification.notificationId)}
                    ><Check aria-hidden="true" size={18} /></Button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </main>
      <ProductBottomNavigation />
    </div>
  );
}
