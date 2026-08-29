import { LegacyActivityRedirect } from "@/features/activities/components/legacy-activity-redirect";

/** 旧结算路径只做替换跳转，真正的视图统一由活动工作台的结算 Tab 承载。 */
export default function SettlementsPage() {
  return <LegacyActivityRedirect panel="settlement" />;
}
