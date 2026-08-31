import { connection } from "next/server";

import { NotificationsPage } from "@/features/notifications/components/notifications-page";
import { DEFAULT_TIME_ZONE } from "@/lib/time-zone";

export default async function NotificationsRoute() {
  await connection();
  return <NotificationsPage timeZone={process.env.TZ ?? DEFAULT_TIME_ZONE} />;
}
