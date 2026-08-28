"use client";

import {
  BadgeCheckIcon,
  ChevronRightIcon,
  KeyRoundIcon,
  LogOutIcon,
  MailIcon,
  ShieldCheckIcon,
  SunMoonIcon,
  UserRoundPenIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { MemberAvatar } from "@/components/design-system/member-avatar";
import { getMeProfile, type MeProfileDto } from "@/features/me/api";

const themeLabels: Record<MeProfileDto["themePreference"], string> = {
  SYSTEM: "跟随系统",
  LIGHT: "亮色",
  DARK: "暗色",
};

async function ensureSuccess(response: Response, message: string) {
  if (!response.ok) throw new Error(message);
}

/**
 * “我的”主页只编排已存在的账户路由，避免主页与二级表单维护两套资料状态。
 * `avatarPreset` 直接交给 MemberAvatar：历史 NULL 值仍会由成员标识稳定回退。
 */
export function MePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<MeProfileDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void getMeProfile()
      .then(setProfile)
      .catch((reason: unknown) =>
        setLoadError(
          reason instanceof Error
            ? reason.message
            : "个人资料加载失败，请稍后重试。",
        ),
      );
  }, []);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setNotice(null);
    try {
      await ensureSuccess(
        await fetch("/api/auth/sign-out", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
        "退出登录失败，请稍后重试。",
      );
      router.replace("/login");
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "退出登录失败，请稍后重试。",
      );
    } finally {
      setSigningOut(false);
    }
  };

  if (loadError)
    return (
      <p role="alert" className="py-8 text-destructive">
        {loadError}
      </p>
    );
  if (!profile)
    return (
      <p role="status" className="py-8 text-muted-foreground">
        正在加载个人资料…
      </p>
    );

  return (
    <section className="py-2">
      <h1 className="type-page-title flex min-h-12 items-center font-semibold">
        我的
      </h1>

      <section
        aria-label="个人资料"
        className="mt-3 flex items-center gap-4 rounded-lg bg-secondary px-4 py-5 text-secondary-foreground"
      >
        <MemberAvatar
          memberId={profile.username}
          displayName={profile.nickname}
          avatarPreset={profile.avatarPreset}
          className="size-16 ring-2 ring-primary/20"
        />
        <div className="min-w-0 flex-1">
          <h2 className="type-page-title truncate font-semibold">
            {profile.nickname}
          </h2>
          <p className="type-body mt-0.5 truncate text-muted-foreground">
            @{profile.username}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="type-caption inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-medium text-foreground">
              <BadgeCheckIcon aria-hidden="true" className="size-3.5" />
              {profile.emailBound ? "邮箱已绑定" : "邮箱未绑定"}
            </span>
            {profile.isSystemAdmin ? (
              <span className="type-caption inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                系统管理员
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <SettingsSection id="account-security" title="账户与安全">
        <SettingsRow
          Icon={UserRoundPenIcon}
          title="个人资料"
          description={`@${profile.username}`}
          href="/me/profile"
        />
        <SettingsRow
          Icon={MailIcon}
          title="邮箱"
          description={profile.emailBound ? "用于账户安全与找回" : "尚未绑定真实邮箱"}
          trailing={
            <span
              className={`type-label ${profile.emailBound ? "text-success" : "text-warning"}`}
            >
              {profile.emailBound ? "已绑定" : "未绑定"}
            </span>
          }
          href="/me/email"
        />
        <SettingsRow
          Icon={KeyRoundIcon}
          title="修改密码"
          description="更新当前登录凭证"
          href="/me/password"
        />
      </SettingsSection>

      <SettingsSection id="preferences" title="偏好设置">
        <SettingsRow
          Icon={SunMoonIcon}
          title="主题"
          description="调整应用显示模式"
          trailing={themeLabels[profile.themePreference]}
          ariaLabel={`主题：${themeLabels[profile.themePreference]}`}
          href="/me/theme"
        />
      </SettingsSection>

      {profile.isSystemAdmin ? (
        <SettingsSection id="management" title="管理">
          <SettingsRow
            Icon={ShieldCheckIcon}
            title="系统管理"
            description="用户与系统运行设置"
            href="/admin"
          />
        </SettingsSection>
      ) : null}

      {notice ? (
        <p role="alert" className="type-label mt-3 text-destructive">
          {notice}
        </p>
      ) : null}

      <button
        type="button"
        disabled={signingOut}
        className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-destructive/30 disabled:opacity-50"
        onClick={() => void signOut()}
      >
        <LogOutIcon aria-hidden="true" className="size-4" />
        {signingOut ? "正在退出…" : "退出登录"}
      </button>

      <p className="type-caption mt-6 text-center text-muted-foreground">
        HuddleTab V1
      </p>
    </section>
  );
}

function SettingsSection({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-6">
      <h2 id={id} className="type-section-title mb-2 font-semibold">
        {title}
      </h2>
      <div className="divide-y overflow-hidden rounded-lg border bg-surface">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  Icon,
  title,
  description,
  trailing,
  ariaLabel,
  href,
}: {
  readonly Icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly trailing?: ReactNode;
  readonly ariaLabel?: string;
  readonly href: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel ?? title}
      className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-foreground transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="type-body block font-medium">{title}</span>
        <span className="type-caption mt-0.5 block truncate text-muted-foreground">
          {description}
        </span>
      </span>
      {trailing ? (
        <span className="shrink-0 text-muted-foreground">{trailing}</span>
      ) : null}
      <ChevronRightIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}
