"use client";

import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import {
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";

import { MemberAvatar } from "@/components/design-system/member-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import type { AvatarPreset } from "@/features/me/avatar-presets";

export interface MemberPickerMember {
  readonly id: string;
  readonly displayName: string;
  readonly avatarPreset?: AvatarPreset | null;
}

export function MemberPickerTrigger({
  label,
  members,
  selectedIds,
  onClick,
  buttonRef,
}: {
  readonly label: string;
  readonly members: readonly MemberPickerMember[];
  readonly selectedIds: readonly string[];
  readonly onClick: () => void;
  readonly buttonRef?: Ref<HTMLButtonElement>;
}) {
  const selected = selectedIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is MemberPickerMember => Boolean(member));
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      className="w-full rounded-md border bg-surface px-3 py-2 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
      onClick={onClick}
    >
      <span className="type-caption block text-muted-foreground">{label}</span>
      <span className="flex min-h-11 items-center gap-2">
        {selected.length ? (
          <span className="flex -space-x-2" aria-hidden="true">
            {selected.slice(0, 3).map((member) => (
              <MemberAvatar
                key={member.id}
                memberId={member.id}
                displayName={member.displayName}
                avatarPreset={member.avatarPreset}
                className="size-8 ring-2 ring-surface"
              />
            ))}
          </span>
        ) : null}
        <span className="type-body min-w-0 flex-1 truncate font-medium">
          {selected.length === 0
            ? "请选择"
            : selected.length === 1
              ? selected[0].displayName
              : `${selected.length} 人`}
        </span>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </span>
    </button>
  );
}

/**
 * 成员选择面板只处理 ActivityMember 身份与临时成员创建。调用方持有多选草稿，
 * 因而取消 Overlay 时不会意外覆盖已经提交到业务表单的选择。
 */
export function MemberPickerSheet({
  open,
  onOpenChange,
  title,
  mode,
  members,
  selectedIds,
  onSelectedIdsChange,
  onCommit,
  canAddGuest = false,
  online = true,
  onAddGuest,
  beforeList,
  renderMemberDetails,
  footerSummary,
  canComplete = true,
  returnFocusRef,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly mode: "single" | "multiple";
  readonly members: readonly MemberPickerMember[];
  readonly selectedIds: readonly string[];
  readonly onSelectedIdsChange: (ids: readonly string[]) => void;
  readonly onCommit: (ids: readonly string[]) => void;
  readonly canAddGuest?: boolean;
  readonly online?: boolean;
  readonly onAddGuest?: (displayName: string) => Promise<MemberPickerMember>;
  readonly beforeList?: ReactNode;
  readonly renderMemberDetails?: (
    member: MemberPickerMember,
    selected: boolean,
  ) => ReactNode;
  readonly footerSummary?: ReactNode;
  readonly canComplete?: boolean;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [view, setView] = useState<"members" | "add-guest">("members");
  const [guestName, setGuestName] = useState("");
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestSubmitting, setGuestSubmitting] = useState(false);
  const [createdMembers, setCreatedMembers] = useState<
    readonly MemberPickerMember[]
  >([]);
  const availableMembers = [
    ...members,
    ...createdMembers.filter(
      (created) => !members.some((member) => member.id === created.id),
    ),
  ];

  const updateOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      setView("members");
      setGuestName("");
      setGuestError(null);
    }
    onOpenChange(nextOpen);
  };

  const selectMember = (memberId: string) => {
    if (mode === "single") {
      onSelectedIdsChange([memberId]);
      onCommit([memberId]);
      updateOpen(false);
      return;
    }
    onSelectedIdsChange(
      selectedIds.includes(memberId)
        ? selectedIds.filter((id) => id !== memberId)
        : [...selectedIds, memberId],
    );
  };

  async function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = guestName.trim();
    if (!displayName || !onAddGuest || guestSubmitting) return;
    setGuestSubmitting(true);
    setGuestError(null);
    try {
      const member = await onAddGuest(displayName);
      setCreatedMembers((current) => [...current, member]);
      setGuestName("");
      if (mode === "single") {
        onSelectedIdsChange([member.id]);
        onCommit([member.id]);
        updateOpen(false);
      } else {
        onSelectedIdsChange([...new Set([...selectedIds, member.id])]);
        setView("members");
      }
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

  return (
    <ResponsiveFormOverlay
      open={open}
      onOpenChange={updateOpen}
      title={view === "add-guest" ? "添加临时成员" : title}
      returnFocusRef={returnFocusRef}
      headerStart={
        view === "add-guest" ? (
          <button
            type="button"
            aria-label="返回成员列表"
            className="inline-flex size-11 items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => {
              setGuestError(null);
              setView("members");
            }}
          >
            <ArrowLeftIcon aria-hidden="true" className="size-5" />
          </button>
        ) : undefined
      }
    >
      {view === "add-guest" ? (
        <form
          className="grid gap-4 pt-2"
          onSubmit={(event) => void addGuest(event)}
        >
          <div className="grid gap-2">
            <Label htmlFor="member-picker-guest-name">临时成员昵称</Label>
            <Input
              id="member-picker-guest-name"
              value={guestName}
              maxLength={40}
              autoFocus
              required
              onChange={(event) => setGuestName(event.target.value)}
            />
          </div>
          {guestError ? (
            <p role="alert" className="text-sm text-destructive">
              {guestError}
            </p>
          ) : null}
          <Button type="submit" disabled={guestSubmitting || !guestName.trim()}>
            {guestSubmitting ? "添加中…" : "确认添加"}
          </Button>
        </form>
      ) : (
        <div className="flex min-h-0 flex-col">
          {beforeList}
          <div
            role={mode === "single" ? "radiogroup" : "group"}
            aria-label={title}
            className="min-h-0 overflow-y-auto border-y"
          >
            {availableMembers.map((member) => {
              const selected = selectedIds.includes(member.id);
              return (
                <div key={member.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    role={mode === "single" ? "radio" : "checkbox"}
                    aria-checked={selected}
                    aria-label={member.displayName}
                    className="flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => selectMember(member.id)}
                  >
                    <MemberAvatar
                      memberId={member.id}
                      displayName={member.displayName}
                      avatarPreset={member.avatarPreset}
                      className="size-10"
                    />
                    <span className="type-body min-w-0 flex-1 truncate font-medium">
                      {member.displayName}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`flex size-6 items-center justify-center border ${mode === "single" ? "rounded-full" : "rounded-sm"} ${selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/35"}`}
                    >
                      {selected ? <CheckIcon className="size-4" /> : null}
                    </span>
                  </button>
                  {renderMemberDetails?.(member, selected)}
                </div>
              );
            })}
          </div>

          {canAddGuest && onAddGuest ? (
            <div className="pt-3">
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                disabled={!online}
                onClick={() => setView("add-guest")}
              >
                <UserRoundPlusIcon aria-hidden="true" className="size-5" />
                添加临时成员
              </Button>
              {!online ? (
                <p className="px-3 pt-1 text-sm text-muted-foreground">
                  当前离线，联网后可添加
                </p>
              ) : null}
            </div>
          ) : null}

          {mode === "multiple" ? (
            <div className="mt-4 border-t pt-4">
              {footerSummary}
              <Button
                type="button"
                className="mt-3 h-12 w-full"
                disabled={!selectedIds.length || !canComplete}
                onClick={() => onCommit(selectedIds)}
              >
                完成
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </ResponsiveFormOverlay>
  );
}
