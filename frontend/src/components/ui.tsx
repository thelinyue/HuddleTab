import { AlertCircle, LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
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

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={classes("input", props.className)} {...props} />;
}

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

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Money({ value, tone = "neutral" }: { value: string; tone?: "neutral" | "positive" | "negative" }) {
  return <span className={`money money--${tone}`}>{value}</span>;
}
