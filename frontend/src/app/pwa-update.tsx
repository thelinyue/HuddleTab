import { RefreshCw, X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button, IconButton } from "../components/ui";

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <aside className="update-prompt" role="status" aria-live="polite">
      <span><strong>伙记已有新版本</strong><small>完成当前编辑后再刷新，未保存表单不会被打断。</small></span>
      <Button onClick={() => void updateServiceWorker(true)}><RefreshCw aria-hidden="true" size={17} /> 刷新</Button>
      <IconButton label="稍后提醒" onClick={() => setNeedRefresh(false)}><X aria-hidden="true" size={18} /></IconButton>
    </aside>
  );
}
