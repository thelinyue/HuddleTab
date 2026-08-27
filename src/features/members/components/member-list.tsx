"use client";

import { useState, type FormEvent } from "react";

import { AppHeader } from "@/components/design-system/app-header";
import { EmptyState } from "@/components/design-system/empty-state";
import { MemberAvatar } from "@/components/design-system/member-avatar";
import { StatusBadge } from "@/components/design-system/status-badge";
import { UserRoundPlusIcon, UsersIcon } from "lucide-react";

const roleLabels = {
  OWNER: "所有者",
  ADMIN: "管理员",
  MEMBER: "成员",
} as const;

export type MemberListRow = {
  readonly id: string;
  readonly displayName: string;
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
  readonly status: "ACTIVE" | "LEFT";
  readonly memberType: "USER" | "GUEST";
  readonly permissions: { readonly canManage: boolean };
};

/** 成员页始终以 ActivityMember 展示身份；管理命令只出现于服务端已授权的活动管理者。 */
export function MemberList({
  members,
  onAddGuest,
  onRemove,
}: {
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
      setError(
        reason instanceof Error
          ? reason.message
          : "添加临时成员失败，请稍后重试。",
      );
    }
  }
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const leftMembers = members.filter((member) => member.status === "LEFT");
  const renderMember = (member: MemberListRow) => (
    <li
      key={member.id}
      className="flex min-h-16 items-center justify-between gap-4 border-b py-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <MemberAvatar memberId={member.id} displayName={member.displayName} />
        <div className="min-w-0">
          <strong>{member.displayName}</strong>
          <p className="mt-1 text-sm text-muted-foreground">
            {member.memberType === "USER" ? "正式账号" : "临时成员"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge tone="neutral" icon="info">
          {roleLabels[member.role]}
        </StatusBadge>
        <StatusBadge
          tone={member.status === "ACTIVE" ? "success" : "neutral"}
          icon={member.status === "ACTIVE" ? "success" : "info"}
        >
          {member.status === "ACTIVE" ? "活动中" : "已退出"}
        </StatusBadge>
        {member.permissions.canManage &&
        member.role !== "OWNER" &&
        member.status === "ACTIVE" &&
        onRemove ? (
          <button
            type="button"
            className="min-h-11 border px-3 text-sm text-destructive"
            aria-label={`移除 ${member.displayName}`}
            onClick={() => void onRemove(member.id)}
          >
            移除
          </button>
        ) : null}
      </div>
    </li>
  );
  return (
    <section aria-label="成员">
      <AppHeader
        title="成员"
        actions={
          canManage && onAddGuest ? (
            <button
              type="button"
              className="min-h-11 border px-3 text-sm"
              onClick={() => document.getElementById("guest-name")?.focus()}
            >
              添加临时成员
            </button>
          ) : undefined
        }
      />
      {canManage && onAddGuest ? (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => void addGuest(event)}
        >
          <label className="sr-only" htmlFor="guest-name">
            临时成员昵称
          </label>
          <input
            id="guest-name"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            className="min-h-11 min-w-0 flex-1 border bg-background px-3"
            placeholder="临时成员昵称"
            required
          />
          <button type="submit" className="min-h-11 border px-3 text-sm">
            添加
          </button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <section className="mt-6" aria-labelledby="active-members-heading">
        <h2 id="active-members-heading" className="text-lg font-semibold">
          活动中
        </h2>
        {activeMembers.length ? (
          <ul>{activeMembers.map(renderMember)}</ul>
        ) : (
          <EmptyState
            icon={UserRoundPlusIcon}
            title="没有活动中成员"
            description="添加临时成员后会显示在这里。"
          />
        )}
      </section>
      <section className="mt-6" aria-labelledby="left-members-heading">
        <h2 id="left-members-heading" className="text-lg font-semibold">
          已退出
        </h2>
        {leftMembers.length ? (
          <ul>{leftMembers.map(renderMember)}</ul>
        ) : (
          <EmptyState
            icon={UsersIcon}
            title="没有已退出成员"
            description="退出活动的成员会保留在这里供账务查阅。"
          />
        )}
      </section>
    </section>
  );
}
