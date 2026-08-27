import type { ComponentType, ReactNode } from "react";

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
  return (
    <section className="py-10 text-center" aria-label={title}>
      <Icon aria-hidden className="mx-auto mb-3 size-8 text-muted-foreground" />
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </section>
  );
}
