import { ActivityHomeLoader } from "@/features/activities/components/activity-home";

/** 活动首页的 Server 页面仅组合客户端读取模型，账务汇总始终来自同源授权 API。 */
export default function ActivitiesPage() {
  return <ActivityHomeLoader />;
}
