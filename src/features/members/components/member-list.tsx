"use client";

import { useState, type FormEvent } from "react";
import {
  ChevronRightIcon,
  Link2Icon,
  UserPlusIcon,
  UserRoundPlusIcon,
} from "lucide-react";

import { EmptyState } from "@/components/design-system/empty-state";
import { MemberAvatar } from "@/components/design-system/member-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { MemberBalance } from "@/features/members/components/member-balance";
import { MemberInviteDialog } from "@/features/members/components/member-invite-dialog";
import {
  identityLabel,
  MemberManagementSheet,
  MemberTags,
} from "@/features/members/components/member-management-sheet";

export type MemberListRow = {
  readonly id: string;
  readonly displayName: string;
  readonly role: "OWNER" | "ADMIN" | "MEMBER";
  readonly status: "ACTIVE" | "LEFT";
  readonly memberType: "USER" | "GUEST";
  readonly permissions: { readonly canManage: boolean };
};

/**
 * 成员页按“操作、活跃成员、邀请方式、已离开”组织。成员行本身只负责打开查看层，
 * 写操作集中在各自 Overlay 中，避免列表上的危险图标被误触。
 */
export function MemberList({
  members,
  inviteMode,
  onAddGuest,
  onCreateInvite,
  onDisableInvite,
  onRemove,
  balances = [],
  currency = "CNY",
}: {
  readonly members: readonly MemberListRow[];
  readonly inviteMode: "DIRECT_JOIN" | "REQUIRE_APPROVAL";
  readonly onAddGuest?: (displayName: string) => Promise<void>;
  readonly onCreateInvite?: () => Promise<string>;
  readonly onDisableInvite?: () => Promise<void>;
  readonly onRemove?: (memberId: string) => Promise<void>;
  readonly balances?: readonly {
    readonly memberId: string;
    readonly netMinor: string;
  }[];
  readonly currency?: string;
}) {
  const [guestName, setGuestName] = useState("");
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestSubmitting, setGuestSubmitting] = useState(false);
  const [isGuestOpen, setIsGuestOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberListRow | null>(
    null,
  );
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const canManage = members.some((member) => member.permissions.canManage);
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const leftMembers = members.filter((member) => member.status === "LEFT");
  const balancesByMemberId = new Map(
    balances.map((balance) => [balance.memberId, BigInt(balance.netMinor)]),
  );

  async function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onAddGuest || !guestName.trim() || guestSubmitting) return;
    setGuestSubmitting(true);
    setGuestError(null);
    try {
      await onAddGuest(guestName.trim());
      setGuestName("");
      setIsGuestOpen(false);
    } catch (reason) {
      setGuestError(
        reason instanceof Error
          ? reason.message
          : "添加临时成员失败，请稍后重试。",
      );
    } finally {
      setGuestSubmitting(false);
    }
  }

  async function createInvite() {
    if (!onCreateInvite || inviteLoading) return;
    setInviteLoading(true);
    setInviteError(null);
    try {
      const path = await onCreateInvite();
      setInviteUrl(new URL(path, window.location.origin).toString());
    } catch (reason) {
      setInviteError(
        reason instanceof Error
          ? reason.message
          : "邀请链接生成失败，请稍后重试。",
      );
    } finally {
      setInviteLoading(false);
    }
  }

  async function openInvite() {
    setIsInviteOpen(true);
    if (!inviteUrl) await createInvite();
  }

  async function disableInvite() {
    if (!onDisableInvite) return;
    setInviteLoading(true);
    setInviteError(null);
    try {
      await onDisableInvite();
      setInviteUrl(null);
      setIsInviteOpen(false);
    } catch (reason) {
      setInviteError(
        reason instanceof Error
          ? reason.message
          : "邀请链接关闭失败，请稍后重试。",
      );
    } finally {
      setInviteLoading(false);
    }
  }

  const renderMember = (member: MemberListRow) => {
    const balance = balancesByMemberId.get(member.id) ?? 0n;
    return (
      <li key={member.id} className="border-b last:border-b-0">
        <button
          type="button"
          aria-label={`查看成员 ${member.displayName}`}
          className="grid min-h-[68px] w-full grid-cols-[40px_minmax(0,1fr)_auto_16px] items-center gap-3 py-2 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:bg-muted/45"
          onClick={() => setSelectedMember(member)}
        >
          <MemberAvatar memberId={member.id} displayName={member.displayName} />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <strong className="truncate text-sm font-semibold text-foreground">
                {member.displayName}
              </strong>
              <span className="flex shrink-0 items-center gap-1">
                <MemberTags member={member} />
              </span>
            </span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {identityLabel(member)}
            </span>
          </span>
          <MemberBalance
            netMinor={balance}
            currency={currency}
            className="justify-self-end"
          />
          <ChevronRightIcon
            data-testid="member-row-chevron"
            aria-hidden="true"
            className="size-4 text-muted-foreground/70"
          />
        </button>
      </li>
    );
  };

  return (
    <section aria-label="成员" className="pt-5">
      {canManage && (onCreateInvite || onAddGuest) ? (
        <div
          role="group"
          aria-label="成员操作"
          className="grid grid-cols-2 gap-3"
        >
          {onCreateInvite ? (
            <Button
              type="button"
              size="lg"
              className="h-12 w-full rounded-xl"
              onClick={() => void openInvite()}
            >
              <UserPlusIcon aria-hidden="true" className="size-5" />
              邀请成员
            </Button>
          ) : (
            <span />
          )}
          {onAddGuest ? (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="h-12 w-full rounded-xl"
              onClick={() => {
                setGuestError(null);
                setIsGuestOpen(true);
              }}
            >
              <UserRoundPlusIcon aria-hidden="true" className="size-5" />
              添加临时成员
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="mt-8" aria-labelledby="active-members-heading">
        <h2 id="active-members-heading" className="text-base font-semibold">
          活动成员 · {activeMembers.length}人
        </h2>
        {activeMembers.length ? (
          <ul
            aria-labelledby="active-members-heading"
            className="mt-2 divide-y border-t"
          >
            {activeMembers.map(renderMember)}
          </ul>
        ) : (
          <EmptyState
            icon={UserRoundPlusIcon}
            title="没有活动中成员"
            description="添加成员后会显示在这里。"
          />
        )}
      </section>

      {canManage && onCreateInvite && onDisableInvite ? (
        <section className="mt-8" aria-labelledby="invite-method-heading">
          <h2 id="invite-method-heading" className="text-base font-semibold">
            邀请方式
          </h2>
          <button
            type="button"
            aria-label="链接加入"
            className="mt-2 grid min-h-[72px] w-full grid-cols-[44px_minmax(0,1fr)_16px] items-center gap-3 border-y py-3 text-left transition-colors hover:bg-muted/45 focus-visible:bg-muted/45"
            onClick={() => void openInvite()}
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Link2Icon aria-hidden="true" className="size-5" />
            </span>
            <span className="min-w-0">
              <strong className="block text-sm font-semibold">链接加入</strong>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                {inviteMode === "DIRECT_JOIN" ? "直接加入" : "需管理员审批"}
              </span>
            </span>
            <ChevronRightIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground/70"
            />
          </button>
        </section>
      ) : null}

      {leftMembers.length ? (
        <section className="mt-8" aria-labelledby="left-members-heading">
          <h2 id="left-members-heading" className="text-base font-semibold">
            已离开 · {leftMembers.length}人
          </h2>
          <ul
            aria-labelledby="left-members-heading"
            className="mt-2 divide-y border-t"
          >
            {leftMembers.map(renderMember)}
          </ul>
        </section>
      ) : null}

      <ResponsiveFormOverlay
        open={isGuestOpen}
        onOpenChange={setIsGuestOpen}
        title="添加临时成员"
      >
        <form
          className="grid gap-4 pt-2"
          onSubmit={(event) => void addGuest(event)}
        >
          <div className="grid gap-2">
            <Label htmlFor="guest-name">临时成员昵称</Label>
            <Input
              id="guest-name"
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              placeholder="请输入昵称"
              required
              autoFocus
            />
          </div>
          {guestError ? (
            <p role="alert" className="text-sm text-destructive">
              {guestError}
            </p>
          ) : null}
          <Button type="submit" disabled={guestSubmitting}>
            {guestSubmitting ? "添加中…" : "确认添加"}
          </Button>
        </form>
      </ResponsiveFormOverlay>

      {onCreateInvite && onDisableInvite ? (
        <MemberInviteDialog
          open={isInviteOpen}
          onOpenChange={setIsInviteOpen}
          inviteUrl={inviteUrl}
          loading={inviteLoading}
          error={inviteError}
          onRegenerate={createInvite}
          onDisable={disableInvite}
        />
      ) : null}

      {selectedMember ? (
        <MemberManagementSheet
          key={selectedMember.id}
          member={selectedMember}
          open
          onOpenChange={(open) => {
            if (!open) setSelectedMember(null);
          }}
          onRemove={onRemove}
          balanceMinor={balancesByMemberId.get(selectedMember.id) ?? 0n}
          currency={currency}
        />
      ) : null}
    </section>
  );
}
