import { LegacyActivityRedirect } from "@/features/activities/components/legacy-activity-redirect";

/** 旧管理路径只做替换跳转，低频管理内容统一在活动工作台 Sheet/Dialog 中展示。 */
export default function MorePage() {
  return <LegacyActivityRedirect panel="manage" />;
}
