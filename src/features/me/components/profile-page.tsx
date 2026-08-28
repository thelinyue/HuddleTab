"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { MemberAvatar } from "@/components/design-system/member-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getMeProfile,
  updateMeProfile,
  type MeProfileDto,
} from "@/features/me/api";
import {
  DEFAULT_AVATAR_PRESET,
  type AvatarPreset,
} from "@/features/me/avatar-presets";

import { AvatarPresetPicker } from "./avatar-preset-picker";
import { MeSubpageHeader } from "./me-subpage-header";

/**
 * 资料编辑页将服务端资料复制到受控表单中。保存失败时不重置本地状态，
 * 让用户修正后直接重试；旧账户的空头像则只在编辑界面回退到默认预设。
 */
export function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<MeProfileDto | null>(null);
  const [nickname, setNickname] = useState("");
  const [avatarPreset, setAvatarPreset] = useState<AvatarPreset>(
    DEFAULT_AVATAR_PRESET,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void getMeProfile()
      .then((next) => {
        setProfile(next);
        setNickname(next.nickname);
        setAvatarPreset(next.avatarPreset ?? DEFAULT_AVATAR_PRESET);
      })
      .catch((reason: unknown) => {
        setLoadError(
          reason instanceof Error
            ? reason.message
            : "个人资料加载失败，请稍后重试。",
        );
      });
  }, []);

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || submitting) return;

    setSubmitting(true);
    setSaveError(null);
    try {
      await updateMeProfile({ nickname, avatarPreset });
      router.replace("/me");
      router.refresh();
    } catch (reason) {
      setSaveError(
        reason instanceof Error
          ? reason.message
          : "个人资料保存失败，请稍后重试。",
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
        正在加载个人资料…
      </p>
    );
  }

  return (
    <section className="pb-6">
      <MeSubpageHeader title="个人资料" />
      <form
        className="mx-auto mt-5 grid max-w-md gap-5"
        onSubmit={(event) => void saveProfile(event)}
      >
        <div className="flex flex-col items-center gap-3">
          <MemberAvatar
            memberId={profile.username}
            displayName="当前"
            avatarPreset={avatarPreset}
            className="size-28 ring-4 ring-primary/10"
          />
          <p className="type-body text-center text-muted-foreground">
            在此管理您的昵称、头像与账户信息
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="profile-nickname">昵称</Label>
          <Input
            id="profile-nickname"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            autoComplete="name"
            maxLength={40}
            required
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="profile-username">用户名</Label>
          <Input id="profile-username" value={profile.username} readOnly />
          <p className="type-caption text-muted-foreground">
            系统唯一标识，暂不支持修改。
          </p>
        </div>

        <AvatarPresetPicker value={avatarPreset} onChange={setAvatarPreset} />

        {saveError ? (
          <p role="alert" className="type-label text-destructive">
            {saveError}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? "保存中…" : "保存"}
        </Button>
      </form>
    </section>
  );
}
