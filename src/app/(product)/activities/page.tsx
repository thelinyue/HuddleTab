import { connection } from "next/server";

import { ActivityHomeLoader } from "@/features/activities/components/activity-home";
import { DEFAULT_TIME_ZONE } from "@/lib/time-zone";

/** 活动首页的 Server 页面仅组合客户端读取模型，账务汇总始终来自同源授权 API。 */
export default async function ActivitiesPage() {
  await connection();
  return <ActivityHomeLoader timeZone={process.env.TZ ?? DEFAULT_TIME_ZONE} />;
}
