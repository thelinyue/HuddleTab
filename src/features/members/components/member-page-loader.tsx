"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MemberList } from "@/features/members/components/member-list";

type Member = Parameters<typeof MemberList>[0]["members"][number];
export function MemberPageLoader() {
  const { activityId } = useParams<{ activityId: string }>();
  const [members, setMembers] = useState<readonly Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    void fetch(`/api/activities/${activityId}/members`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("成员列表加载失败，请稍后重试。");
        return (await response.json()).data as readonly Member[];
      })
      .then(setMembers)
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
  if (!members)
    return <p className="py-8 text-muted-foreground">正在加载成员…</p>;
  const request = async (url: string, init: RequestInit) => {
    const response = await fetch(url, init);
    if (response.ok) return;
    const body = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined;
    throw new Error(body?.error?.message ?? "成员操作失败，请稍后重试。");
  };
  return <MemberList members={members} onAddGuest={async (displayName) => { await request(`/api/activities/${activityId}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ displayName }) }); load(); }} onRemove={async (memberId) => { await request(`/api/activities/${activityId}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" }); load(); }} />;
}
