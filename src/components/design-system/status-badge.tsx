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

/** 状态至少以文字表达；需要强调来源时再附加具名图标，色彩始终只作辅助线索。 */
export function StatusBadge({
  tone,
  icon,
  children,
  className,
}: {
  readonly tone: StatusTone;
  readonly icon?: StatusIcon;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const iconEntry = icon ? iconConfig[icon] : null;
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border border-current/10 px-2.5 text-xs font-semibold",
        toneClassName[tone],
        className,
      )}
    >
      {iconEntry ? (
        <span role="img" aria-label={iconEntry.label}>
          <iconEntry.Icon aria-hidden="true" className="size-3.5" />
        </span>
      ) : null}
      <span>{children}</span>
    </span>
  );
}
