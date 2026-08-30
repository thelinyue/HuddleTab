"use client";

import {
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
import { NavigationOverlay } from "@/components/ui/navigation-overlay";
import type { AvatarPreset } from "@/features/me/avatar-presets";

export interface MemberPickerMember {
  readonly id: string;
  readonly displayName: string;
  readonly avatarPreset?: AvatarPreset | null;
}

export type MemberPickerView = "members" | "add-guest";

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
  view: controlledView,
  inline = false,
  onViewChange,
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
  readonly view?: MemberPickerView;
  /** 在已有业务导航壳内渲染内容，避免再创建第二个 Dialog。 */
  readonly inline?: boolean;
  readonly onViewChange?: (view: MemberPickerView) => void;
}) {
  const [internalView, setInternalView] = useState<MemberPickerView>("members");
  const view = controlledView ?? internalView;
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

  const updateView = (nextView: MemberPickerView) => {
    if (controlledView === undefined) setInternalView(nextView);
    onViewChange?.(nextView);
  };

  const updateOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      updateView("members");
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

  async function submitGuest() {
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
        updateView("members");
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

  function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    void submitGuest();
  }

  const pickerContent =
    view === "add-guest" ? (
      inline ? (
        <div className="grid gap-4 pt-2">
          <div className="grid gap-2">
            <Label htmlFor="member-picker-guest-name">临时成员昵称</Label>
            <Input
              id="member-picker-guest-name"
              value={guestName}
              maxLength={40}
              autoFocus
              required
              onChange={(event) => setGuestName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitGuest();
                }
              }}
            />
          </div>
          {guestError ? (
            <p role="alert" className="text-sm text-destructive">
              {guestError}
            </p>
          ) : null}
          <Button
            type="button"
            disabled={guestSubmitting || !guestName.trim()}
            onClick={() => void submitGuest()}
          >
            {guestSubmitting ? "添加中…" : "确认添加"}
          </Button>
        </div>
      ) : (
        <form className="grid gap-4 pt-2" onSubmit={addGuest}>
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
      )
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
            // 付款金额输入框保持为选择按钮的兄弟节点，避免嵌套交互控件。
            const details = renderMemberDetails?.(member, selected);
            return (
              <div
                key={member.id}
                data-member-picker-row
                className={
                  details
                    ? "grid min-w-0 grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 border-b last:border-b-0"
                    : "border-b last:border-b-0"
                }
              >
                <button
                  type="button"
                  role={mode === "single" ? "radio" : "checkbox"}
                  aria-checked={selected}
                  aria-label={member.displayName}
                  className="flex min-h-14 min-w-0 w-full items-center gap-3 px-1 py-2 text-left outline-none transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                {details ? <div className="min-w-0">{details}</div> : null}
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
              onClick={() => {
                updateView("add-guest");
              }}
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
    );
  if (inline) {
    return open ? (
      <div
        data-member-picker-inline
        className="grid min-h-0 gap-4 overflow-y-auto py-2"
      >
        {pickerContent}
      </div>
    ) : null;
  }
  return (
    <NavigationOverlay
      open={open}
      onOpenChange={updateOpen}
      title={view === "add-guest" ? "添加临时成员" : title}
      returnFocusRef={returnFocusRef}
      onBack={
        view === "add-guest" ? (
          () => {
            setGuestError(null);
            updateView("members");
          }
        ) : undefined
      }
      backLabel="成员列表"
    >
      {pickerContent}
    </NavigationOverlay>
  );
}
