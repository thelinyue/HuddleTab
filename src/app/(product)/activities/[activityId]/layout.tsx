import type { ReactNode } from "react";

/** 活动详情只提供共享页面容器；各页面头部负责呈现活动内导航。 */
export default function ActivityLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return <section className="min-w-0">{children}</section>;
}
