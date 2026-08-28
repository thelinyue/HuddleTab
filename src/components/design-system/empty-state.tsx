"use client";

import { useRef, type ComponentType, type ReactNode } from "react";

import { useStateMotion } from "@/components/design-system/state-motion";

/** 空状态只定义可访问的信息层级，具体的恢复操作由调用方传入。 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  readonly icon: ComponentType<{ readonly className?: string; readonly "aria-hidden"?: boolean }>;
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  const scope = useRef<HTMLElement>(null);
  useStateMotion(scope, title);

  return (
    <section ref={scope} className="py-8 text-center" aria-label={title}>
      <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
        <Icon aria-hidden className="size-5" />
      </span>
      <h2 className="type-section-title font-semibold text-foreground">{title}</h2>
      <p className="type-caption mx-auto mt-1 max-w-sm text-muted-foreground [overflow-wrap:anywhere]">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </section>
  );
}
