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
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { MemberAvatar } from "@/components/design-system/member-avatar";
import { useThemePreference } from "@/components/design-system/theme-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveFormOverlay } from "@/features/expenses/components/responsive-form-overlay";
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

type Panel = "PROFILE" | "EMAIL" | "PASSWORD" | "THEME" | null;

const themeLabels: Record<ThemeValue, string> = {
  SYSTEM: "跟随系统",
  LIGHT: "亮色",
  DARK: "暗色",
};

async function ensureSuccess(response: Response, message: string) {
  if (!response.ok) throw new Error(message);
}

/**
 * 个人页只负责账户能力编排：列表用于浏览，响应式 Overlay 承载编辑。
 * 服务端仍是资料、主题和凭证变更的最终校验边界，页面不会推断额外账户信息。
 */
export function MePage() {
  const router = useRouter();
  const { updateThemePreference } = useThemePreference();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [submitting, setSubmitting] = useState(false);
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
      .then((next) => {
        setProfile(next);
        setNickname(next.nickname);
      })
      .catch((reason: unknown) =>
        setLoadError(
          reason instanceof Error
            ? reason.message
            : "个人资料加载失败，请稍后重试。",
        ),
      );
  }, []);

  const openPanel = (next: Exclude<Panel, null>) => {
    setPanelError(null);
    setNotice(null);
    setPanel(next);
  };

  const closePanel = () => {
    if (submitting) return;
    setPanel(null);
    setPanelError(null);
  };

  const saveNickname = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || submitting) return;
    setSubmitting(true);
    setPanelError(null);
    try {
      await ensureSuccess(
        await fetch("/api/me/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname }),
        }),
        "昵称保存失败，请稍后重试。",
      );
      setProfile({ ...profile, nickname });
      setPanel(null);
      setNotice("昵称已更新。");
    } catch (reason) {
      setPanelError(
        reason instanceof Error ? reason.message : "昵称保存失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const bindEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || submitting) return;
    setSubmitting(true);
    setPanelError(null);
    try {
      await ensureSuccess(
        await fetch("/api/me/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }),
        "邮箱绑定失败，请检查后重试。",
      );
      setProfile({ ...profile, emailBound: true });
      setEmail("");
      setPanel(null);
      setNotice("邮箱已绑定。");
    } catch (reason) {
      setPanelError(
        reason instanceof Error ? reason.message : "邮箱绑定失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setPanelError(null);
    try {
      await ensureSuccess(
        await fetch("/api/me/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, newPassword }),
        }),
        "密码修改失败，请检查当前密码。",
      );
      setCurrentPassword("");
      setNewPassword("");
      setPanel(null);
      setNotice("密码已修改。");
    } catch (reason) {
      setPanelError(
        reason instanceof Error ? reason.message : "密码修改失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const changeTheme = async (next: ThemeValue) => {
    if (!profile || submitting || next === profile.themePreference) return;
    setSubmitting(true);
    setPanelError(null);
    try {
      await updateThemePreference(next);
      setProfile({ ...profile, themePreference: next });
      setPanel(null);
      setNotice(`主题已切换为${themeLabels[next]}。`);
    } catch (reason) {
      setPanelError(
        reason instanceof Error
          ? reason.message
          : "主题偏好保存失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = async () => {
    if (submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      await ensureSuccess(
        await fetch("/api/auth/sign-out", { method: "POST" }),
        "退出登录失败，请稍后重试。",
      );
      router.replace("/login");
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "退出登录失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
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
        className="mt-3 flex items-center gap-4 rounded-lg bg-primary px-4 py-5 text-primary-foreground"
      >
        <MemberAvatar
          memberId={profile.username}
          displayName={profile.nickname}
          className="size-16 ring-2 ring-primary-foreground/40"
        />
        <div className="min-w-0 flex-1">
          <h2 className="type-page-title truncate font-semibold">
            {profile.nickname}
          </h2>
          <p className="type-body mt-0.5 truncate opacity-80">
            @{profile.username}
          </p>
          <span className="type-caption mt-2 inline-flex items-center gap-1 rounded-full bg-primary-foreground/15 px-2 py-0.5 font-medium">
            <BadgeCheckIcon aria-hidden="true" className="size-3.5" />
            {profile.emailBound ? "邮箱已绑定" : "邮箱未绑定"}
          </span>
        </div>
      </section>

      {notice ? (
        <p role="status" className="type-label mt-3 text-success">
          {notice}
        </p>
      ) : null}

      <SettingsSection id="account-security" title="账户与安全">
        <SettingsRow
          Icon={UserRoundPenIcon}
          title="个人资料"
          description={`@${profile.username}`}
          actionLabel="编辑个人资料"
          onClick={() => openPanel("PROFILE")}
        />
        {profile.emailBound ? (
          <SettingsRow
            Icon={MailIcon}
            title="邮箱"
            description="用于账户安全与找回"
            trailing={<span className="type-label text-success">已绑定</span>}
          />
        ) : (
          <SettingsRow
            Icon={MailIcon}
            title="邮箱"
            description="尚未绑定真实邮箱"
            trailing={<span className="type-label text-warning">未绑定</span>}
            actionLabel="绑定邮箱"
            onClick={() => openPanel("EMAIL")}
          />
        )}
        <SettingsRow
          Icon={KeyRoundIcon}
          title="修改密码"
          description="更新当前登录凭证"
          actionLabel="修改密码"
          onClick={() => openPanel("PASSWORD")}
        />
      </SettingsSection>

      <SettingsSection id="preferences" title="偏好设置">
        <SettingsRow
          Icon={SunMoonIcon}
          title="主题"
          description="调整应用显示模式"
          trailing={themeLabels[profile.themePreference]}
          actionLabel={`主题：${themeLabels[profile.themePreference]}`}
          onClick={() => openPanel("THEME")}
        />
      </SettingsSection>

      {profile.isSystemAdmin ? (
        <SettingsSection id="management" title="管理">
          <SettingsRow
            Icon={ShieldCheckIcon}
            title="系统管理"
            description="用户与系统运行设置"
            href="/admin"
            actionLabel="系统管理"
          />
        </SettingsSection>
      ) : null}

      <button
        type="button"
        disabled={submitting}
        className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 font-medium text-destructive disabled:opacity-50"
        onClick={() => void signOut()}
      >
        <LogOutIcon aria-hidden="true" className="size-4" />
        {submitting ? "正在退出…" : "退出登录"}
      </button>

      <p className="type-caption mt-6 text-center text-muted-foreground">
        HuddleTab V1
      </p>

      <ResponsiveFormOverlay
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) closePanel();
        }}
        title={
          panel === "PROFILE"
            ? "编辑个人资料"
            : panel === "EMAIL"
              ? "绑定邮箱"
              : panel === "PASSWORD"
                ? "修改密码"
                : "主题"
        }
      >
        {panel === "PROFILE" ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => void saveNickname(event)}
          >
            <Field
              id="profile-nickname"
              label="昵称"
              value={nickname}
              onChange={setNickname}
              autoComplete="name"
              maxLength={40}
            />
            <PanelError message={panelError} />
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? "保存中…" : "保存"}
            </Button>
          </form>
        ) : null}

        {panel === "EMAIL" ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => void bindEmail(event)}
          >
            <Field
              id="profile-email"
              label="真实邮箱"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
            />
            <PanelError message={panelError} />
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? "绑定中…" : "绑定邮箱"}
            </Button>
          </form>
        ) : null}

        {panel === "PASSWORD" ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => void changePassword(event)}
          >
            <Field
              id="current-password"
              label="当前密码"
              type="password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
              minLength={8}
            />
            <Field
              id="new-password"
              label="新密码"
              type="password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              minLength={8}
            />
            <PanelError message={panelError} />
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? "修改中…" : "确认修改"}
            </Button>
          </form>
        ) : null}

        {panel === "THEME" ? (
          <div className="grid gap-4">
            <ThemeSelector
              value={profile.themePreference}
              onChange={(next) => void changeTheme(next)}
            />
            <PanelError message={panelError} />
          </div>
        ) : null}
      </ResponsiveFormOverlay>
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
      <div className="border-y">{children}</div>
    </section>
  );
}

