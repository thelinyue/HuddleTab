"use client";

import { useState, type FormEvent } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  Link2Icon,
  Link2OffIcon,
  RefreshCwIcon,
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
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import type { AvatarPreset } from "@/features/me/avatar-presets";
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
  readonly avatarPreset?: AvatarPreset | null;
  readonly permissions: { readonly canManage: boolean };
};

type EmbeddedView =
  | { readonly type: "list" }
  | { readonly type: "invite" }
  | { readonly type: "guest" }
  | { readonly type: "detail"; readonly member: MemberListRow };

/**
 * 成员页按“操作、活跃成员、邀请方式、已离开”组织。成员行本身只负责打开查看层，
 * 独立成员页沿用 Overlay，嵌入活动面板时则切换同一面板内的本地视图，避免焦点层级嵌套。
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
  embedded = false,
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
  /** 嵌入活动面板时在同一 Sheet/Dialog 内切换子视图，避免再开嵌套 Overlay。 */
  readonly embedded?: boolean;
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
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [embeddedView, setEmbeddedView] = useState<EmbeddedView>({
    type: "list",
  });
  const [embeddedRemoveOpen, setEmbeddedRemoveOpen] = useState(false);
  const [embeddedRemoving, setEmbeddedRemoving] = useState(false);
  const [embeddedRemoveError, setEmbeddedRemoveError] = useState<string | null>(
    null,
  );
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

  async function createInvite() {
    if (!onCreateInvite || inviteLoading) return;
    setInviteLoading(true);
    setInviteError(null);
    setInviteNotice(null);
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
    if (!embedded) setIsInviteOpen(true);
    if (!inviteUrl) await createInvite();
  }

  async function disableInvite() {
    if (!onDisableInvite) return;
    setInviteLoading(true);
    setInviteError(null);
    setInviteNotice(null);
    try {
      await onDisableInvite();
      setInviteUrl(null);
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

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteNotice("邀请链接已复制。");
    } catch {
      setInviteNotice("浏览器未允许自动复制，请手动选择邀请链接。");
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

  return (
    <section aria-label="成员" className="pt-5">
      {embedded && embeddedView.type !== "list" ? (
        <div className="mb-4 flex min-h-10 items-center gap-2 border-b pb-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="返回成员列表"
            onClick={() => {
              setEmbeddedRemoveOpen(false);
              setEmbeddedView({ type: "list" });
            }}
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
            成员
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-center text-base font-semibold">
            {embeddedViewTitle}
          </h2>
          <span className="size-16 shrink-0" aria-hidden="true" />
        </div>
      ) : null}

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
        <div className="grid gap-4 pt-2">
          <p className="text-sm text-muted-foreground">
            分享链接后，对方登录或注册即可继续加入活动。
          </p>
          {inviteLoading ? (
            <p role="status" className="text-sm text-muted-foreground">
              正在生成邀请链接…
            </p>
          ) : null}
          {inviteUrl ? (
            <div className="grid gap-2">
              <Label htmlFor="embedded-member-invite-url">邀请链接</Label>
              <Input
                id="embedded-member-invite-url"
                aria-label="邀请链接"
                value={inviteUrl}
                readOnly
                className="font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button type="button" onClick={() => void copyInvite()}>
                <CopyIcon aria-hidden="true" />
                复制链接
              </Button>
            </div>
          ) : null}
          {inviteError ? (
            <p role="alert" className="text-sm text-destructive">
              {inviteError}
            </p>
          ) : null}
          {inviteNotice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {inviteNotice}
            </p>
          ) : null}
          <div className="grid gap-2 min-[480px]:grid-cols-2">
            <Button
              type="button"
              variant="destructive"
              disabled={!inviteUrl || inviteLoading}
              onClick={() => void disableInvite()}
            >
              <Link2OffIcon aria-hidden="true" />
              关闭邀请
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={inviteLoading}
              onClick={() => void createInvite()}
            >
              <RefreshCwIcon aria-hidden="true" />
              重置链接
            </Button>
          </div>
        </div>
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

          {canManage && onCreateInvite && onDisableInvite ? (
            <section className="mt-8" aria-labelledby="invite-method-heading">
              <h2
                id="invite-method-heading"
                className="text-base font-semibold"
              >
                邀请方式
              </h2>
              <button
                type="button"
                aria-label="链接加入"
                className="mt-2 grid min-h-[72px] w-full grid-cols-[44px_minmax(0,1fr)_16px] items-center gap-3 border-y py-3 text-left transition-colors hover:bg-muted/45 focus-visible:bg-muted/45"
                onClick={() => {
                  if (embedded) setEmbeddedView({ type: "invite" });
                  void openInvite();
                }}
              >
                <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Link2Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="min-w-0">
                  <strong className="block text-sm font-semibold">
                    链接加入
                  </strong>
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
}
