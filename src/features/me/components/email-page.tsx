"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMeProfile, type MeProfileDto } from "@/features/me/api";

import { MeSubpageHeader } from "./me-subpage-header";

/**
 * 邮箱页始终以资料接口返回的脱敏地址和验证状态展示账户信息，
 * 不在客户端推导邮箱，也不会将身份系统的合成邮箱暴露给用户。
 */
export function EmailPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<MeProfileDto | null>(null);
  const [email, setEmail] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void getMeProfile()
      .then(setProfile)
      .catch((reason: unknown) => {
        setLoadError(
          reason instanceof Error
            ? reason.message
            : "邮箱资料加载失败，请稍后重试。",
        );
      });
  }, []);

  const saveEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/me/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error("邮箱绑定失败，请检查后重试。");
      router.replace("/me");
      router.refresh();
    } catch (reason) {
      setSaveError(
        reason instanceof Error ? reason.message : "邮箱绑定失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loadError) {
    return (
      <p role="alert" className="py-8 text-destructive">
        {loadError}
      </p>
    );
  }

  if (!profile) {
    return (
      <p role="status" className="py-8 text-muted-foreground">
        正在加载邮箱资料…
      </p>
    );
  }

  const isBound = profile.emailBound && profile.maskedEmail !== null;

  return (
    <section className="pb-6">
      <MeSubpageHeader title="邮箱" />
      <form
        className="mx-auto mt-5 grid max-w-md gap-5"
        onSubmit={(event) => void saveEmail(event)}
      >
        <section aria-label="当前邮箱" className="grid gap-2 border-y py-4">
          <p className="type-label text-muted-foreground">当前邮箱</p>
          <p className="type-body font-medium">
            {isBound ? profile.maskedEmail : "尚未绑定邮箱"}
          </p>
          {isBound ? (
            <p
              className={`type-label ${
                profile.emailVerified ? "text-success" : "text-warning"
              }`}
            >
              {profile.emailVerified ? "已验证" : "未验证"}
            </p>
          ) : null}
        </section>

        <div className="grid gap-2">
          <Label htmlFor="account-email">真实邮箱</Label>
          <Input
            id="account-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            aria-invalid={saveError ? true : undefined}
            aria-describedby={saveError ? "email-error" : undefined}
            required
          />
        </div>

        {saveError ? (
          <p
            id="email-error"
            role="alert"
            className="type-label text-destructive"
          >
            {saveError}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? "提交中…" : isBound ? "更换邮箱" : "绑定邮箱"}
        </Button>
      </form>
    </section>
  );
}
