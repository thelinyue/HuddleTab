"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  OctagonAlertIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useStateMotion } from "@/components/design-system/state-motion";
import { cn } from "@/lib/utils";

type StateNoticeTone = "neutral" | "info" | "success" | "warning" | "error";

const toneStyles: Record<
  StateNoticeTone,
  { readonly Icon: LucideIcon; readonly container: string; readonly icon: string }
> = {
  neutral: {
    Icon: InfoIcon,
    container: "border-border bg-surface-muted/70",
    icon: "bg-muted text-muted-foreground",
  },
  info: {
    Icon: InfoIcon,
    container: "border-primary/20 bg-primary/5",
    icon: "bg-primary/10 text-primary",
  },
  success: {
    Icon: CircleCheckIcon,
    container: "border-success/25 bg-success/5",
    icon: "bg-success/10 text-success",
  },
  warning: {
    Icon: TriangleAlertIcon,
    container: "border-warning/25 bg-orange/10",
    icon: "bg-orange/20 text-warning",
  },
  error: {
    Icon: OctagonAlertIcon,
    container: "border-destructive/30 bg-destructive/10",
    icon: "bg-destructive/10 text-destructive",
  },
};

/**
 * 页面级状态统一使用“图标 + 标题 + 解释 + 真实操作”的结构。颜色只作辅助，
 * 标题与图标共同表达状态；组件不内置重试等业务动作，避免绕过调用方权限判断。
 */
export function StateNotice({
  title,
  description,
  tone = "neutral",
  action,
  className,
  role,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly tone?: StateNoticeTone;
  readonly action?: ReactNode;
  readonly className?: string;
  readonly role?: "status" | "alert";
}) {
  const style = toneStyles[tone];
  const { Icon } = style;
  const scope = useRef<HTMLElement>(null);
  useStateMotion(scope, `${tone}:${title}`);

  return (
    <section
      ref={scope}
      role={role ?? (tone === "error" ? "alert" : undefined)}
      aria-label={title}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-lg border px-3 py-3 text-sm",
        style.container,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          style.icon,
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="font-semibold text-foreground">{title}</p>
        {description ? (
          <div className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {description}
          </div>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </section>
  );
}
