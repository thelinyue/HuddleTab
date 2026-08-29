"use client";

import { BellIcon, UserRoundIcon, UsersRoundIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

import {
  motionDuration,
  motionEase,
  useMotionGSAP,
  useScopedResize,
} from "@/components/design-system/motion";
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
 * 一级导航只有产品的三个稳定入口。活动工作台及其表单、面板内隐藏本栏，避免与活动
 * 内部的流水/结算导航争夺注意力；离开活动后再恢复产品级导航。
 */
export function BottomNavigation({
  current,
  unreadCount,
}: {
  readonly current: TopLevelDestination;
  readonly unreadCount: number;
}) {
  const navigation = useRef<HTMLElement>(null);
  const previousUnreadCount = useRef(unreadCount);
  const repositionIndicator = useRef<(immediate: boolean) => void>(
    () => undefined,
  );

  useMotionGSAP(
    (reducedMotion) => {
      const positionCurrentIndicator = (immediate: boolean) => {
        const scope = navigation.current;
        const indicator = scope?.querySelector<HTMLElement>(
          "[data-navigation-indicator]",
        );
        const activeLink = scope?.querySelector<HTMLElement>(
          "a[aria-current=page]",
        );
        const indicatorParent = indicator?.parentElement;
        if (!indicator || !activeLink || !indicatorParent) return;
        const activeBounds = activeLink.getBoundingClientRect();
        const parentBounds = indicatorParent.getBoundingClientRect();
        const position = { x: activeBounds.left - parentBounds.left };
        if (reducedMotion || immediate) {
          gsap.set(indicator, position);
          gsap.set(activeLink, { scale: 1 });
          return;
        }
        gsap.to(indicator, {
          ...position,
          duration: motionDuration.brief,
          ease: motionEase.enter,
          overwrite: "auto",
        });
        gsap.fromTo(
          activeLink,
          { scale: 0.98 },
          {
            scale: 1,
            duration: motionDuration.brief,
            ease: motionEase.emphasis,
            overwrite: "auto",
          },
        );
      };
      repositionIndicator.current = positionCurrentIndicator;
      positionCurrentIndicator(false);

      const scope = navigation.current;
      const unreadIndicator = scope?.querySelector<HTMLElement>("[data-unread-indicator]");
      if (unreadCount > 0 && previousUnreadCount.current === 0 && unreadIndicator) {
        if (reducedMotion) {
          gsap.set(unreadIndicator, { scale: 1 });
        } else {
          gsap.fromTo(
            unreadIndicator,
            { scale: 0 },
            { scale: 1, duration: motionDuration.brief, ease: motionEase.emphasis },
          );
        }
      }
      previousUnreadCount.current = unreadCount;
    },
    {
      dependencies: [current, unreadCount],
      revertOnUpdate: false,
      scope: navigation,
    },
  );
  useScopedResize(navigation, () => repositionIndicator.current(true));

  return (
    <nav
      ref={navigation}
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[800px] border-t border-border/70 bg-surface/98 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="relative">
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
                      data-unread-indicator
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
        <span
          aria-hidden="true"
          data-navigation-indicator
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-1/3 bg-primary"
        />
      </div>
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
  const isInsideActivity = /^\/activities\/[^/]+(?:\/.*)?$/.test(pathname);
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
    if (isInsideActivity) return;
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
  }, [isInsideActivity, pathname]);
  if (isInsideActivity) return null;
  return (
    <BottomNavigation
      current={currentDestination(pathname)}
      unreadCount={currentUnreadCount}
    />
  );
}
