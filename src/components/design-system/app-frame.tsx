import type { ReactNode } from "react";

import { PageReveal } from "@/components/design-system/page-reveal";

/**
 * 产品页面共享的内容边界。移动端保持单列和安全区，宽屏只扩大同一信息架构的阅读宽度，
 * 不创建独立的桌面后台布局；`wide` 仅供 System Admin 等确有更宽数据表格的页面使用。
 */
export function AppFrame({
  children,
  reveal = false,
  wide = false,
}: {
  readonly children: ReactNode;
  readonly reveal?: boolean;
  readonly wide?: boolean;
}) {
  const className = `mx-auto min-h-dvh w-full max-w-[800px] px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))] min-[481px]:px-6 ${wide ? "min-[768px]:max-w-[840px]" : ""}`;
  return reveal ? (
    <PageReveal
      testId="app-frame"
      className={className}
    >
      {children}
    </PageReveal>
  ) : (
    <main data-testid="app-frame" className={className}>
      {children}
    </main>
  );
}
