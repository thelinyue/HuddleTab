"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** 兼容旧活动子路径但不再维护第二套页面实现，统一替换到 canonical 工作台 URL。 */
export function LegacyActivityRedirect({
  panel,
}: {
  readonly panel: "members" | "manage" | "settlement";
}) {
  const { activityId } = useParams<{ activityId: string }>();
  const router = useRouter();
  useEffect(() => {
    const query = new URLSearchParams();
    if (panel === "settlement") query.set("tab", "settlement");
    else query.set("panel", panel);
    router.replace(
      `/activities/${encodeURIComponent(activityId)}?${query.toString()}`,
    );
  }, [activityId, panel, router]);
  return <p className="py-8 text-muted-foreground">正在打开活动…</p>;
}
