"use client";

import { useEffect, useState } from "react";

import { SyncStatus } from "@/components/design-system/sync-status";
import { StateNotice } from "@/components/design-system/state-notice";
import { Button } from "@/components/ui/button";
import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import type { PendingExpenseMutation } from "@/pwa/indexed-db/schema";

export const offlineSessionKey = "huddletab:offline";

/** 浏览器在线状态只决定客户端是否可发起请求，服务端权限与活动状态仍是最终权威。 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  useEffect(() => {
    const updateOnline = () => {
      sessionStorage.removeItem(offlineSessionKey);
      setOnline(true);
    };
    const updateOffline = () => {
      sessionStorage.setItem(offlineSessionKey, "true");
      setOnline(false);
    };
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOffline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOffline);
    };
  }, []);
  return online;
}

/** 离线时保留不可排队操作的可见原因，避免禁用命令没有解释。 */
export function OfflineStatus({ children }: { readonly children: string }) {
  return (
    <StateNotice
      tone="warning"
      title="当前离线"
      description={children}
      className="mt-3"
      role="status"
    />
  );
}

/** 本地队列与服务端消费事实分开呈现，避免未确认账单混入权威总额。 */
export function OfflineExpenseStatus({
  mutation,
  onDiscard,
  onRemoveRejectedAttachments,
}: {
  readonly mutation: PendingExpenseMutation;
  readonly onDiscard: (id: string) => void;
  readonly onRemoveRejectedAttachments?: (id: string) => void;
}) {
  const status = describeMutation(mutation);
  const syncTone =
    mutation.status === "PENDING"
      ? "offline"
      : mutation.status === "SYNCING"
        ? "pending"
        : mutation.status === "RETRYABLE" || mutation.status === "REJECTED"
          ? "error"
          : "synced";
  return (
    <article
      className="mb-3 rounded-lg border border-dashed bg-surface-muted/60 p-3"
      aria-label="本地离线消费"
    >
      <div className="flex items-start justify-between gap-4">
        <strong className="min-w-0 [overflow-wrap:anywhere]">
          {mutation.payload.title}
        </strong>
        <strong className="money shrink-0">
          {formatMoney(
            {
              currency: asCurrencyCode(mutation.payload.originalCurrency),
              amountMinor: BigInt(mutation.payload.originalAmountMinor),
            },
            "zh-CN",
          )}
        </strong>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SyncStatus tone={syncTone} />
        <p className="min-w-0 text-sm text-muted-foreground">{status}</p>
      </div>
      {mutation.status === "REJECTED" && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          onClick={() => {
            if (window.confirm("丢弃后无法恢复这条本地离线消费，确定继续吗？"))
              onDiscard(mutation.id);
          }}
        >
          丢弃本地记录
        </Button>
      )}
      {mutation.status === "SYNCED" &&
        mutation.syncInfo?.code === "ATTACHMENTS_REJECTED" &&
        onRemoveRejectedAttachments && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => onRemoveRejectedAttachments(mutation.id)}
          >
            移除被拒绝的附件
          </Button>
        )}
    </article>
  );
}

function describeMutation(mutation: PendingExpenseMutation) {
  if (mutation.status === "PENDING") return "已保存在本机，联网后自动同步。";
  if (mutation.status === "SYNCING") return "正在提交到服务器。";
  if (mutation.status === "RETRYABLE") return "联网后将自动重试。";
  if (mutation.status === "REJECTED")
    return mutation.lastError?.message ?? "服务器拒绝了这笔离线消费。";
  return mutation.syncInfo?.message ?? "已同步";
}
