import { LoaderCircle } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ConfirmDialog } from "../components/ui";
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
  kind: "checking" | "blocked" | "ready" | "updating" | "error";
  message: string;
};

const updateDelayMs = 10_000;
const checkingState: UpdatePromptState = { kind: "checking", message: "检查中…" };
const editingState: UpdatePromptState = { kind: "blocked", message: "编辑完成后自动更新" };
const readyState: UpdatePromptState = { kind: "ready", message: "新版可用，稍后自动更新" };

/**
 * 自动更新等待编辑锁和本地同步全部放行，再给用户十秒操作时间。
 * 手动更新只依赖用户确认，独立于安全检查执行，不会被失败或卡住的本地读取阻塞；
 * 两条路径都只激活新版 Service Worker，不清理离线账单、附件或账户数据。
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const session = useSessionQuery();
  const blocked = usePwaUpdateBlocked();
  const [status, setStatus] = useState<UpdatePromptState>(checkingState);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const mounted = useRef(true);
  const confirming = useRef(false);
  const activationStarted = useRef(false);
  const autoUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 作废旧的异步结果，防止用户确认更新或切换账户后，迟到的检查覆盖当前状态。
  const checkRevision = useRef(0);
  const activationAttempt = useRef(0);
  const current = useRef({ needRefresh, blocked, userId: session.data?.userId, pending: session.isPending, error: session.isError });
  const updateServiceWorkerRef = useRef(updateServiceWorker);
  current.current = { needRefresh, blocked, userId: session.data?.userId, pending: session.isPending, error: session.isError };
  updateServiceWorkerRef.current = updateServiceWorker;

  const cancelAutoUpdate = useCallback(() => {
    checkRevision.current += 1;
    if (autoUpdateTimer.current !== null) clearTimeout(autoUpdateTimer.current);
    autoUpdateTimer.current = null;
  }, []);

  const clearActivationTimeout = useCallback(() => {
    if (activationTimer.current !== null) clearTimeout(activationTimer.current);
    activationTimer.current = null;
  }, []);

  const activationFailed = useCallback((attempt: number) => {
    if (!mounted.current || !activationStarted.current || attempt !== activationAttempt.current) return;
    clearActivationTimeout();
    activationStarted.current = false;
    setStatus({ kind: "error", message: "更新未完成，请重试" });
  }, [clearActivationTimeout]);

  const activateUpdate = useCallback(async () => {
    if (!mounted.current || !current.current.needRefresh || activationStarted.current) return;
    cancelAutoUpdate();
    confirming.current = false;
    setConfirmationOpen(false);
    activationStarted.current = true;
    const attempt = ++activationAttempt.current;
    setStatus({ kind: "updating", message: "更新中…" });
    // 插件返回只表示已发送激活请求，实际切换由 controllerchange 确认。
    activationTimer.current = setTimeout(() => activationFailed(attempt), updateDelayMs);
    try {
      await updateServiceWorkerRef.current(true);
    } catch {
      activationFailed(attempt);
    }
  }, [activationFailed, cancelAutoUpdate]);

  const checkForAutoUpdate = useCallback(async (activate = false): Promise<void> => {
    if (!mounted.current || !current.current.needRefresh || activationStarted.current || confirming.current) return;
    if (document.visibilityState !== "visible") {
      cancelAutoUpdate();
      return;
    }
    const { blocked: editing, userId, pending, error } = current.current;
    if (editing || pending || error) {
      cancelAutoUpdate();
      setStatus(editing ? editingState : error
        ? { kind: "error", message: "无法确认登录状态" }
        : checkingState);
      return;
    }

    const revision = ++checkRevision.current;
    if (autoUpdateTimer.current === null) setStatus(checkingState);
    try {
      const gate = await readUpdateGate(userId);
      if (!mounted.current || revision !== checkRevision.current || activationStarted.current || confirming.current) return;
      const latest = current.current;
      if (!latest.needRefresh || latest.userId !== userId || latest.blocked || latest.pending || latest.error || document.visibilityState !== "visible") {
        cancelAutoUpdate();
        return;
      }
      if (!gate.allowed) {
        cancelAutoUpdate();
        setStatus({ kind: "blocked", message: gate.message });
        return;
      }
      if (activate) {
        // 十秒等待结束后再次读队列，避免期间新增离线记录却未及时收到事件。
        await activateUpdate();
        return;
      }
      setStatus(readyState);
      if (autoUpdateTimer.current === null) {
        autoUpdateTimer.current = setTimeout(() => {
          autoUpdateTimer.current = null;
          void checkForAutoUpdate(true);
        }, updateDelayMs);
      }
    } catch {
      if (!mounted.current || revision !== checkRevision.current) return;
      cancelAutoUpdate();
      setStatus({ kind: "error", message: "无法确认同步状态" });
    }
  }, [activateUpdate, cancelAutoUpdate]);

  useEffect(() => {
    mounted.current = true;
    const serviceWorker = navigator.serviceWorker;
    const handleControllerChange = () => {
      if (!activationStarted.current) return;
      clearActivationTimeout();
      // 页面刷新仍交给已有 PWA 插件；迟到的请求失败不能覆盖已切换的状态。
      activationAttempt.current += 1;
    };
    serviceWorker?.addEventListener("controllerchange", handleControllerChange);
    return () => {
      mounted.current = false;
      cancelAutoUpdate();
      clearActivationTimeout();
      activationAttempt.current += 1;
      serviceWorker?.removeEventListener("controllerchange", handleControllerChange);
    };
  }, [cancelAutoUpdate, clearActivationTimeout]);

  useEffect(() => {
    cancelAutoUpdate();
    if (!needRefresh) {
      clearActivationTimeout();
      activationStarted.current = false;
      activationAttempt.current += 1;
      confirming.current = false;
      setConfirmationOpen(false);
      setStatus(checkingState);
    } else {
      void checkForAutoUpdate();
    }
    return cancelAutoUpdate;
  }, [blocked, needRefresh, session.data?.userId, session.isError, session.isPending, cancelAutoUpdate, checkForAutoUpdate, clearActivationTimeout]);

  useEffect(() => {
    if (!needRefresh) return;
    const retry = () => void checkForAutoUpdate();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") retry();
      else cancelAutoUpdate();
    };
    window.addEventListener(EXPENSE_QUEUE_CHANGED_EVENT, retry);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener(EXPENSE_QUEUE_CHANGED_EVENT, retry);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [cancelAutoUpdate, checkForAutoUpdate, needRefresh]);

  function openConfirmation() {
    if (activationStarted.current) return;
    cancelAutoUpdate();
    confirming.current = true;
    setConfirmationOpen(true);
  }

  function cancelConfirmation() {
    confirming.current = false;
    setConfirmationOpen(false);
    void checkForAutoUpdate();
  }

  if (!needRefresh) return null;
  const busy = status.kind === "checking" || status.kind === "updating";
  return (
    <>
      <aside className={"update-prompt update-prompt--" + status.kind}>
        <div className="update-prompt__message" role="status" aria-atomic="true" aria-live="polite">
          {busy ? <LoaderCircle className="update-prompt__spinner" aria-hidden="true" size={16} /> : null}
          <span className="update-prompt__text">{status.message}</span>
        </div>
        <Button className="update-prompt__action" type="button" disabled={status.kind === "updating"} onClick={openConfirmation}>更新</Button>
      </aside>
      <ConfirmDialog
        open={confirmationOpen}
        title="更新"
        message="未保存内容将丢失，离线账单和附件保留。"
        confirmLabel="更新"
        onConfirm={() => void activateUpdate()}
        onCancel={cancelConfirmation}
      />
    </>
  );
}
