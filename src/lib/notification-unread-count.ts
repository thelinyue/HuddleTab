export const NOTIFICATION_UNREAD_COUNT_EVENT =
  "huddletab:notification-unread-count";

/** 通知页确认服务器写入后，用同页事件同步常驻导航，不把乐观状态扩散到其他模块。 */
export function publishNotificationUnreadCount(unreadCount: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<number>(NOTIFICATION_UNREAD_COUNT_EVENT, {
      detail: unreadCount,
    }),
  );
}
