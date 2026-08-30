import { Suspense } from "react";

import { ActivityWorkspace } from "@/features/activities/components/activity-workspace";

/** 活动默认页是流水，后续离线层在此处叠加本地待同步行而不改变权威总额。 */
export default function ActivityFeedPage() {
  return (
    <Suspense
      fallback={<p className="py-8 text-muted-foreground">正在加载活动…</p>}
    >
      <ActivityWorkspace timeZone={process.env.TZ ?? "Asia/Shanghai"} />
    </Suspense>
  );
}
