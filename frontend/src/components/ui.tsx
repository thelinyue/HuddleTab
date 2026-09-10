import { AlertCircle, LoaderCircle } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { errorMessage } from "../api/error";

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  busy?: boolean;
};

export function Button({ className, variant = "primary", busy = false, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={classes("button", `button--${variant}`, className)}
      disabled={disabled || busy}
      {...props}
    >
      {busy ? <LoaderCircle aria-hidden="true" className="spinner" size={18} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function Field({ label, hint, error, className, children }: { label: string; hint?: string; error?: string; className?: string; children: ReactNode }) {
  return (
    <label className={classes("field", className)}>
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={classes("input", className)} {...props} />;
});

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={classes("input", props.className)} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={classes("input", "textarea", props.className)} {...props} />;
}

export function ErrorNotice({ error }: { error: unknown }) {
  return (
    <div className="notice notice--error" role="alert">
      <AlertCircle aria-hidden="true" size={18} />
      <span>{errorMessage(error)}</span>
    </div>
  );
}

export function LoadingState({ label = "正在加载…" }: { label?: string }) {
  return (
    <div className="page-state" role="status">
      <LoaderCircle aria-hidden="true" className="spinner" size={24} />
      <span>{label}</span>
    </div>
  );
}

/**
 * 状态插画只承担装饰作用，状态含义仍由相邻标题、说明和操作表达。
 * 固定宽高与响应式 sizes 可以避免图片解码前后发生布局跳动。
 */
export function StateIllustration({
  src,
  size = "large",
  loading = "lazy",
  className,
}: {
  src: string;
  size?: "large" | "compact";
  loading?: "eager" | "lazy";
  className?: string;
}) {
  return (
    <img
      className={classes("state-illustration", `state-illustration--${size}`, className)}
      src={src}
      alt=""
      aria-hidden="true"
      width={960}
      height={640}
      loading={loading}
      decoding="async"
      sizes={size === "compact" ? "(max-width: 520px) calc(100vw - 64px), 240px" : "(max-width: 351px) calc(100vw - 32px), 320px"}
    />
  );
}

/**
 * 通用空状态保留默认图标，同时允许特定页面提供装饰性场景图。
 * 视觉内容不会改变标题、说明和恢复操作的语义层级。
 */
export function EmptyState({ icon, visual, title, description, action }: { icon: ReactNode; visual?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className={`empty-state${visual ? " empty-state--illustrated" : ""}`}>
      {visual ?? <span className="empty-state__icon" aria-hidden="true">{icon}</span>}
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

/**
 * 破坏性操作统一使用可访问的确认弹层，避免原生 confirm 在移动端阻塞页面并丢失焦点。
 * 弹层只负责确认语义；具体业务仍由调用方在确认后执行，因此不会引入新的数据流程。
 */
export function ConfirmDialog({
  open,
  title,
  message,
  error,
  confirmLabel = "确认",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  error?: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  onCancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const initial = dialog?.querySelector<HTMLElement>("button:not(:disabled)");
    initial?.focus();
    const focusableSelector = "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busyRef.current) onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="confirm-overlay" role="presentation">
      <button className="confirm-overlay__scrim" type="button" tabIndex={-1} aria-label={`取消${title}`} disabled={busy} onClick={onCancel} />
      <section ref={dialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <h2 id={titleId}>{title}</h2>
        <div id={descriptionId} className="confirm-dialog__message">{message}</div>
        {error ? <div className="confirm-dialog__error">{error}</div> : null}
        <div className="confirm-dialog__actions">
          <Button variant="secondary" type="button" disabled={busy} onClick={onCancel}>取消</Button>
          <Button variant="danger" type="button" busy={busy} disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </section>
    </div>
  );
}

export function Money({ value, tone = "neutral" }: { value: string; tone?: "neutral" | "positive" | "negative" }) {
  return <span className={`money money--${tone}`}>{value}</span>;
}
