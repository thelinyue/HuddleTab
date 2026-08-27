"use client";

import { LoaderCircle } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AccountMode = "login" | "register";

async function ensureSuccess(response: Response, fallback: string) {
  if (response.ok) return;
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string } }
    | undefined;
  throw new Error(body?.error?.message ?? fallback);
}

/** 登录与注册共用同一套凭证提交逻辑；注册完成后立刻建立 HttpOnly Session。 */
export function AccountForm({ mode }: { readonly mode: AccountMode }) {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username") ?? "");
    const password = String(form.get("password") ?? "");
    if (mode === "register" && password !== form.get("confirmPassword")) {
      setError("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "register") {
        const inviteProof = String(form.get("inviteProof") ?? "").trim();
        await ensureSuccess(
          await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nickname: String(form.get("nickname") ?? ""),
              username,
              password,
              ...(inviteProof ? { inviteProof } : {}),
            }),
          }),
          "注册失败，请稍后重试。",
        );
      }
      await ensureSuccess(
        await fetch("/api/auth/sign-in/username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        }),
        "登录失败，请检查用户名和密码。",
      );
      window.location.assign(new URL("/activities", window.location.origin).toString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-8 grid gap-5" onSubmit={(event) => void submit(event)}>
      {mode === "register" ? <Field id="nickname" label="昵称" autoComplete="name" /> : null}
      <Field id="username" label="用户名" autoComplete="username" />
      <Field id="password" label="密码" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} />
      {mode === "register" ? (
        <>
          <Field id="confirmPassword" label="确认密码" type="password" autoComplete="new-password" />
          <Field id="inviteProof" label="邀请凭证（受邀注册时填写）" autoComplete="off" required={false} />
        </>
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
        {mode === "login" ? "登录" : "注册"}
      </Button>
    </form>
  );
}

function Field({ id, label, type = "text", autoComplete, required = true }: { readonly id: string; readonly label: string; readonly type?: "text" | "password"; readonly autoComplete: string; readonly required?: boolean }) {
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label><Input id={id} name={id} type={type} required={required} minLength={type === "password" ? 8 : undefined} autoComplete={autoComplete} /></div>;
}
