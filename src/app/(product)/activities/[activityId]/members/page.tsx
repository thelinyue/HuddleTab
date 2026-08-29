import { LegacyActivityRedirect } from "@/features/activities/components/legacy-activity-redirect";

/** 旧成员路径只做替换跳转，成员内容统一在活动工作台的成员面板中展示。 */
export default function MembersPage() {
  return <LegacyActivityRedirect panel="members" />;
}
