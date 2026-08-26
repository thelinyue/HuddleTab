"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createExpense } from "@/features/expenses/api";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";
import { AttachmentRepository } from "@/pwa/indexed-db/attachment-repository";
import { recoverInterruptedSyncing } from "@/pwa/indexed-db/database";
import type { PendingAttachment } from "@/pwa/indexed-db/schema";
import { MutationRepository } from "@/pwa/indexed-db/mutation-repository";
import { SyncCoordinator } from "@/pwa/sync-queue/sync-coordinator";
import { foregroundSyncEvent } from "@/pwa/sync-queue/sync-events";

type CreateExpense = typeof createExpense;
type AttachmentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
const foregroundRuns = new Map<string, Promise<void>>();

/**
 * 离线附件必须经由与账单绑定的私有 API 上传。失败对象保留服务端状态和错误码，
 * 由 AttachmentRepository 决定重试或标记为用户可处理的拒绝，而不是静默吞掉失败。
 */
export function createAttachmentUploader(fetcher: AttachmentFetch = fetch) {
  return async ({
    expenseId,
    attachment,
  }: {
    readonly expenseId: string;
    readonly attachment: PendingAttachment;
  }) => {
    const formData = new FormData();
    formData.set("file", attachment.blob, attachment.fileName);
    formData.set("clientAttachmentId", attachment.clientAttachmentId);
    const response = await fetcher(
      `/api/activities/${encodeURIComponent(attachment.activityId)}/expenses/${encodeURIComponent(expenseId)}/attachments`,
      { method: "POST", credentials: "same-origin", body: formData },
    );
    const payload = (await response.json().catch(() => null)) as {
      data?: { id?: string };
      error?: { code?: string; message?: string };
    } | null;
    if (!response.ok) {
      throw Object.assign(
        new Error(payload?.error?.message ?? "附件上传失败，请稍后重试。"),
        {
          status: response.status,
          code: payload?.error?.code ?? "ATTACHMENT_UPLOAD_FAILED",
        },
      );
    }
    return { id: payload?.data?.id };
  };
}

/** 将当前用户的本地队列交给唯一前台协调器，绝不访问其他用户的 IndexedDB。 */
export function syncForegroundQueue(
  userId: string,
  create: CreateExpense = createExpense,
  retryNow = false,
  upload = createAttachmentUploader(),
) {
  const active = foregroundRuns.get(userId);
  if (active) return active;
  const run = (async () => {
    await recoverInterruptedSyncing(userId);
    const queue = new MutationRepository(userId);
    const attachments = new AttachmentRepository(userId, upload);
    if (retryNow) {
      await queue.retryNow();
      await attachments.retryNow();
    }
    await new SyncCoordinator(
      queue,
      {
        createExpense: (activityId, payload) =>
          create(activityId, payload as CreateExpenseRequest),
      },
      Date.now,
      attachments,
    ).run();
  })();
  foregroundRuns.set(userId, run);
  void run.then(
    () => {
      if (foregroundRuns.get(userId) === run) foregroundRuns.delete(userId);
    },
    () => {
      if (foregroundRuns.get(userId) === run) foregroundRuns.delete(userId);
    },
  );
  return run;
}

/**
 * 前台同步触发器：登录用户页面挂载、浏览器恢复联网和用户手动重试时运行。
 * Service Worker 不参与账务同步，组件卸载时会移除浏览器事件监听器。
 */
export function SyncTriggers({
  userId,
  onCompleted,
}: {
  readonly userId: string;
  readonly onCompleted?: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onCompletedRef = useRef(onCompleted);
  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);
  const runManually = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncForegroundQueue(userId, createExpense, true);
      onCompletedRef.current?.();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "同步未完成，请稍后重试。",
      );
    } finally {
      setSyncing(false);
    }
  }, [userId]);
  useEffect(() => {
    let mounted = true;
    const runAutomatically = async (retryNow = false) => {
      if (!navigator.onLine) return;
      try {
        await syncForegroundQueue(userId, createExpense, retryNow);
        if (mounted) onCompletedRef.current?.();
      } catch (reason) {
        if (mounted)
          setError(
            reason instanceof Error
              ? reason.message
              : "同步未完成，请稍后重试。",
          );
      }
    };
    void runAutomatically();
    const onOnline = () => void runAutomatically(true);
    const onForegroundSyncRequested = () => void runAutomatically(true);
    window.addEventListener("online", onOnline);
    window.addEventListener(foregroundSyncEvent, onForegroundSyncRequested);
    return () => {
      mounted = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener(
        foregroundSyncEvent,
        onForegroundSyncRequested,
      );
    };
  }, [userId]);
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={syncing}
        onClick={() => void runManually()}
        className="min-h-11 border px-3 text-sm"
      >
        {syncing ? "正在同步" : "重试同步"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
