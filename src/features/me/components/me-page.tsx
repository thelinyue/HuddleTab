"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/design-system/app-header";
import { MemberAvatar } from "@/components/design-system/member-avatar";
import { useThemePreference } from "@/components/design-system/theme-provider";
import {
  ThemeSelector,
  type ThemeValue,
} from "@/features/me/components/theme-selector";

type Profile = {
  readonly nickname: string;
  readonly username: string;
  readonly emailBound: boolean;
  readonly themePreference: ThemeValue;
  readonly isSystemAdmin: boolean;
};
export function MePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { updateThemePreference } = useThemePreference();
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  useEffect(() => {
    void fetch("/api/me/profile", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("个人资料加载失败，请稍后重试。");
        return (await response.json()).data as Profile;
      })
      .then((next) => { setProfile(next); setNickname(next.nickname); })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "个人资料加载失败，请稍后重试。",
        ),
      );
  }, []);
  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!profile)
    return <p role="status" className="py-8 text-muted-foreground">正在加载个人资料…</p>;
  return (
    <section className="py-5">
      <AppHeader
        eyebrow={`@${profile.username}`}
        title={profile.nickname}
        subtitle={`邮箱${profile.emailBound ? "已绑定" : "未绑定"}`}
        leading={<MemberAvatar memberId={profile.username} displayName={profile.nickname} className="size-14 text-lg" />}
      />
      <section className="mt-6 space-y-4 border-t pt-5" aria-labelledby="account-heading">
        <h2 id="account-heading" className="text-base font-semibold">账户</h2>
        <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void fetch("/api/me/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nickname }) }).then(async (response) => { if (!response.ok) throw new Error("昵称保存失败，请稍后重试。"); setProfile({ ...profile, nickname }); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "昵称保存失败，请稍后重试。")); }}><label htmlFor="profile-nickname" className="text-sm font-medium">昵称</label><div className="flex gap-2"><input id="profile-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} className="min-h-11 min-w-0 flex-1 border bg-background px-3" required maxLength={40} /><button type="submit" className="min-h-11 border px-3 text-sm">保存</button></div></form>
        {!profile.emailBound ? <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void fetch("/api/me/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).then(async (response) => { if (!response.ok) throw new Error("邮箱绑定失败，请检查后重试。"); setProfile({ ...profile, emailBound: true }); setEmail(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "邮箱绑定失败，请稍后重试。")); }}><label htmlFor="profile-email" className="text-sm font-medium">绑定真实邮箱</label><div className="flex gap-2"><input id="profile-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-h-11 min-w-0 flex-1 border bg-background px-3" required autoComplete="email" /><button type="submit" className="min-h-11 border px-3 text-sm">绑定</button></div></form> : null}
        <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void fetch("/api/me/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) }).then(async (response) => { if (!response.ok) throw new Error("密码修改失败，请检查当前密码。"); setCurrentPassword(""); setNewPassword(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "密码修改失败，请稍后重试。")); }}><label htmlFor="current-password" className="text-sm font-medium">当前密码</label><input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="min-h-11 border bg-background px-3" required autoComplete="current-password" /><label htmlFor="new-password" className="text-sm font-medium">新密码</label><div className="flex gap-2"><input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="min-h-11 min-w-0 flex-1 border bg-background px-3" required minLength={8} autoComplete="new-password" /><button type="submit" className="min-h-11 border px-3 text-sm">修改密码</button></div></form>
        <button type="button" className="min-h-11 border px-3 text-sm" onClick={() => void fetch("/api/auth/sign-out", { method: "POST" }).then(() => window.location.assign("/login"))}>退出登录</button>
        {profile.isSystemAdmin ? <Link href="/admin" className="flex min-h-11 items-center text-sm text-primary">系统管理</Link> : null}
      </section>
      <div className="mt-6">
        <ThemeSelector
          value={profile.themePreference}
          onChange={(next) => {
            void updateThemePreference(next)
              .then(() => setProfile({ ...profile, themePreference: next }))
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "主题偏好保存失败，请稍后重试。",
                ),
              );
          }}
        />
      </div>
      <p className="mt-8 text-sm text-muted-foreground">HuddleTab V1</p>
    </section>
  );
}
