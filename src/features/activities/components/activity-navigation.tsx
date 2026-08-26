"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

const sections = [
  { id: "feed", suffix: "", label: "流水" },
  { id: "settlements", suffix: "/settlements", label: "结算" },
  { id: "members", suffix: "/members", label: "成员" },
  { id: "more", suffix: "/more", label: "更多" },
] as const;

/**
 * 活动内导航始终以 URL 表达视图状态。它不承担权限判断，页面内的服务端数据与操作入口
 * 再按授权结果渲染，保证历史链接、刷新与浏览器返回都有一致结果。
 */
export function ActivityNavigation() {
  const pathname = usePathname();
  const { activityId } = useParams<{ activityId: string }>();
  const basePath = `/activities/${activityId}`;
  return (
    <nav aria-label="活动导航" className="border-b">
      <ul className="grid grid-cols-4">
        {sections.map((section) => {
          const href = `${basePath}${section.suffix}`;
          const active =
            section.suffix === "" ? pathname === basePath : pathname === href;
          return (
            <li key={section.id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-11 items-center justify-center border-b-2 border-transparent px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-primary"
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
