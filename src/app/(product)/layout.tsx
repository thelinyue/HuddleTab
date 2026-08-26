import type { ReactNode } from "react";

import { AppFrame } from "@/components/design-system/app-frame";
import { ProductNavigation } from "@/components/design-system/bottom-navigation";

/** 已登录产品页共享单列内容框与一级导航；活动详情由路径自动切换至二级导航。 */
export default function ProductLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <AppFrame>{children}</AppFrame>
      <ProductNavigation />
    </>
  );
}
