import type { ReactNode } from "react";

/** 页面标题仅提供布局插槽，不包含任何业务路径或动作逻辑。 */
export function AppHeader({
  title,
  eyebrow,
  subtitle,
  leading,
  actions,
}: {
  readonly title: string;
  readonly eyebrow?: string;
  readonly subtitle?: string;
  readonly leading?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className="flex min-h-12 items-start gap-3">
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="mb-0.5 text-xs font-medium text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
