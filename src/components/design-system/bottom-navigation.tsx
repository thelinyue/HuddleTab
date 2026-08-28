"use client";

import { BellIcon, UserRoundIcon, UsersRoundIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { NOTIFICATION_UNREAD_COUNT_EVENT } from "@/lib/notification-unread-count";

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
 * 一级导航只有产品的三个稳定入口。流水根页保留本栏，便于返回产品主路径；更深的活动
 * 页面仍保留本栏；活动内页签只负责二级跳转，不会替代回到产品入口的能力。
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
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[800px] border-t border-border/70 bg-surface/98 pb-[env(safe-area-inset-bottom)]"
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
                className="flex min-h-14 flex-col items-center justify-center gap-0.5 px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground aria-[current=page]:text-primary"
              >
                <span className="relative">
                  <Icon aria-hidden="true" className="size-5" />
                  {id === "notifications" && unreadCount > 0 ? (
                    <span
                      aria-hidden="true"
                      className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-primary"
                    />
                  ) : null}
                </span>
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
  const isActivityFeedRoot = /^\/activities\/[^/]+$/.test(pathname);
  const isInsideActivitySubpage = /^\/activities\/[^/]+\/.+/.test(pathname);
  const [currentUnreadCount, setCurrentUnreadCount] = useState(unreadCount);
  const unreadCountVersion = useRef(0);
  useEffect(() => {
    const syncUnreadCount = (event: Event) => {
      const nextCount = (event as CustomEvent<number>).detail;
      if (Number.isInteger(nextCount) && nextCount >= 0) {
        unreadCountVersion.current += 1;
        setCurrentUnreadCount(nextCount);
      }
    };
    window.addEventListener(NOTIFICATION_UNREAD_COUNT_EVENT, syncUnreadCount);
    return () =>
      window.removeEventListener(
        NOTIFICATION_UNREAD_COUNT_EVENT,
        syncUnreadCount,
      );
  }, []);
  useEffect(() => {
    // 流水根页沿用进入活动前的未读数；返回一级页面时再刷新，避免无意义的重复请求。
    if (isInsideActivitySubpage || isActivityFeedRoot) return;
    const requestVersion = unreadCountVersion.current + 1;
    unreadCountVersion.current = requestVersion;
    void fetch("/api/notifications", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as {
          data?: { unreadCount?: number };
        };
        if (
          typeof body.data?.unreadCount === "number" &&
          unreadCountVersion.current === requestVersion
        )
          setCurrentUnreadCount(body.data.unreadCount);
      })
      .catch(() => undefined);
  }, [isActivityFeedRoot, isInsideActivitySubpage, pathname]);
  return (
    <BottomNavigation
      current={currentDestination(pathname)}
      unreadCount={currentUnreadCount}
    />
  );
}
