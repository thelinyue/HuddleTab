"use client";

import { ClipboardPasteIcon, LinkIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OfflineStatus,
  useOnlineStatus,
} from "@/features/expenses/components/offline-status";
import { parseJoinInvitationUrl } from "@/features/invitations/join-url";

/** 主动加入只处理用户明确粘贴的同源邀请链接，不读取摄像头、不做活动公开搜索。 */
export function JoinActivityForm() {
  const router = useRouter();
  const online = useOnlineStatus();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setValue(text);
      setError(null);
    } catch {
      setError("无法读取剪贴板，请手动粘贴邀请链接。");
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!online) {
      setError("当前离线，加入活动需要联网，不会排队。");
      return;
    }
    const path = parseJoinInvitationUrl(value);
    if (!path) {
      setError("请输入当前站点的有效邀请链接。链接格式应为 /join/<token>。");
      return;
    }
    router.push(path);
  };

  return (
    <form className="grid gap-4 pt-2" onSubmit={submit}>
      <p className="text-sm text-muted-foreground">
        粘贴活动管理员分享的邀请链接，验证后即可加入。
      </p>
      <div className="grid gap-2">
        <Label htmlFor="activity-invite-url">邀请链接</Label>
        <div className="flex gap-2">
          <Input
            id="activity-invite-url"
            aria-label="邀请链接"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            placeholder="https://当前站点/join/..."
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="从剪贴板读取"
            title="从剪贴板读取"
            onClick={() => void pasteFromClipboard()}
          >
            <ClipboardPasteIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
      {!online ? (
        <OfflineStatus>加入活动需要联网，不会排队。</OfflineStatus>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={!online || !value.trim()}>
        <LinkIcon aria-hidden="true" />
        继续加入
      </Button>
    </form>
  );
}
