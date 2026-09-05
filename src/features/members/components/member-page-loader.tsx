"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MemberList } from "@/features/members/components/member-list";
import { ActivityPageHeader } from "@/features/activities/components/activity-page-header";
import type { SettlementPageContextDto } from "@/features/settlements/api";
import { NavigationOverlay } from "@/components/ui/navigation-overlay";

type Member = Parameters<typeof MemberList>[0]["members"][number];
type ActivitySummary = {
  readonly activityName: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly memberCount: number;
};
export function MemberPageLoader({
  embedded = false,
  open = true,
  initialView = "list",
  onOpenChange,
}: {
  readonly embedded?: boolean;
  readonly open?: boolean;
  readonly initialView?: "list" | "invite";
  readonly onOpenChange?: (open: boolean) => void;
}) {
  const { activityId } = useParams<{ activityId: string }>();
  const [members, setMembers] = useState<readonly Member[] | null>(null);
  const [inviteMode, setInviteMode] = useState<
    "DIRECT_JOIN" | "REQUIRE_APPROVAL" | null
  >(null);
  const [inviteEnabled, setInviteEnabled] = useState(false);
  const [inviteStatusError, setInviteStatusError] = useState<string | null>(
    null,
  );
  const [settlementContext, setSettlementContext] =
    useState<SettlementPageContextDto | null>(null);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 嵌入工作台时由 URL 控制；独立测试/复用场景没有回调时由本地状态兜底。
  const [localEmbeddedOpen, setLocalEmbeddedOpen] = useState(true);
  const load = useCallback(() => {
    setError(null);
    setInviteStatusError(null);
    void Promise.all([
      fetch(`/api/activities/${activityId}/members`, { cache: "no-store" }),
      fetch(`/api/activities/${activityId}/settlements/context`, {
        cache: "no-store",
      }),
      fetch(`/api/activities/${activityId}/summary`, { cache: "no-store" }),
    ])
      .then(async ([membersResponse, contextResponse, summaryResponse]) => {
        if (!membersResponse.ok || !contextResponse.ok || !summaryResponse.ok)
          throw new Error("成员列表加载失败，请稍后重试。");
        const [membersBody, contextBody, summaryBody] = (await Promise.all([
          membersResponse.json(),
          contextResponse.json(),
          summaryResponse.json(),
        ])) as [
          {
            readonly data: readonly Member[];
            readonly meta: {
              readonly inviteMode: "DIRECT_JOIN" | "REQUIRE_APPROVAL";
            };
          },
          { readonly data: SettlementPageContextDto },
          { readonly data: ActivitySummary },
        ];
        const canManage = membersBody.data.some(
          (member) => member.permissions.canManage,
        );
        let nextInviteEnabled = false;
        let nextInviteStatusError: string | null = null;
        if (canManage && contextBody.data.activity.status === "ACTIVE") {
          try {
            const inviteResponse = await fetch(
              `/api/activities/${activityId}/invitations/link`,
              { cache: "no-store" },
            );
            if (!inviteResponse.ok) throw new Error("邀请状态读取失败。");
            const inviteBody = (await inviteResponse.json()) as {
              readonly data: { readonly enabled: boolean };
            };
            nextInviteEnabled = inviteBody.data.enabled;
          } catch {
            nextInviteStatusError = "邀请状态加载失败，请重试。";
          }
        }
        return [
          membersBody.data,
          membersBody.meta.inviteMode,
          contextBody.data,
          summaryBody.data,
          nextInviteEnabled,
          nextInviteStatusError,
        ] as const;
      })
      .then(
        ([
          nextMembers,
          nextInviteMode,
          nextContext,
          nextSummary,
          nextInviteEnabled,
          nextInviteStatusError,
        ]) => {
          setMembers(nextMembers);
          setInviteMode(nextInviteMode);
          setSettlementContext(nextContext);
          setSummary(nextSummary);
          setInviteEnabled(nextInviteEnabled);
          setInviteStatusError(nextInviteStatusError);
        },
      )
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "成员列表加载失败，请稍后重试。",
        ),
      );
  }, [activityId]);
  useEffect(() => {
    // 加载器需要在首次挂载时发起请求，并由请求结果更新各个加载状态。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const embeddedOpen = onOpenChange ? open : localEmbeddedOpen;
  const handleEmbeddedOpenChange = (nextOpen: boolean) => {
    if (!onOpenChange) setLocalEmbeddedOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const loadingContent = error ? (
    <p role="alert" className="py-8 text-destructive">
      {error}
    </p>
  ) : (
    <p className="py-8 text-muted-foreground">正在加载成员…</p>
  );
  if (error || !members || !inviteMode || !settlementContext || !summary) {
    if (!embedded) return loadingContent;
    return (
      <NavigationOverlay
        open={embeddedOpen}
        onOpenChange={handleEmbeddedOpenChange}
        title="成员"
        mobileFullScreen
      >
        {loadingContent}
      </NavigationOverlay>
    );
  }
  const request = async (url: string, init: RequestInit) => {
    const response = await fetch(url, init);
    if (response.ok) return;
    const body = (await response.json().catch(() => undefined)) as
      { error?: { message?: string } } | undefined;
    throw new Error(body?.error?.message ?? "成员操作失败，请稍后重试。");
  };
  const createInvite = async (replaceExisting = false) => {
    const response = await fetch(
      `/api/activities/${activityId}/invitations/link`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replaceExisting }),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        { error?: { message?: string } } | undefined;
      throw new Error(body?.error?.message ?? "邀请链接生成失败，请稍后重试。");
    }
    const body = (await response.json()) as {
      readonly data: { readonly invitePath: string };
    };
    return body.data.invitePath;
  };
  const canManageMembers =
    settlementContext.activity.status === "ACTIVE" &&
    members.some((member) => member.permissions.canManage);
  const retryInviteStatus = async () => {
    if (!canManageMembers || settlementContext.activity.status !== "ACTIVE")
      return;
    try {
      const response = await fetch(
        `/api/activities/${activityId}/invitations/link`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("邀请状态读取失败。");
      const body = (await response.json()) as {
        readonly data: { readonly enabled: boolean };
      };
      setInviteEnabled(body.data.enabled);
      setInviteStatusError(null);
    } catch {
      setInviteStatusError("邀请状态加载失败，请重试。");
    }
  };
  return (
    <>
      {!embedded ? (
        <ActivityPageHeader
          activityId={activityId}
          name={summary.activityName}
          startDate={summary.startDate}
          endDate={summary.endDate}
          memberCount={summary.memberCount}
          status={settlementContext.activity.status}
          canManageMembers={canManageMembers}
        />
      ) : null}
      <MemberList
        members={members}
        inviteMode={inviteMode}
        inviteEnabled={inviteEnabled}
        initialInviteOpen={false}
        initialView={
          initialView === "invite" && canManageMembers ? "invite" : "list"
        }
        inviteStatusError={inviteStatusError}
        onRetryInviteStatus={canManageMembers ? retryInviteStatus : undefined}
        balances={settlementContext.balances}
        currency={settlementContext.activity.currency}
        onCreateInvite={canManageMembers ? createInvite : undefined}
        onDisableInvite={
          canManageMembers
            ? async () => {
                await request(
                  `/api/activities/${activityId}/invitations/link`,
                  {
                    method: "DELETE",
                  },
                );
              }
            : undefined
        }
        onAddGuest={async (displayName) => {
          await request(`/api/activities/${activityId}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ displayName }),
          });
          load();
        }}
        onRemove={async (memberId) => {
          await request(
            `/api/activities/${activityId}/members/${encodeURIComponent(memberId)}`,
            { method: "DELETE" },
          );
          load();
        }}
        embedded={embedded}
        embeddedOpen={embeddedOpen}
        onEmbeddedOpenChange={embedded ? handleEmbeddedOpenChange : undefined}
      />
    </>
  );
}
