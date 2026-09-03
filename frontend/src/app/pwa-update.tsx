import { RefreshCw, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useCallback, useEffect, useState } from "react";
import { Button, IconButton } from "../components/ui";
import { useSessionQuery } from "../features/auth/api";
import { EXPENSE_QUEUE_CHANGED_EVENT } from "../features/accounting/expense-queue";
import { openHuddleTabDb } from "../pwa/indexed-db/database";
import type { MutationStatus } from "../pwa/indexed-db/schema";
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

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const session = useSessionQuery();
  const [updateGate, setUpdateGate] = useState<{ allowed: boolean; message?: string }>({ allowed: true });

  const refreshUpdateGate = useCallback(async () => {
    try {
      setUpdateGate(await readUpdateGate(session.data?.userId));
    } catch {
      setUpdateGate({ allowed: false, message: "无法确认本地同步状态，请稍后重试。" });
    }
  }, [session.data?.userId]);

  useEffect(() => {
    if (!needRefresh) return;
    void refreshUpdateGate();
  }, [needRefresh, refreshUpdateGate]);

  useEffect(() => {
    const handleQueueChange = () => {
      if (needRefresh) void refreshUpdateGate();
    };
    window.addEventListener(EXPENSE_QUEUE_CHANGED_EVENT, handleQueueChange);
    return () => window.removeEventListener(EXPENSE_QUEUE_CHANGED_EVENT, handleQueueChange);
  }, [needRefresh, refreshUpdateGate]);

  if (!needRefresh) return null;
  const requestUpdate = async () => {
    await refreshUpdateGate();
    const gate = await readUpdateGate(session.data?.userId);
    if (!gate.allowed) {
      setUpdateGate(gate);
      return;
    }
    await updateServiceWorker(true);
  };
  return (
    <aside className="update-prompt" role="status" aria-live="polite">
      <span><strong>{updateGate.allowed ? "有新版本可用" : updateGate.message}</strong>{updateGate.allowed ? <small>完成当前编辑后可刷新。</small> : null}</span>
      <Button disabled={!updateGate.allowed} onClick={() => void requestUpdate()}><RefreshCw aria-hidden="true" size={17} /> 刷新</Button>
      <IconButton label="稍后提醒" onClick={() => setNeedRefresh(false)}><X aria-hidden="true" size={18} /></IconButton>
    </aside>
  );
}
