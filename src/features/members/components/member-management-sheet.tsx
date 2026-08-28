"use client";

import { useState, type MouseEvent } from "react";

import { MemberAvatar } from "@/components/design-system/member-avatar";
import { StatusBadge } from "@/components/design-system/status-badge";
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
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
import { MemberBalance } from "@/features/members/components/member-balance";
import type { MemberListRow } from "@/features/members/components/member-list";

function identityLabel(member: MemberListRow) {
  if (member.role === "OWNER") return "创建者";
  return member.memberType === "GUEST" ? "临时成员" : "正式成员";
}

function MemberTags({ member }: { readonly member: MemberListRow }) {
  if (member.status === "LEFT") {
    return <StatusBadge tone="neutral">已离开</StatusBadge>;
  }
  return (
    <>
      {member.role === "OWNER" ? (
        <StatusBadge tone="success">所有者</StatusBadge>
      ) : member.role === "ADMIN" ? (
        <StatusBadge tone="success">管理员</StatusBadge>
      ) : member.memberType === "GUEST" ? (
        <StatusBadge tone="neutral">访客</StatusBadge>
      ) : null}
      {member.role === "OWNER" ? (
        <StatusBadge tone="success">活跃</StatusBadge>
      ) : null}
    </>
  );
}

/**
 * 成员管理层只编排查看与移除交互。是否允许移除仍由列表响应中的逐成员权限和服务端
 * DELETE 路由共同决定，前端不把按钮可见性当作授权依据。
 */
export function MemberManagementSheet({
  member,
  open,
  onOpenChange,
  onRemove,
  balanceMinor,
  currency,
}: {
  readonly member: MemberListRow;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRemove?: (memberId: string) => Promise<void>;
  readonly balanceMinor: bigint;
  readonly currency: string;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removable =
    Boolean(onRemove) &&
    member.permissions.canManage &&
    member.status === "ACTIVE" &&
    member.role !== "OWNER";

  async function remove(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!onRemove || !removable || removing) return;
    setRemoving(true);
    setError(null);
    try {
      await onRemove(member.id);
      setConfirmOpen(false);
      onOpenChange(false);
    } catch (reason) {
      setConfirmOpen(false);
      setError(
        reason instanceof Error ? reason.message : "移除成员失败，请稍后重试。",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <>
      <ResponsiveFormOverlay
        open={open}
        onOpenChange={onOpenChange}
        title="成员管理"
      >
        <div className="flex flex-col items-center py-2 text-center">
          <MemberAvatar
            memberId={member.id}
            displayName={member.displayName}
            avatarPreset={member.avatarPreset}
            className="size-14"
          />
          <div className="mt-3 flex max-w-full items-center justify-center gap-1.5">
            <strong className="truncate text-base font-semibold">
              {member.displayName}
            </strong>
            <MemberTags member={member} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {identityLabel(member)}
          </p>
          <MemberBalance
            netMinor={balanceMinor}
            currency={currency}
            className="mt-4 text-base"
          />
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {removable ? (
          <Button
            type="button"
            variant="destructive"
            className="mt-5 w-full"
            onClick={() => setConfirmOpen(true)}
          >
            移除成员
          </Button>
        ) : null}
      </ResponsiveFormOverlay>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除成员</AlertDialogTitle>
            <AlertDialogDescription>
              有账务记录的成员会保留为“已离开”，没有账务记录的成员会从活动中移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removing}
              onClick={(event) => void remove(event)}
            >
              {removing ? "移除中…" : "确认移除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export { identityLabel, MemberTags };
