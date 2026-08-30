"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MemberList } from "@/features/members/components/member-list";
import { ActivityPageHeader } from "@/features/activities/components/activity-page-header";
import type { SettlementPageContextDto } from "@/features/settlements/api";

type Member = Parameters<typeof MemberList>[0]["members"][number];
type ActivitySummary = {
  readonly activityName: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly memberCount: number;
};
export function MemberPageLoader({
  embedded = false,
}: {
  readonly embedded?: boolean;
}) {
  const { activityId } = useParams<{ activityId: string }>();
  const [members, setMembers] = useState<readonly Member[] | null>(null);
  const [inviteMode, setInviteMode] = useState<
    "DIRECT_JOIN" | "REQUIRE_APPROVAL" | null
  >(null);
  const [settlementContext, setSettlementContext] =
    useState<SettlementPageContextDto | null>(null);
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
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
        return [
          membersBody.data,
          membersBody.meta.inviteMode,
          contextBody.data,
          summaryBody.data,
        ] as const;
      })
      .then(([nextMembers, nextInviteMode, nextContext, nextSummary]) => {
        setMembers(nextMembers);
        setInviteMode(nextInviteMode);
        setSettlementContext(nextContext);
        setSummary(nextSummary);
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "成员列表加载失败，请稍后重试。",
        ),
      );
  };
  useEffect(load, [activityId]);
  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!members || !inviteMode || !settlementContext || !summary)
    return <p className="py-8 text-muted-foreground">正在加载成员…</p>;
  const request = async (url: string, init: RequestInit) => {
    const response = await fetch(url, init);
    if (response.ok) return;
    const body = (await response.json().catch(() => undefined)) as
      { error?: { message?: string } } | undefined;
    throw new Error(body?.error?.message ?? "成员操作失败，请稍后重试。");
  };
  const createInvite = async () => {
    const response = await fetch(
      `/api/activities/${activityId}/invitations/link`,
      { method: "POST" },
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
        />
      ) : null}
      <MemberList
        members={members}
        inviteMode={inviteMode}
        balances={settlementContext.balances}
        currency={settlementContext.activity.currency}
        onCreateInvite={createInvite}
        onDisableInvite={async () => {
          await request(`/api/activities/${activityId}/invitations/link`, {
            method: "DELETE",
          });
        }}
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
      />
    </>
  );
}
