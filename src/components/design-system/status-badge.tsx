import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "success" | "warning" | "destructive";
type StatusIcon = "info" | "success" | "sync" | "warning" | "error";

const iconConfig = {
  info: { Icon: InfoIcon, label: "提示状态" },
  success: { Icon: CircleCheckIcon, label: "成功状态" },
  sync: { Icon: RefreshCwIcon, label: "同步状态" },
  warning: { Icon: TriangleAlertIcon, label: "警告状态" },
  error: { Icon: CircleAlertIcon, label: "错误状态" },
} as const;

const toneClassName: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-primary/15 text-primary",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
};

/** 状态始终以文字和具名图标共同表达，色彩只作为辅助线索。 */
export function StatusBadge({
  tone,
  icon,
  children,
  className,
}: {
  readonly tone: StatusTone;
  readonly icon: StatusIcon;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const { Icon, label } = iconConfig[icon];
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1 rounded-md px-2 text-xs font-medium",
        toneClassName[tone],
        className,
      )}
    >
      <span role="img" aria-label={label}>
        <Icon aria-hidden="true" className="size-3.5" />
      </span>
      <span>{children}</span>
    </span>
  );
}
