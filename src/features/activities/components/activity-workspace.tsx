"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { ExpenseFeedLoader } from "@/features/expenses/components/expense-loaders";
import { SettlementPageLoader } from "@/features/settlements/components/settlement-page-loader";
import { MemberPageLoader } from "@/features/members/components/member-page-loader";
import { ActivityMore } from "@/features/activities/components/activity-more";

function withoutPanel(searchParams: { readonly toString: () => string }) {
  const next = new URLSearchParams(searchParams.toString());
  next.delete("panel");
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
  const tab = searchParams.get("tab") === "settlement" ? "settlement" : "feed";
  const panel = searchParams.get("panel");

  useEffect(() => {
    const markPanelOpen = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === "members" || detail === "manage") {
        openedPanel.current = detail;
      }
    };
    window.addEventListener("huddletab:panel-open", markPanelOpen);
    return () => {
      window.removeEventListener("huddletab:panel-open", markPanelOpen);
    };
  }, []);

  const closePanel = () => {
    const nextUrl = `/activities/${encodeURIComponent(activityId)}${withoutPanel(searchParams)}`;
    if (openedPanel.current === panel) {
      openedPanel.current = null;
      router.back();
      return;
    }
    router.replace(nextUrl, { scroll: false });
  };

  return (
    <>
      {tab === "settlement" ? (
        <SettlementPageLoader timeZone={timeZone} />
      ) : (
        <ExpenseFeedLoader timeZone={timeZone} />
      )}

      <ResponsiveFormOverlay
        open={panel === "members"}
        onOpenChange={(open) => {
          if (!open) closePanel();
        }}
        title="成员"
        mobileFullScreen
      >
        <MemberPageLoader embedded />
      </ResponsiveFormOverlay>

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
    </>
  );
}

export { withoutPanel };
