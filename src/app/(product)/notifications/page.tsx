import { NotificationsPage } from "@/features/notifications/components/notifications-page";
export default function NotificationsRoute() {
  return <NotificationsPage timeZone={process.env.TZ ?? "Asia/Shanghai"} />;
}
