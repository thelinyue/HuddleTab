"use client";

import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { MeSubpageHeader } from "./me-subpage-header";

/** 密码页先在客户端校验确认密码，服务端仍负责当前密码和最终密码规则校验。 */
export function PasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const passwordsMismatch = saveError === "新密码与确认密码不一致。";

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (newPassword !== confirmedPassword) {
      setSaveError("新密码与确认密码不一致。");
      return;
    }

    setSubmitting(true);
    setSaveError(null);
    setSuccessNotice(null);
    try {
      const response = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) throw new Error("密码修改失败，请检查当前密码。");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmedPassword("");
      setSuccessNotice("密码已修改。");
    } catch (reason) {
      setSaveError(
        reason instanceof Error ? reason.message : "密码修改失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="pb-6">
      <MeSubpageHeader title="修改密码" />
      <form
        className="mx-auto mt-5 grid max-w-md gap-5"
        onSubmit={(event) => void changePassword(event)}
      >
        <div className="grid gap-2">
          <Label htmlFor="account-current-password">当前密码</Label>
          <Input
            id="account-current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            aria-invalid={saveError && !passwordsMismatch ? true : undefined}
            aria-describedby={
              saveError && !passwordsMismatch ? "password-error" : undefined
            }
            minLength={8}
            maxLength={128}
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="account-new-password">新密码</Label>
          <Input
            id="account-new-password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            aria-invalid={saveError ? true : undefined}
            aria-describedby={saveError ? "password-error" : undefined}
            minLength={8}
            maxLength={128}
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="account-confirm-password">确认新密码</Label>
          <Input
            id="account-confirm-password"
            type="password"
            value={confirmedPassword}
            onChange={(event) => setConfirmedPassword(event.target.value)}
            autoComplete="new-password"
            aria-invalid={saveError ? true : undefined}
            aria-describedby={saveError ? "password-error" : undefined}
            minLength={8}
            maxLength={128}
            required
          />
        </div>

        {saveError ? (
          <p
            id="password-error"
            role="alert"
            className="type-label text-destructive"
          >
            {saveError}
          </p>
        ) : null}

        {successNotice ? (
          <p role="status" className="type-label text-success">
            {successNotice}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? "修改中…" : "确认修改"}
        </Button>
      </form>
    </section>
  );
}
