"use client";

import { WifiOffIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { asCurrencyCode } from "@/domain/currency/currency";
import { formatMoney } from "@/domain/money/money";
import type { PendingExpenseMutation } from "@/pwa/indexed-db/schema";

/** 浏览器在线状态只决定客户端是否可发起请求，服务端权限与活动状态仍是最终权威。 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  useEffect(() => {
    const updateOnline = () => setOnline(true);
    const updateOffline = () => setOnline(false);
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
    <p className="mt-2 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
      <WifiOffIcon aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </p>
  );
}

/** 本地队列与服务端消费事实分开呈现，避免未确认账单混入权威总额。 */
export function OfflineExpenseStatus({
  mutation,
  onDiscard,
}: {
  readonly mutation: PendingExpenseMutation;
  readonly onDiscard: (id: string) => void;
}) {
  const status = describeMutation(mutation);
  return (
    <article className="border-b border-dashed py-3" aria-label="本地离线消费">
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
      <p className="mt-1 text-sm text-muted-foreground">{status}</p>
      {mutation.status === "REJECTED" && (
        <button
          type="button"
          className="mt-2 min-h-11 border px-3 text-sm"
          onClick={() => {
            if (window.confirm("丢弃后无法恢复这条本地离线消费，确定继续吗？"))
              onDiscard(mutation.id);
          }}
        >
          丢弃本地记录
        </button>
      )}
    </article>
  );
}

function describeMutation(mutation: PendingExpenseMutation) {
  if (mutation.status === "PENDING" || mutation.status === "SYNCING")
    return "待同步";
  if (mutation.status === "RETRYABLE") return "同步失败，可重试";
  if (mutation.status === "REJECTED")
    return mutation.lastError?.message ?? "服务器拒绝了这笔离线消费。";
  return mutation.syncInfo?.message ?? "已同步";
}
