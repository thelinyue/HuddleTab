"use client";

import {
  HandCoinsIcon,
  MoreHorizontalIcon,
  ReceiptTextIcon,
  UsersRoundIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

const sections = [
  { id: "feed", suffix: "", label: "流水", Icon: ReceiptTextIcon },
  {
    id: "settlements",
    suffix: "/settlements",
    label: "结算",
    Icon: HandCoinsIcon,
  },
  { id: "members", suffix: "/members", label: "成员", Icon: UsersRoundIcon },
  { id: "more", suffix: "/more", label: "更多", Icon: MoreHorizontalIcon },
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
        {sections.map(({ id, suffix, label, Icon }) => {
          const href = `${basePath}${suffix}`;
          const active =
            suffix === "" ? pathname === basePath : pathname === href;
          return (
            <li key={id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-11 flex-col items-center justify-center gap-0.5 border-b-2 border-transparent px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-primary"
              >
                <Icon aria-hidden="true" className="size-4" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
