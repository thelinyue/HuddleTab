import type { ReactNode } from "react";

import { ActivityNavigation } from "@/features/activities/components/activity-navigation";

/** 活动详情使用固定四项导航，并由上层 ProductNavigation 隐藏一级底部栏。 */
export default function ActivityLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <section className="min-w-0">
      <ActivityNavigation />
      {children}
    </section>
  );
}
