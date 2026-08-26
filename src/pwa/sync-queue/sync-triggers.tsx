"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createExpense } from "@/features/expenses/api";
import type { CreateExpenseRequest } from "@/features/expenses/contracts";
import { MutationRepository } from "@/pwa/indexed-db/mutation-repository";
import { SyncCoordinator } from "@/pwa/sync-queue/sync-coordinator";

type CreateExpense = typeof createExpense;

/** 将当前用户的本地队列交给唯一前台协调器，绝不访问其他用户的 IndexedDB。 */
export async function syncForegroundQueue(
  userId: string,
  create: CreateExpense = createExpense,
) {
  const queue = new MutationRepository(userId);
  await new SyncCoordinator(queue, {
    createExpense: (activityId, payload) =>
      create(activityId, payload as CreateExpenseRequest),
  }).run();
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
      await syncForegroundQueue(userId);
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
    const runAutomatically = async () => {
      try {
        await syncForegroundQueue(userId);
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
    const onOnline = () => void runAutomatically();
    window.addEventListener("online", onOnline);
    return () => {
      mounted = false;
      window.removeEventListener("online", onOnline);
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
