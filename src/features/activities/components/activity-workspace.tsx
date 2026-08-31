"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { ExpenseFeedLoader } from "@/features/expenses/components/expense-loaders";
import { SettlementPageLoader } from "@/features/settlements/components/settlement-page-loader";
import { MemberPageLoader } from "@/features/members/components/member-page-loader";
import { ActivityMore } from "@/features/activities/components/activity-more";
import { ActivityPageHeader } from "@/features/activities/components/activity-page-header";
import type { ActivityWorkspaceHeaderData } from "@/features/activities/components/activity-workspace-header-data";

function withoutPanel(searchParams: { readonly toString: () => string }) {
  const next = new URLSearchParams(searchParams.toString());
  next.delete("panel");
  next.delete("invite");
  const query = next.toString();
  return query ? `?${query}` : "";
}

function withoutInvite(searchParams: {
  readonly has: (name: string) => boolean;
  readonly toString: () => string;
}) {
  const next = new URLSearchParams(searchParams.toString());
  next.delete("invite");
  const query = next.toString();
  return query ? `?${query}` : "";
}

/**
 * 活动工作台只根据 URL 决定两种主视图和两个低频面板。主视图保持独立加载器，
 * 面板关闭只移除 panel 参数，因此不会丢失当前 Tab 或刷新整个活动上下文。
 */
export function ActivityWorkspace({ timeZone }: { readonly timeZone: string }) {
  const { activityId } = useParams<{ activityId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const openedPanel = useRef<string | null>(null);
  const [membersInitialView, setMembersInitialView] = useState<
    "list" | "invite"
  >("list");
  const [headerData, setHeaderData] =
    useState<ActivityWorkspaceHeaderData | null>(null);
  const tab = searchParams.get("tab") === "settlement" ? "settlement" : "feed";
  const panel = searchParams.get("panel");

  /**
   * 头部事实由当前可见加载器回传。activityId 校验同时抵御延迟请求和旧组件回调，
   * 配合下面的 render 校验，活动切换首帧也绝不会借用上一个活动的名称或成员数。
   */
  const handleHeaderData = useCallback(
    (next: ActivityWorkspaceHeaderData) => {
      if (next.activityId !== activityId) return;
      setHeaderData(next);
    },
    [activityId],
  );
  const visibleHeaderData =
    headerData?.activityId === activityId ? headerData : null;

  useEffect(() => {
    const markPanelOpen = (event: Event) => {
      const detail = (
        event as CustomEvent<
          | string
          | {
              readonly panel: "members" | "manage";
              readonly initialView?: "list" | "invite";
            }
        >
      ).detail;
      if (typeof detail === "string") {
        if (detail === "members" || detail === "manage") {
          openedPanel.current = detail;
          if (detail === "members") setMembersInitialView("list");
        }
        return;
      }
      if (detail?.panel === "members" || detail?.panel === "manage") {
        openedPanel.current = detail.panel;
        if (detail.panel === "members") {
          setMembersInitialView(detail.initialView ?? "list");
        }
      }
    };
    window.addEventListener("huddletab:panel-open", markPanelOpen);
    return () => {
      window.removeEventListener("huddletab:panel-open", markPanelOpen);
    };
  }, []);

  useEffect(() => {
    if (panel === "members") return;
    // 成员 Sheet 关闭后清空上一次会话的本地首视图，重新打开必须从根视图开始。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMembersInitialView("list");
  }, [panel]);

  useEffect(() => {
    if (!searchParams.has("invite")) return;
    // 旧链接中的 invite 仅做一次兼容清理，内部子视图始终由本地状态管理。
    router.replace(
      `/activities/${encodeURIComponent(activityId)}${withoutInvite(searchParams)}`,
      { scroll: false },
    );
  }, [activityId, router, searchParams]);

  const closePanel = () => {
    const nextUrl = `/activities/${encodeURIComponent(activityId)}${withoutPanel(searchParams)}`;
    if (openedPanel.current === panel) {
      openedPanel.current = null;
      if (panel === "members") setMembersInitialView("list");
      router.back();
      return;
    }
    router.replace(nextUrl, { scroll: false });
  };

  /**
   * 这个节点跨流水/结算两个 URL query 视图保持稳定，统一承载安全区、视口高度、边距和
   * surface；子加载器只替换内部内容，避免各页面重复声明根背景或触发外壳级入场动效。
   */
  return (
    <section
      data-testid="activity-workspace-surface"
      data-page-reveal="false"
      className="-mx-4 -mt-[calc(1rem+env(safe-area-inset-top))] flex min-h-dvh min-w-0 flex-col bg-workspace px-4 pt-[calc(1rem+env(safe-area-inset-top))] min-[481px]:-mx-6 min-[481px]:px-6"
    >
      {visibleHeaderData ? (
        <ActivityPageHeader
          {...visibleHeaderData}
          activeTab={tab}
        />
      ) : null}
      {tab === "settlement" ? (
        <SettlementPageLoader
          key={`settlement:${activityId}`}
          timeZone={timeZone}
          onHeaderData={handleHeaderData}
        />
      ) : (
        <ExpenseFeedLoader
          key={`feed:${activityId}`}
          timeZone={timeZone}
          onHeaderData={handleHeaderData}
        />
      )}

      {panel === "members" ? (
        <MemberPageLoader
          embedded
          open
          initialView={membersInitialView}
          onOpenChange={(open) => {
            if (!open) closePanel();
          }}
        />
      ) : null}

      <ResponsiveFormOverlay
        open={panel === "manage"}
        onOpenChange={(open) => {
          if (!open) closePanel();
        }}
        title="活动管理"
        mobileFullScreen
      >
        <ActivityMore embedded />
      </ResponsiveFormOverlay>
    </section>
  );
}

export { withoutPanel };
