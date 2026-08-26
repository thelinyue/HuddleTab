import type { ReactNode } from "react";

/**
 * 产品页面共享的内容边界。移动端保持单列和安全区，宽屏只扩大同一信息架构的阅读宽度，
 * 不创建独立的桌面后台布局；`wide` 仅供 System Admin 等确有更宽数据表格的页面使用。
 */
export function AppFrame({
  children,
  wide = false,
}: {
  readonly children: ReactNode;
  readonly wide?: boolean;
}) {
  return (
    <main
      data-testid="app-frame"
      className={`mx-auto min-h-dvh w-full px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-6 ${wide ? "max-w-[960px]" : "max-w-3xl"}`}
    >
      {children}
    </main>
  );
}
