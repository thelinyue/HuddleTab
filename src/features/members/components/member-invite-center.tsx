"use client";

import {
  CopyIcon,
  Link2OffIcon,
  RefreshCwIcon,
  Share2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import Image from "next/image";

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

/**
 * 邀请中心只接收当前组件内存中的明文 URL。二维码和分享均由这个 URL 临时生成，
 * 不写入 localStorage、IndexedDB 或服务端；刷新后只能看到服务端返回的启用状态。
 */
export function MemberInviteCenter({
  inviteUrl,
  inviteEnabled,
  online,
  loading,
  error,
  statusError = null,
  notice,
  onCreate,
  onReset,
  onDisable,
  onRetry,
  onNotice,
}: {
  readonly inviteUrl: string | null;
  readonly inviteEnabled: boolean;
  readonly online: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly statusError?: string | null;
  readonly notice: string | null;
  readonly onCreate: () => Promise<void>;
  readonly onReset: () => Promise<void>;
  readonly onDisable: () => Promise<void>;
  readonly onRetry?: () => Promise<void>;
  readonly onNotice: (message: string) => void;
}) {
  const [qrData, setQrData] = useState<{
    readonly inviteUrl: string;
    readonly dataUrl: string;
  } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [confirmation, setConfirmation] = useState<"reset" | "disable" | null>(
    null,
  );
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!inviteUrl) return;
    void QRCode.toDataURL(inviteUrl, { width: 192, margin: 1 })
      .then((dataUrl) => {
        if (!cancelled) setQrData({ inviteUrl, dataUrl });
      })
      .catch(() => {
        // 二维码生成失败时保留链接和复制/分享操作，不阻断邀请流程。
      });
    return () => {
      cancelled = true;
    };
  }, [inviteUrl]);

  const copy = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      onNotice("邀请链接已复制。已有链接会持续有效，直到管理员关闭或重置。");
    } catch {
      onNotice("浏览器未允许自动复制，请手动选择邀请链接。");
    }
  };

  const share = async () => {
    if (!inviteUrl) return;
    if (typeof navigator.share !== "function") {
      await copy();
      return;
    }
    try {
      await navigator.share({
        title: "加入活动",
        text: "点击链接加入活动",
        url: inviteUrl,
      });
      onNotice("邀请链接已分享。");
    } catch (reason) {
      if (
        typeof reason === "object" &&
        reason !== null &&
        "name" in reason &&
        reason.name === "AbortError"
      )
        return;
      onNotice("系统分享失败，请复制邀请链接后发送。");
    }
  };

  const openConfirmation = (next: "reset" | "disable") => {
    setConfirmationError(null);
    setConfirmation(next);
  };

  const confirmChange = async () => {
    if (!confirmation || confirming) return;
    setConfirming(true);
    setConfirmationError(null);
    try {
      if (confirmation === "reset") await onReset();
      else await onDisable();
      setConfirmation(null);
    } catch (reason) {
      setConfirmationError(
        reason instanceof Error
          ? reason.message
          : confirmation === "reset"
            ? "重置邀请链接失败，请稍后重试。"
            : "关闭邀请失败，请稍后重试。",
      );
    } finally {
      setConfirming(false);
    }
  };

  const retry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="grid gap-4 pt-2">
      <p className="text-sm text-muted-foreground">
        分享链接后，对方登录或注册即可继续加入活动。
      </p>
      {!inviteUrl && inviteEnabled ? (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          已有邀请链接生效中。出于安全原因，刷新后无法恢复明文；如需继续分享，请确认重置。
        </p>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          正在处理邀请链接…
        </p>
      ) : null}
      {inviteUrl ? (
        <>
          {qrData?.inviteUrl === inviteUrl ? (
            <div className="flex justify-center rounded-lg border bg-white p-3">
              <Image
                src={qrData.dataUrl}
                alt="邀请链接二维码"
                width={192}
                height={192}
                unoptimized
              />
            </div>
          ) : null}
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
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              disabled={loading}
              onClick={() => void share()}
            >
              <Share2Icon aria-hidden="true" />
              分享
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => void copy()}
            >
              <CopyIcon aria-hidden="true" />
              复制链接
            </Button>
          </div>
        </>
      ) : !inviteEnabled && !statusError ? (
        <Button
          type="button"
          disabled={!online || loading}
          onClick={() => void onCreate()}
        >
          <Share2Icon aria-hidden="true" />
          生成邀请链接
        </Button>
      ) : null}
      {!online ? (
        <p role="status" className="text-sm text-muted-foreground">
          当前离线，可继续复制或分享当前链接；生成、重置和关闭需要联网，不会排队。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {statusError ? (
        <div className="grid gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p role="alert" className="text-sm text-destructive">
            {statusError}
          </p>
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              disabled={!online || loading || retrying}
              onClick={() => void retry()}
            >
              {retrying ? "重新加载中…" : "重新加载邀请状态"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {inviteEnabled || inviteUrl ? (
        <div className="grid gap-2 min-[480px]:grid-cols-2">
          <Button
            type="button"
            variant="destructive"
            disabled={!inviteEnabled || !online || loading}
            onClick={() => openConfirmation("disable")}
          >
            <Link2OffIcon aria-hidden="true" />
            关闭邀请
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!online || loading}
            onClick={() => openConfirmation("reset")}
          >
            <RefreshCwIcon aria-hidden="true" />
            重置链接
          </Button>
        </div>
      ) : null}
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !confirming) {
            setConfirmation(null);
            setConfirmationError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "reset" ? "重置邀请链接" : "关闭邀请"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "reset"
                ? "确认后旧邀请链接会立即失效，已经分享的链接将无法继续加入。"
                : "确认后当前邀请链接将立即失效，成员无法继续通过它加入活动。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmationError ? (
            <p role="alert" className="text-sm text-destructive">
              {confirmationError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirming}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={confirming}
              onClick={(event) => {
                event.preventDefault();
                void confirmChange();
              }}
            >
              {confirming
                ? "处理中…"
                : confirmation === "reset"
                  ? "确认重置"
                  : "确认关闭"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
