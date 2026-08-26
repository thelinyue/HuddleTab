"use client";

import { LoaderCircle, Mail, Send, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { AppFrame } from "@/components/design-system/app-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RegistrationPolicy = "INVITE_ONLY" | "OPEN";
type SmtpView = {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly host?: string;
  readonly port?: number;
  readonly secure?: boolean;
  readonly username?: string;
};

type SmtpForm = {
  enabled: boolean;
  host: string;
  port: string;
  secure: boolean;
  username: string;
  password: string;
};

const emptySmtp: SmtpForm = {
  enabled: false,
  host: "",
  port: "587",
  secure: false,
  username: "",
  password: "",
};

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || !body.data)
    throw new Error(body.error?.message ?? "设置保存失败，请稍后重试。");
  return body.data;
}

/**
 * 系统设置页只请求安全读取模型：密码输入框永远从空值开始，避免浏览器、React 状态和
 * 后续请求意外保留已存 SMTP 密码。所有写入仍须由服务端平台管理员守卫复验。
 */
export default function AdminSettingsPage() {
  const [policy, setPolicy] = useState<RegistrationPolicy>("INVITE_ONLY");
  const [smtp, setSmtp] = useState<SmtpForm>(emptySmtp);
  const [recipient, setRecipient] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"policy" | "smtp" | "test" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/admin/registration-policy", { cache: "no-store" }).then(
        readData<{ policy: RegistrationPolicy }>,
      ),
      fetch("/api/admin/smtp", { cache: "no-store" }).then(readData<SmtpView>),
    ])
      .then(([registration, smtpView]) => {
        setPolicy(registration.policy);
        setSmtp({
          enabled: smtpView.enabled,
          host: smtpView.host ?? "",
          port: String(smtpView.port ?? 587),
          secure: smtpView.secure ?? false,
          username: smtpView.username ?? "",
          password: "",
        });
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "设置加载失败，请稍后重试。",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  async function savePolicy() {
    setSaving("policy");
    setError(null);
    setNotice(null);
    try {
      await readData<{ policy: RegistrationPolicy }>(
        await fetch("/api/admin/registration-policy", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ policy }),
        }),
      );
      setNotice("注册策略已保存。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "注册策略保存失败。");
    } finally {
      setSaving(null);
    }
  }

  async function saveSmtp() {
    setSaving("smtp");
    setError(null);
    setNotice(null);
    try {
      const view = await readData<SmtpView>(
        await fetch("/api/admin/smtp", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...smtp, port: Number(smtp.port) }),
        }),
      );
      setSmtp((current) => ({
        ...current,
        enabled: view.enabled,
        host: view.host ?? "",
        port: String(view.port ?? 587),
        secure: view.secure ?? false,
        username: view.username ?? "",
        password: "",
      }));
      setNotice(view.enabled ? "SMTP 配置已保存。" : "SMTP 已停用。");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "SMTP 配置保存失败。",
      );
    } finally {
      setSaving(null);
    }
  }

  async function testSmtp() {
    setSaving("test");
    setError(null);
    setNotice(null);
    try {
      await readData<{ sent: true }>(
        await fetch("/api/admin/smtp/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient }),
        }),
      );
      setNotice("测试邮件已提交发送。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "测试邮件发送失败。");
    } finally {
      setSaving(null);
    }
  }

  return (
    <AppFrame wide>
      <section className="py-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">系统设置</h1>
            <p className="mt-1 text-sm text-muted-foreground">注册与邮件服务</p>
          </div>
        </div>

        {loading ? (
          <div className="flex min-h-48 items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            正在加载设置…
          </div>
        ) : (
          <div className="mt-7 space-y-9">
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="text-sm text-primary">
                {notice}
              </p>
            ) : null}

            <section
              aria-labelledby="registration-heading"
              className="border-y py-5"
            >
              <h2 id="registration-heading" className="text-base font-semibold">
                注册策略
              </h2>
              <div className="mt-4 grid gap-2 sm:max-w-md sm:grid-cols-2">
                {(
                  [
                    ["INVITE_ONLY", "仅邀请"],
                    ["OPEN", "开放注册"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-input px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="registration-policy"
                      value={value}
                      checked={policy === value}
                      onChange={() => setPolicy(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <Button
                className="mt-4"
                onClick={() => void savePolicy()}
                disabled={saving !== null}
              >
                {saving === "policy" ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : null}
                保存注册策略
              </Button>
            </section>

            <section aria-labelledby="smtp-heading" className="border-b pb-6">
              <div className="flex items-center gap-2">
                <Mail
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <h2 id="smtp-heading" className="text-base font-semibold">
                  SMTP
                </h2>
              </div>
              <label className="mt-4 flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={smtp.enabled}
                  onChange={(event) =>
                    setSmtp({ ...smtp, enabled: event.target.checked })
                  }
                />
                启用邮件服务
              </label>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="服务器"
                  value={smtp.host}
                  disabled={!smtp.enabled}
                  onChange={(host) => setSmtp({ ...smtp, host })}
                />
                <Field
                  label="端口"
                  value={smtp.port}
                  disabled={!smtp.enabled}
                  inputMode="numeric"
                  onChange={(port) => setSmtp({ ...smtp, port })}
                />
                <Field
                  label="用户名"
                  value={smtp.username}
                  disabled={!smtp.enabled}
                  onChange={(username) => setSmtp({ ...smtp, username })}
                />
                <Field
                  label="密码"
                  value={smtp.password}
                  disabled={!smtp.enabled}
                  type="password"
                  autoComplete="new-password"
                  onChange={(password) => setSmtp({ ...smtp, password })}
                />
              </div>
              <label className="mt-4 flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={smtp.secure}
                  disabled={!smtp.enabled}
                  onChange={(event) =>
                    setSmtp({ ...smtp, secure: event.target.checked })
                  }
                />
                使用 TLS 直连
              </label>
              <Button
                className="mt-4"
                onClick={() => void saveSmtp()}
                disabled={saving !== null}
              >
                {saving === "smtp" ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : null}
                保存 SMTP
              </Button>

              <div className="mt-7 border-t pt-5">
                <Label htmlFor="smtp-test-recipient">测试收件人</Label>
                <div className="mt-2 flex flex-col gap-2 sm:max-w-md sm:flex-row">
                  <Input
                    id="smtp-test-recipient"
                    type="email"
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder="name@example.com"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void testSmtp()}
                    disabled={saving !== null}
                  >
                    {saving === "test" ? (
                      <LoaderCircle
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Send aria-hidden="true" />
                    )}
                    发送测试
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}
      </section>
    </AppFrame>
  );
}

function Field({
  label,
  value,
  disabled,
  onChange,
  type = "text",
  inputMode,
  autoComplete,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly type?: "text" | "password";
  readonly inputMode?: "numeric";
  readonly autoComplete?: string;
}) {
  const id = `smtp-${label}`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
