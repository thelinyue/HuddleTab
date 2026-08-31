import { redirect } from "next/navigation";

/**
 * 旧结算路径在服务端直接 replace，避免等待客户端 hydration 时短暂停留在第二套页面壳。
 * 真正的视图仍只由 Activity Workspace 的结算 Tab 承载。
 */
export default async function SettlementsPage({
  params,
}: {
  readonly params: Promise<{ readonly activityId: string }>;
}) {
  const { activityId } = await params;
  redirect(`/activities/${encodeURIComponent(activityId)}?tab=settlement`);
}
