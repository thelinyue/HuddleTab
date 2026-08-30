"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ChevronRightIcon,
  UserPlusIcon,
  UserRoundPlusIcon,
} from "lucide-react";

import { EmptyState } from "@/components/design-system/empty-state";
import { MemberAvatar } from "@/components/design-system/member-avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NavigationOverlay } from "@/components/ui/navigation-overlay";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { useOnlineStatus } from "@/features/expenses/components/offline-status";
import type { AvatarPreset } from "@/features/me/avatar-presets";
import { MemberBalance } from "@/features/members/components/member-balance";
import { MemberInviteCenter } from "@/features/members/components/member-invite-center";
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
  readonly avatarPreset?: AvatarPreset | null;
  readonly permissions: { readonly canManage: boolean };
};

type EmbeddedView =
  | { readonly type: "list" }
  | { readonly type: "invite" }
  | { readonly type: "guest" }
  | { readonly type: "detail"; readonly member: MemberListRow };

/**
 * 成员页按“操作、活跃成员、已离开”组织。成员行本身只负责打开查看层，
 * 独立成员页沿用 Overlay，嵌入活动面板时则切换同一面板内的本地视图，避免焦点层级嵌套。
 */
export function MemberList({
  members,
  onAddGuest,
  onCreateInvite,
  inviteEnabled = false,
  initialInviteOpen = false,
  inviteStatusError = null,
  onRetryInviteStatus,
  onDisableInvite,
  onRemove,
  balances = [],
  currency = "CNY",
  embedded = false,
  embeddedOpen = true,
  onEmbeddedOpenChange,
  initialView,
}: {
  readonly members: readonly MemberListRow[];
  readonly inviteMode: "DIRECT_JOIN" | "REQUIRE_APPROVAL";
  readonly onAddGuest?: (displayName: string) => Promise<void>;
  readonly onCreateInvite?: (replaceExisting?: boolean) => Promise<string>;
  /** 服务端只返回是否有启用链接，明文永远不从服务端恢复。 */
  readonly inviteEnabled?: boolean;
  readonly initialInviteOpen?: boolean;
  /** 邀请状态读取失败时不允许把未知状态误判成“无链接”。 */
  readonly inviteStatusError?: string | null;
  readonly onRetryInviteStatus?: () => Promise<void>;
  readonly onDisableInvite?: () => Promise<void>;
  readonly onRemove?: (memberId: string) => Promise<void>;
  readonly balances?: readonly {
    readonly memberId: string;
    readonly netMinor: string;
  }[];
  readonly currency?: string;
  /** 嵌入活动面板时在同一 Sheet/Dialog 内切换子视图，避免再开嵌套 Overlay。 */
  readonly embedded?: boolean;
  /** 嵌入成员 Sheet 的开关由 URL 面板协调器传入，内部关闭时重置本地栈。 */
  readonly embeddedOpen?: boolean;
  readonly onEmbeddedOpenChange?: (open: boolean) => void;
  readonly initialView?: "list" | "invite";
}) {
  const [guestName, setGuestName] = useState("");
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestSubmitting, setGuestSubmitting] = useState(false);
  const [isGuestOpen, setIsGuestOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberListRow | null>(
    null,
  );
  const [isInviteOpen, setIsInviteOpen] = useState(
    initialInviteOpen && !embedded,
  );
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLocalState, setInviteLocalState] = useState<
    "ACTIVE" | "DISABLED" | null
  >(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [embeddedView, setEmbeddedView] = useState<EmbeddedView>(
    (initialView === "invite" || (initialInviteOpen && onCreateInvite)) &&
      onCreateInvite
      ? { type: "invite" }
      : { type: "list" },
  );
  const [embeddedRemoveOpen, setEmbeddedRemoveOpen] = useState(false);
  const [embeddedRemoving, setEmbeddedRemoving] = useState(false);
  const [embeddedRemoveError, setEmbeddedRemoveError] = useState<string | null>(
    null,
  );
  const [localEmbeddedOpen, setLocalEmbeddedOpen] = useState(true);
  const online = useOnlineStatus();
  const canEnterInvite = Boolean(onCreateInvite);
  const hasActiveInvite =
    inviteLocalState === null ? inviteEnabled : inviteLocalState === "ACTIVE";
  const canManage = members.some((member) => member.permissions.canManage);
  const activeMembers = members.filter((member) => member.status === "ACTIVE");
  const leftMembers = members.filter((member) => member.status === "LEFT");
  const balancesByMemberId = new Map(
    balances.map((balance) => [balance.memberId, BigInt(balance.netMinor)]),
  );

  useEffect(() => {
    if (!embedded || !embeddedOpen) return;
    // URL/入口事件只决定新会话的首个子视图，之后的 Back 由本地栈独立管理。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmbeddedView(
      initialView === "invite" && canEnterInvite
        ? { type: "invite" }
        : { type: "list" },
    );
  }, [embedded, embeddedOpen, initialView, canEnterInvite]);

  async function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onAddGuest || !guestName.trim() || guestSubmitting) return;
    setGuestSubmitting(true);
    setGuestError(null);
    try {
      await onAddGuest(guestName.trim());
      setGuestName("");
      if (embedded) setEmbeddedView({ type: "list" });
      else setIsGuestOpen(false);
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

  async function createInvite(replaceExisting = false) {
    if (!onCreateInvite || inviteLoading) return;
    setInviteLoading(true);
    setInviteError(null);
    setInviteNotice(null);
    try {
      const path = await onCreateInvite(replaceExisting);
      setInviteUrl(new URL(path, window.location.origin).toString());
      setInviteLocalState("ACTIVE");
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
    if (!embedded) setIsInviteOpen(true);
  }

  async function disableInvite() {
    if (!onDisableInvite) return;
    setInviteLoading(true);
    setInviteError(null);
    setInviteNotice(null);
    try {
      await onDisableInvite();
      setInviteUrl(null);
      setInviteLocalState("DISABLED");
      if (!embedded) setIsInviteOpen(false);
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

  async function removeEmbeddedMember() {
    if (
      !onRemove ||
      embeddedView.type !== "detail" ||
      !embeddedView.member.permissions.canManage ||
      embeddedView.member.status !== "ACTIVE" ||
      embeddedView.member.role === "OWNER" ||
      embeddedRemoving
    )
      return;
    setEmbeddedRemoving(true);
    setEmbeddedRemoveError(null);
    try {
      await onRemove(embeddedView.member.id);
      setEmbeddedRemoveOpen(false);
      setEmbeddedView({ type: "list" });
    } catch (reason) {
      setEmbeddedRemoveError(
        reason instanceof Error ? reason.message : "移除成员失败，请稍后重试。",
      );
    } finally {
      setEmbeddedRemoving(false);
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
          onClick={() => {
            if (embedded) setEmbeddedView({ type: "detail", member });
            else setSelectedMember(member);
          }}
        >
          <MemberAvatar
            memberId={member.id}
            displayName={member.displayName}
            avatarPreset={member.avatarPreset}
          />
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

  const embeddedMember =
    embeddedView.type === "detail" ? embeddedView.member : null;
  const embeddedRemovable = Boolean(
    embeddedMember &&
    onRemove &&
    embeddedMember.permissions.canManage &&
    embeddedMember.status === "ACTIVE" &&
    embeddedMember.role !== "OWNER",
  );
  const embeddedViewTitle =
    embeddedView.type === "invite"
      ? "邀请成员"
      : embeddedView.type === "guest"
        ? "添加临时成员"
        : (embeddedMember?.displayName ?? "成员详情");

  const handleEmbeddedOpenChange = (open: boolean) => {
    if (!onEmbeddedOpenChange) setLocalEmbeddedOpen(open);
    if (!open) {
      setEmbeddedRemoveOpen(false);
      setEmbeddedView({ type: "list" });
    }
    onEmbeddedOpenChange?.(open);
  };

  const memberContent = (
    <section aria-label="成员" className="pt-5">
      {embedded && embeddedView.type === "guest" ? (
        <form
          className="grid gap-4 pt-2"
          onSubmit={(event) => void addGuest(event)}
        >
          <div className="grid gap-2">
            <Label htmlFor="embedded-guest-name">临时成员昵称</Label>
            <Input
              id="embedded-guest-name"
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
      ) : null}

      {embedded && embeddedView.type === "invite" ? (
        <MemberInviteCenter
          inviteUrl={inviteUrl}
          inviteEnabled={hasActiveInvite}
          online={online}
          loading={inviteLoading}
          error={inviteError}
          statusError={inviteStatusError}
          notice={inviteNotice}
          onCreate={() => createInvite(false)}
          onReset={() => createInvite(true)}
          onDisable={disableInvite}
          onRetry={onRetryInviteStatus}
          onNotice={setInviteNotice}
        />
      ) : null}

      {embedded && embeddedMember ? (
        <div className="flex flex-col items-center py-2 text-center">
          <MemberAvatar
            memberId={embeddedMember.id}
            displayName={embeddedMember.displayName}
            avatarPreset={embeddedMember.avatarPreset}
            className="size-14"
          />
          <div className="mt-3 flex max-w-full items-center justify-center gap-1.5">
            <strong className="truncate text-base font-semibold">
              {embeddedMember.displayName}
            </strong>
            <MemberTags member={embeddedMember} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {identityLabel(embeddedMember)}
          </p>
          <MemberBalance
            netMinor={balancesByMemberId.get(embeddedMember.id) ?? 0n}
            currency={currency}
            className="mt-4 text-base"
          />
          {embeddedRemoveError ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {embeddedRemoveError}
            </p>
          ) : null}
          {embeddedRemovable ? (
            <Button
              type="button"
              variant="destructive"
              className="mt-5 w-full"
              onClick={() => setEmbeddedRemoveOpen(true)}
            >
              移除成员
            </Button>
          ) : null}
        </div>
      ) : null}

      {(!embedded || embeddedView.type === "list") && (
        <>
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
                  onClick={() => {
                    if (embedded) setEmbeddedView({ type: "invite" });
                    void openInvite();
                  }}
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
                    if (embedded) setEmbeddedView({ type: "guest" });
                    else setIsGuestOpen(true);
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
        </>
      )}

      {!embedded ? (
        <>
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
            <ResponsiveFormOverlay
              open={isInviteOpen}
              onOpenChange={setIsInviteOpen}
              title="邀请成员"
              mobileFullScreen
            >
              <MemberInviteCenter
                inviteUrl={inviteUrl}
                inviteEnabled={hasActiveInvite}
                online={online}
                loading={inviteLoading}
                error={inviteError}
                statusError={inviteStatusError}
                notice={inviteNotice}
                onCreate={() => createInvite(false)}
                onReset={() => createInvite(true)}
                onDisable={disableInvite}
                onRetry={onRetryInviteStatus}
                onNotice={setInviteNotice}
              />
            </ResponsiveFormOverlay>
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
        </>
      ) : null}

      {embedded && embeddedMember ? (
        <AlertDialog
          open={embeddedRemoveOpen}
          onOpenChange={setEmbeddedRemoveOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认移除成员</AlertDialogTitle>
              <AlertDialogDescription>
                有账务记录的成员会保留为“已离开”，没有账务记录的成员会从活动中移除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={embeddedRemoving}>
                取消
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={embeddedRemoving}
                onClick={() => void removeEmbeddedMember()}
              >
                {embeddedRemoving ? "移除中…" : "确认移除"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  );

  if (!embedded) return memberContent;
  return (
    <NavigationOverlay
      open={onEmbeddedOpenChange ? embeddedOpen : localEmbeddedOpen}
      onOpenChange={handleEmbeddedOpenChange}
      title={embeddedView.type === "list" ? "成员" : embeddedViewTitle}
      onBack={
        embeddedView.type === "list"
          ? undefined
          : () => {
              setEmbeddedRemoveOpen(false);
              setEmbeddedView({ type: "list" });
            }
      }
      backLabel="成员"
      mobileFullScreen
    >
      {memberContent}
    </NavigationOverlay>
  );
}