function SettingsRow({
  Icon,
  title,
  description,
  trailing,
  actionLabel,
  onClick,
  href,
}: {
  readonly Icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly trailing?: ReactNode;
  readonly actionLabel?: string;
  readonly onClick?: () => void;
  readonly href?: string;
}) {
  const content = (
    <>
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
        <span className="type-label shrink-0 text-muted-foreground">
          {trailing}
        </span>
      ) : null}
      {onClick || href ? (
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      ) : null}
    </>
  );
  const className =
    "flex min-h-16 w-full items-center gap-3 border-b py-2 text-foreground last:border-b-0";

  if (href)
    return (
      <Link href={href} aria-label={actionLabel ?? title} className={className}>
        {content}
      </Link>
    );
  if (onClick)
    return (
      <button
        type="button"
        aria-label={actionLabel ?? title}
        className={className}
        onClick={onClick}
      >
        {content}
      </button>
    );
  return <div className={className}>{content}</div>;
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  minLength,
  maxLength,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: "text" | "email" | "password";
  readonly autoComplete: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        minLength={minLength}
        maxLength={maxLength}
        autoComplete={autoComplete}
      />
    </div>
  );
}

function PanelError({ message }: { readonly message: string | null }) {
  return message ? (
    <p role="alert" className="type-label text-destructive">
      {message}
    </p>
  ) : null;
}
