"use client";

import { useEffect, useState } from "react";
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
};
export function MePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { updateThemePreference } = useThemePreference();
  useEffect(() => {
    void fetch("/api/me/profile", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("个人资料加载失败，请稍后重试。");
        return (await response.json()).data as Profile;
      })
      .then(setProfile)
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
    return <p className="py-8 text-muted-foreground">正在加载个人资料…</p>;
  return (
    <section className="py-5">
      <h1 className="text-2xl font-bold">我的</h1>
      <dl className="mt-5 space-y-3 border-y py-4 text-sm">
        <div>
          <dt className="text-muted-foreground">昵称</dt>
          <dd>{profile.nickname}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">用户名</dt>
          <dd>{profile.username}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">邮箱</dt>
          <dd>{profile.emailBound ? "已绑定" : "未绑定"}</dd>
        </div>
      </dl>
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
