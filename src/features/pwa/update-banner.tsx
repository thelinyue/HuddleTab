"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { openHuddleTabDb } from "@/pwa/indexed-db/database";
import { createUpdateController } from "@/pwa/service-worker/update-controller";

type UpdateBannerProps = {
  readonly userId?: string;
  readonly pendingOverride?: boolean;
  readonly waitingOverride?: boolean;
};

const syncPendingStatuses = new Set(["PENDING", "SYNCING", "RETRYABLE"]);

/** 当前用户队列计数只读 IndexedDB，不将账务数据交给 Service Worker。 */
async function countForegroundQueue(userId: string) {
  const database = await openHuddleTabDb(userId);
  try {
    const [mutations, attachments] = await Promise.all([
      database.getAll("pending_mutations"),
      database.getAll("pending_attachments"),
    ]);
    return {
      mutations: mutations.filter((item) =>
        syncPendingStatuses.has(item.status),
      ).length,
      attachments: attachments.filter((item) =>
        syncPendingStatuses.has(item.status),
      ).length,
    };
  } finally {
    database.close();
  }
}

/**
 * 等待中的 Worker 不会自动激活。提示只在已知当前用户的活动界面显示，
 * 点击更新前重新检查前台队列，确保切换版本不会打断本地账务同步。
 */
export function UpdateBanner({
  userId,
  pendingOverride,
  waitingOverride,
}: UpdateBannerProps) {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [hasPendingSync, setHasPendingSync] = useState(
    Boolean(pendingOverride),
  );
  const controller = useMemo(
    () =>
      createUpdateController({
        pendingMutationCount: async () => {
          if (pendingOverride) return 1;
          if (!userId) return 0;
          return (await countForegroundQueue(userId)).mutations;
        },
        pendingAttachmentCount: async () => {
          if (pendingOverride) return 0;
          if (!userId) return 0;
          return (await countForegroundQueue(userId)).attachments;
        },
        reload: () => window.location.reload(),
      }),
    [pendingOverride, userId],
  );

  const refreshPendingState = useCallback(async () => {
    if (pendingOverride) {
      setHasPendingSync(true);
      return;
    }
    if (!userId) {
      setHasPendingSync(false);
      return;
    }
    const counts = await countForegroundQueue(userId);
    setHasPendingSync(counts.mutations + counts.attachments > 0);
  }, [pendingOverride, userId]);

  useEffect(() => {
    if (waitingOverride) return;
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    const setWaitingWorker = () => {
      if (!cancelled) setWaiting(registration?.waiting ?? null);
    };
    const onControllerChange = () => controller.handleControllerChange();

    void navigator.serviceWorker.getRegistration().then((value) => {
      registration = value;
      setWaitingWorker();
      registration?.addEventListener("updatefound", setWaitingWorker);
    });
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      onControllerChange,
    );
    return () => {
      cancelled = true;
      registration?.removeEventListener("updatefound", setWaitingWorker);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, [controller, waitingOverride]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(
      () => void refreshPendingState(),
      0,
    );
    const timer =
      !userId || pendingOverride
        ? undefined
        : window.setInterval(() => void refreshPendingState(), 1_000);
    return () => {
      window.clearTimeout(initialRefresh);
      if (timer) window.clearInterval(timer);
    };
  }, [pendingOverride, refreshPendingState, userId]);

  const visible = waitingOverride || waiting;
  if (!visible) return null;

  const requestUpdate = async () => {
    if (!waiting) return;
    const result = await controller.requestActivation(waiting);
    if (!result.activated) setHasPendingSync(true);
  };

  return (
    <aside
      aria-live="polite"
      className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 border border-warning/40 bg-surface p-3 text-sm shadow-lg sm:bottom-6"
    >
      <RefreshCw aria-hidden="true" className="size-5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1">
        {hasPendingSync ? "有新版本可用，完成同步后更新" : "有新版本可用。"}
      </p>
      <Button
        type="button"
        size="sm"
        disabled={hasPendingSync}
        onClick={() => void requestUpdate()}
      >
        立即更新
      </Button>
    </aside>
  );
}
