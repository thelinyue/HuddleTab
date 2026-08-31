import type { ReactNode } from "react";

/**
 * 活动详情由 Workspace 负责稳定 Header 与固定操作；这里退出外层位移动画，避免 transform
 * 改写 FAB 的 fixed containing block，导致宽屏按钮偏离 800px 工作区右侧。
 */
export default function ActivityLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <section data-page-reveal="false" className="min-w-0">
      {children}
    </section>
  );
}
