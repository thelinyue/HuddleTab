"use client";

import { BellIcon, UserRoundIcon, UsersRoundIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type TopLevelDestination = "activities" | "notifications" | "me";

const items = [
  { id: "activities", href: "/activities", label: "活动", Icon: UsersRoundIcon },
  { id: "notifications", href: "/notifications", label: "通知", Icon: BellIcon },
  { id: "me", href: "/me", label: "我的", Icon: UserRoundIcon },
] as const;

function currentDestination(pathname: string): TopLevelDestination {
  if (pathname.startsWith("/notifications")) return "notifications";
  if (pathname.startsWith("/me")) return "me";
  return "activities";
}

/**
 * 一级导航只有产品的三个稳定入口。活动详情由 `ProductNavigation` 隐藏本栏，改由活动内
 * 导航接管；宽屏仍使用同一条居中栏而不是扩展为侧边栏，避免信息架构随设备变化。
 */
export function BottomNavigation({
  current,
  unreadCount,
}: {
  readonly current: TopLevelDestination;
  readonly unreadCount: number;
}) {
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[800px] border-t border-border/80 bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-3">
        {items.map(({ id, href, label, Icon }) => {
          const notificationLabel =
            id === "notifications" && unreadCount > 0
              ? `通知，${unreadCount} 条未读`
              : label;
          return (
            <li key={id}>
              <Link
                href={href}
                aria-current={current === id ? "page" : undefined}
                aria-label={notificationLabel}
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 border-t-2 border-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-primary/5 aria-[current=page]:text-primary"
              >
                <Icon aria-hidden="true" className="size-5" />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 以当前 URL 决定一级导航状态，避免每个服务器页面重复传递导航状态。 */
export function ProductNavigation({
  unreadCount = 0,
}: {
  readonly unreadCount?: number;
}) {
  const pathname = usePathname();
  const isInsideActivity = /^\/activities\/[^/]+(?:\/|$)/.test(pathname);
  const [currentUnreadCount, setCurrentUnreadCount] = useState(unreadCount);
  useEffect(() => {
    if (isInsideActivity) return;
    void fetch("/api/notifications", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as {
          data?: { unreadCount?: number };
        };
        if (typeof body.data?.unreadCount === "number")
          setCurrentUnreadCount(body.data.unreadCount);
      })
      .catch(() => undefined);
  }, [isInsideActivity]);
  if (isInsideActivity) return null;
  return (
    <BottomNavigation
      current={currentDestination(pathname)}
      unreadCount={currentUnreadCount}
    />
  );
}
