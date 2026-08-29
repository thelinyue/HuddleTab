import { ShareSummaryCard } from "@/features/settlements/share-summary/components/share-summary-card";
import { mockShareSummaryData } from "@/features/settlements/share-summary/mock-data";

/**
 * 分享预览刻意脱离 `(product)` 路由组，避免导航、主题同步和交互控件进入导出画布。
 * `activityId` 仅保留为后续真实数据适配入口；首版固定渲染视觉样例。
 */
export default async function ShareSummaryRoute({
  params,
}: {
  readonly params: Promise<{ activityId: string }>;
}) {
  const { activityId } = await params;

  return (
    <main
      data-activity-id={activityId}
      className="flex min-h-dvh min-w-[832px] justify-center bg-[#F3F5EE] px-4 py-10"
    >
      <ShareSummaryCard data={mockShareSummaryData} />
    </main>
  );
}
