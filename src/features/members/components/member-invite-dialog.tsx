"use client";

import { CopyIcon, Link2OffIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 明文邀请链接只保留在当前组件状态中，不写入 localStorage 或其他持久化客户端存储。 */
export function MemberInviteDialog({
  open,
  onOpenChange,
  inviteUrl,
  loading,
  error,
  onRegenerate,
  onDisable,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly inviteUrl: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRegenerate: () => Promise<void>;
  readonly onDisable: () => Promise<void>;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  const copy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice("邀请链接已复制。已有链接会持续有效，直到管理员关闭或重置。");
    } catch {
      setNotice("浏览器未允许自动复制，请手动选择邀请链接。 ");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="member-invite-description">
        <DialogHeader>
          <DialogTitle>邀请成员</DialogTitle>
          <DialogDescription id="member-invite-description">
            分享链接后，对方登录或注册即可继续加入活动。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p role="status" className="py-3 text-sm text-muted-foreground">
            正在生成邀请链接…
          </p>
        ) : null}
        {inviteUrl ? (
          <div className="grid gap-2">
            <Label htmlFor="member-invite-url">邀请链接</Label>
            <Input
              id="member-invite-url"
              aria-label="邀请链接"
              value={inviteUrl}
              readOnly
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button type="button" onClick={() => void copy()}>
              <CopyIcon aria-hidden="true" />
              复制链接
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        <DialogFooter className="sm:grid sm:grid-cols-2">
          <Button
            type="button"
            variant="destructive"
            disabled={!inviteUrl || loading}
            onClick={() => void onDisable()}
          >
            <Link2OffIcon aria-hidden="true" />
            关闭邀请
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => void onRegenerate()}
          >
            <RefreshCwIcon aria-hidden="true" />
            重置链接
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
