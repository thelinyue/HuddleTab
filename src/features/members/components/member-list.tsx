"use client";

import { useState, type FormEvent } from "react";

const roleLabels = { OWNER: "Owner", ADMIN: "管理员", MEMBER: "成员" } as const;

export type MemberListRow = {
  readonly id: string;
  readonly displayName: string;
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
  readonly status: "ACTIVE" | "LEFT";
  readonly memberType: "USER" | "GUEST";
  readonly permissions: { readonly canManage: boolean };
};

/** 成员页始终以 ActivityMember 展示身份；管理命令只出现于服务端已授权的活动管理者。 */
export function MemberList({ members, onAddGuest, onRemove }: {
  readonly members: readonly MemberListRow[];
  readonly onAddGuest?: (displayName: string) => Promise<void>;
  readonly onRemove?: (memberId: string) => Promise<void>;
}) {
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const canManage = members.some((member) => member.permissions.canManage);
  async function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onAddGuest || !guestName.trim()) return;
    setError(null);
    try {
      await onAddGuest(guestName.trim());
      setGuestName("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "添加临时成员失败，请稍后重试。");
    }
  }
  return <section aria-label="成员">
    <header className="flex items-center justify-between gap-4 py-5">
      <h1 className="text-2xl font-bold">成员</h1>
      {canManage && onAddGuest ? <button type="button" className="min-h-11 border px-3 text-sm" onClick={() => document.getElementById("guest-name")?.focus()}>添加临时成员</button> : null}
    </header>
    {canManage && onAddGuest ? <form className="mb-4 flex gap-2" onSubmit={(event) => void addGuest(event)}><label className="sr-only" htmlFor="guest-name">临时成员昵称</label><input id="guest-name" value={guestName} onChange={(event) => setGuestName(event.target.value)} className="min-h-11 min-w-0 flex-1 border bg-background px-3" placeholder="临时成员昵称" required /><button type="submit" className="min-h-11 border px-3 text-sm">添加</button></form> : null}
    {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
    <div>{members.map((member) => <div key={member.id} className="flex min-h-16 items-center justify-between gap-4 border-b py-3"><div><strong>{member.displayName}</strong><p className="mt-1 text-sm text-muted-foreground">{roleLabels[member.role]} · <span>{member.memberType === "USER" ? "正式账号" : "临时成员"}</span></p></div><div className="flex items-center gap-2"><span className="text-sm">{member.status === "LEFT" ? "已退出" : "活动中"}</span>{member.permissions.canManage && member.role !== "OWNER" && member.status === "ACTIVE" && onRemove ? <button type="button" className="min-h-11 border px-3 text-sm text-destructive" aria-label={`移除 ${member.displayName}`} onClick={() => void onRemove(member.id)}>移除</button> : null}</div></div>)}</div>
  </section>;
}
