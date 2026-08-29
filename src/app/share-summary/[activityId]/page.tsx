import { ShareSummaryLoader } from "@/features/settlements/share-summary/components/share-summary-loader";

/**
 * 分享预览刻意脱离 `(product)` 路由组，避免导航、主题同步和交互控件进入导出画布。
 * 数据请求放在加载器中，保证当前登录成员的授权摘要不会被静态路由缓存。
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
      <ShareSummaryLoader activityId={activityId} />
    </main>
  );
}
