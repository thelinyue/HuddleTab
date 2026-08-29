"use client";

import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { gsap } from "gsap";

import {
  motionDuration,
  motionEase,
  useMotionGSAP,
  useScopedResize,
} from "@/components/design-system/motion";

const sections = [
  { id: "feed", query: "", label: "流水" },
  { id: "settlement", query: "?tab=settlement", label: "结算" },
] as const;

/**
 * 活动内导航始终以 URL 表达视图状态。指示器只在本导航 DOM scope 内测量，并由 context
 * 在更新和卸载时回收；它是 aria-hidden 装饰，不会改变链接、触控尺寸或读屏导航语义。
 */
export function ActivityNavigation({
  activityId,
}: {
  readonly activityId?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useParams<{ activityId: string }>();
  const resolvedActivityId = activityId ?? params?.activityId;
  const navigation = useRef<HTMLElement>(null);
  const repositionIndicator = useRef<(immediate: boolean) => void>(
    () => undefined,
  );
  const currentTab = searchParams?.get("tab") === "settlement" ? "settlement" : "feed";
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
    },
    {
      dependencies: [pathname, resolvedActivityId, currentTab],
      revertOnUpdate: false,
      scope: navigation,
    },
  );
  useScopedResize(navigation, () => repositionIndicator.current(true));
  if (!resolvedActivityId) return null;
  const basePath = `/activities/${encodeURIComponent(resolvedActivityId)}`;
  return (
    <nav
      ref={navigation}
      aria-label="活动导航"
      className="border-b border-border/70 bg-transparent"
    >
      <div className="relative">
        <ul className="grid grid-cols-2">
          {sections.map(({ id, query, label }) => {
            const href = `${basePath}${query}`;
            const active = pathname === basePath && currentTab === id;
            return (
              <li key={id}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className="flex min-h-12 items-center justify-center border-b-2 border-transparent px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-primary"
                >
                  <span>{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <span
          aria-hidden="true"
          data-navigation-indicator
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 w-1/2 bg-primary"
        />
      </div>
    </nav>
  );
}
