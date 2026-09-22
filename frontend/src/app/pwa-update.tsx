import { LoaderCircle } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionQuery } from "../features/auth/api";
import { EXPENSE_QUEUE_CHANGED_EVENT } from "../features/accounting/expense-queue";
import { openHuddleTabDb } from "../pwa/indexed-db/database";
import type { MutationStatus } from "../pwa/indexed-db/schema";
import { usePwaUpdateBlocked } from "./pwa-update-safety";
import { canActivatePwaUpdate } from "./pwa-update-policy";

async function readUpdateGate(userId: string | undefined) {
  if (!userId) return { allowed: true as const };
  const database = await openHuddleTabDb(userId);
  try {
    const [mutations, attachments] = await Promise.all([
      database.getAll("pending_mutations"),
      database.getAll("pending_attachments"),
    ]);
    return canActivatePwaUpdate({
      mutationStatuses: mutations.map(({ status }) => status as MutationStatus),
      attachmentStatuses: attachments.map(({ status }) => status as MutationStatus),
    });
  } finally {
    database.close();
  }
}

type UpdatePromptState = {
  kind: "checking" | "blocked" | "updating" | "error";
  message: string;
};

const checkingState: UpdatePromptState = { kind: "checking", message: "正在检查同步状态…" };
const blockedMessage = "有新版本可用，完成同步后将自动更新。";

/**
 * 新版只在安全时机激活：先准备 Service Worker，再等待本地队列和编辑锁都放行。
 * 所有重试都由已有的业务事件驱动，避免轮询抢占移动设备资源或打断用户输入。
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const session = useSessionQuery();
  const blocked = usePwaUpdateBlocked();
  const [status, setStatus] = useState<UpdatePromptState>(checkingState);
  const checkInFlight = useRef(false);
  const activationStarted = useRef(false);
  const blockedRef = useRef(blocked);
  const needRefreshRef = useRef(needRefresh);
  const updateServiceWorkerRef = useRef(updateServiceWorker);
  blockedRef.current = blocked;
  needRefreshRef.current = needRefresh;
  updateServiceWorkerRef.current = updateServiceWorker;

  const checkAndUpdate = useCallback(async () => {
    if (!needRefresh || activationStarted.current || checkInFlight.current) return;
    if (blocked) {
      setStatus({ kind: "blocked", message: blockedMessage });
      return;
    }
    if (session.isPending || session.isError) {
      setStatus(checkingState);
      return;
    }

    checkInFlight.current = true;
    setStatus(checkingState);
    try {
      let gate: Awaited<ReturnType<typeof readUpdateGate>>;
      try {
        gate = await readUpdateGate(session.data?.userId);
      } catch {
        setStatus({ kind: "error", message: "无法确认本地同步状态，将在稍后自动重试。" });
        return;
      }

      if (blockedRef.current) {
        setStatus({ kind: "blocked", message: blockedMessage });
        return;
      }
      if (!gate.allowed) {
        setStatus({ kind: "blocked", message: gate.message ?? blockedMessage });
        return;
      }
      if (!needRefreshRef.current || activationStarted.current) return;

      activationStarted.current = true;
      setStatus({ kind: "updating", message: "正在更新…" });
      try {
        await updateServiceWorkerRef.current(true);
      } catch {
        // 激活失败时解除本次尝试锁，联网、队列变化或回到页面后可再次尝试。
        activationStarted.current = false;
        setStatus({ kind: "error", message: "更新暂未完成，将在稍后自动重试。" });
      }
    } finally {
      checkInFlight.current = false;
    }
  }, [blocked, needRefresh, session.data?.userId, session.isError, session.isPending]);

  useEffect(() => {
    if (!needRefresh) {
      activationStarted.current = false;
      setStatus(checkingState);
      return;
    }
    void checkAndUpdate();
  }, [checkAndUpdate, needRefresh]);

  useEffect(() => {
    if (!needRefresh) return;
    const retry = () => void checkAndUpdate();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") retry();
    };
    window.addEventListener(EXPENSE_QUEUE_CHANGED_EVENT, retry);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener(EXPENSE_QUEUE_CHANGED_EVENT, retry);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkAndUpdate, needRefresh]);

  if (!needRefresh) return null;
  const busy = status.kind === "checking" || status.kind === "updating";
  return (
    <aside
      className={`update-prompt update-prompt--${status.kind}`}
      role="status"
      aria-atomic="true"
      aria-live="polite"
      aria-busy={busy}
    >
      {busy ? <LoaderCircle className="update-prompt__spinner" aria-hidden="true" size={16} /> : null}
      <span className="update-prompt__text">{status.message}</span>
    </aside>
  );
}
