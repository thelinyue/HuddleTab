import { StatusBadge } from "./status-badge";

type SyncTone = "synced" | "pending" | "offline" | "error";

const syncContent: Record<
  SyncTone,
  { readonly badgeTone: "neutral" | "success" | "warning" | "destructive"; readonly icon: "success" | "sync" | "error"; readonly label: string }
> = {
  synced: { badgeTone: "success", icon: "success", label: "已同步" },
  pending: { badgeTone: "warning", icon: "sync", label: "等待同步" },
  offline: { badgeTone: "neutral", icon: "sync", label: "离线待同步" },
  error: { badgeTone: "destructive", icon: "error", label: "同步失败" },
};

/** 同步状态只展示可识别的语义，不执行重试或网络操作。 */
export function SyncStatus({ tone, className }: { readonly tone: SyncTone; readonly className?: string }) {
  const content = syncContent[tone];

  return (
    <StatusBadge tone={content.badgeTone} icon={content.icon} className={className}>
      {content.label}
    </StatusBadge>
  );
}
