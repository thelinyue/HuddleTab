"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SetupFormValues = {
  nickname: string;
  username: string;
  password: string;
  confirmPassword: string;
};

const initialValues: SetupFormValues = {
  nickname: "",
  username: "",
  password: "",
  confirmPassword: "",
};

async function ensureSuccess(
  response: Response,
  fallback: string,
): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => undefined)) as
    { error?: { message?: string } } | undefined;
  throw new Error(body?.error?.message ?? fallback);
}

/**
 * 管理员创建已提交成功但浏览器会话未写入时，用户可使用同一组凭证重新提交。
 * 此时服务端的永久关闭标记会返回 SETUP_COMPLETED；它不代表凭证不可用于登录。
 */
async function ensureSetupCanSignIn(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => undefined)) as
    { error?: { code?: string; message?: string } } | undefined;
  if (body?.error?.code === "SETUP_COMPLETED") return;
  throw new Error(body?.error?.message ?? "管理员初始化失败，请稍后重试。");
}

/**
 * 首次部署只展示一次的管理员创建表单。凭证只在提交期间保存在组件状态中，成功后立即
 * 交由 Better Auth 写入 HttpOnly Session Cookie，并通过整页导航刷新所有初始化状态。
 */
export function SetupForm() {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<Key extends keyof SetupFormValues>(
    key: Key,
    value: SetupFormValues[Key],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (values.password !== values.confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);
    try {
      const setupResponse = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: values.nickname,
          username: values.username,
          password: values.password,
        }),
      });
      await ensureSetupCanSignIn(setupResponse);

      const signInResponse = await fetch("/api/auth/sign-in/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: values.username,
          password: values.password,
        }),
      });
      await ensureSuccess(
        signInResponse,
        "管理员已创建，但自动登录失败，请使用刚创建的账号重新登录。",
      );
      window.location.assign(
        new URL("/activities", window.location.origin).toString(),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "管理员初始化失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-5 py-12 sm:px-8">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold">伙记</p>
          <h1 className="text-2xl font-bold">初始化管理员</h1>
        </div>
      </div>

      <form
        className="mt-8 grid gap-5"
        onSubmit={(event) => void submit(event)}
      >
        <Field
          id="setup-nickname"
          label="管理员昵称"
          value={values.nickname}
          autoComplete="name"
          onChange={(value) => update("nickname", value)}
        />
        <Field
          id="setup-username"
          label="用户名"
          value={values.username}
          autoComplete="username"
          onChange={(value) => update("username", value)}
        />
        <Field
          id="setup-password"
          label="密码"
          value={values.password}
          type="password"
          autoComplete="new-password"
          onChange={(value) => update("password", value)}
        />
        <Field
          id="setup-confirm-password"
          label="确认密码"
          value={values.confirmPassword}
          type="password"
          autoComplete="new-password"
          invalid={error === "两次输入的密码不一致。"}
          onChange={(value) => update("confirmPassword", value)}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : null}
          完成初始化
        </Button>
      </form>
    </main>
  );
}

function Field({
  id,
  label,
  value,
  type = "text",
  autoComplete,
  invalid = false,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly type?: "text" | "password";
  readonly autoComplete: string;
  readonly invalid?: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        required
        minLength={type === "password" ? 8 : undefined}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
