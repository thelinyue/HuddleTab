import {
  ChevronRight,
  Check,
  KeyRound,
  UserRound,
  LogOut,
  LoaderCircle,
  Monitor,
  Moon,
  Pencil,
  ShieldCheck,
  Sun,
  SunMoon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, ErrorNotice, Field, Input } from "../../components/ui";
import {
  AVATAR_PRESETS,
  DEFAULT_AVATAR_PRESET,
  MemberAvatar,
  type AvatarPreset,
} from "../../components/member-avatar";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { Overlay } from "../../components/overlay";
import {
  useLogoutMutation,
  useSessionQuery,
  useUpdateAvatarPresetMutation,
  useUpdateDisplayNameMutation,
} from "../auth/api";
import { useThemePreference, type ThemePreference } from "../../components/theme-provider";

/** 当前账户资料和偏好设置；各面板保留自己的草稿与错误状态。 */
export function MePage() {
  const session = useSessionQuery();
  const logout = useLogoutMutation();
  const avatar = useUpdateAvatarPresetMutation();
  const displayNameMutation = useUpdateDisplayNameMutation();
  const navigate = useNavigate();
  const { preference, setPreference } = useThemePreference();
  const currentAvatar = AVATAR_PRESETS.find((preset) => preset === session.data?.avatarPreset) ?? DEFAULT_AVATAR_PRESET;
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarPreset>(currentAvatar);
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);

  function openAvatarPicker() {
    avatar.reset();
    setSelectedAvatar(currentAvatar);
    setAvatarOpen(true);
  }

  async function saveAvatar() {
    try {
      await avatar.mutateAsync(selectedAvatar);
      setAvatarOpen(false);
    } catch {
      // mutation.error 由 Overlay 内的 ErrorNotice 就地展示，保留当前选择。
    }
  }

  function openNicknameEditor() {
    displayNameMutation.reset();
    setNicknameError(null);
    setNickname(session.data?.displayName ?? "");
    setNicknameOpen(true);
  }

  async function saveNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = nickname.trim();
    const characterCount = Array.from(normalized).length;
    if (!(characterCount >= 1 && characterCount <= 80)) {
      setNicknameError("昵称无效，请输入 1 到 80 个字符。");
      return;
    }
    setNicknameError(null);
    try {
      await displayNameMutation.mutateAsync(normalized);
      setNicknameOpen(false);
    } catch {
      // mutation.error 由 Sheet 内的 ErrorNotice 就地展示，保留输入供用户重试。
    }
  }

  async function signOut() {
    try {
      await logout.mutateAsync();
      navigate("/login", { replace: true });
    } catch {
      // mutation.error 由页面内就地展示，避免 PWA 网络失败时出现未处理 Promise。
    }
  }

  const themeLabels: Record<ThemePreference, string> = {
    SYSTEM: "跟随系统",
    LIGHT: "亮色",
    DARK: "暗色",
  };
  const themeOptions: Array<[ThemePreference, string, ReactNode]> = [
    ["SYSTEM", "跟随系统", <Monitor aria-hidden="true" size={18} key="system" />],
    ["LIGHT", "亮色", <Sun aria-hidden="true" size={18} key="light" />],
    ["DARK", "暗色", <Moon aria-hidden="true" size={18} key="dark" />],
  ];

  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="home-header"><h1>我的</h1></header>
        <section className="profile-panel">
          <button className="profile-avatar-button" type="button" aria-label="选择头像" onClick={openAvatarPicker}>
            <MemberAvatar memberId={session.data?.userId ?? "current-user"} displayName={session.data?.displayName ?? "当前用户"} avatarPreset={currentAvatar} size="lg" decorative />
          </button>
          <button className="profile-identity-button" type="button" aria-label="修改昵称" onClick={openNicknameEditor}>
            <strong>{session.data?.displayName}</strong><small>{session.data?.username}</small><Pencil aria-hidden="true" size={16} />
          </button>
        </section>
        <section className="account-settings" aria-labelledby="account-security-heading">
          <h2 id="account-security-heading">账户与安全</h2>
          <div className="settings-list">
            <Link className="settings-link" to="/me/username" aria-label="修改用户名">
              <UserRound aria-hidden="true" size={18} />
              <span><strong>修改用户名</strong><small>更新登录使用的用户名</small></span>
              <ChevronRight aria-hidden="true" size={18} />
            </Link>
            <Link className="settings-link" to="/me/password" aria-label="修改密码">
              <KeyRound aria-hidden="true" size={18} />
              <span><strong>修改密码</strong><small>更新当前登录凭证</small></span>
              <ChevronRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </section>
        <section className="account-settings" aria-labelledby="preferences-heading">
          <h2 id="preferences-heading">偏好设置</h2>
          <div className="settings-list">
            <button className="settings-link" type="button" aria-label={`主题：${themeLabels[preference]}`} onClick={() => setThemeOpen(true)}>
              <SunMoon aria-hidden="true" size={18} />
              <span><strong>主题</strong><small>调整应用显示模式</small></span>
              <span className="settings-link__value">{themeLabels[preference]}</span>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
        </section>
        {session.data?.isSystemAdmin ? <section className="account-settings" aria-labelledby="system-management-heading">
          <h2 id="system-management-heading">管理</h2>
          <div className="settings-list">
            <Link className="settings-link" to="/admin" aria-label="系统管理">
              <ShieldCheck aria-hidden="true" size={18} />
              <span><strong>系统管理</strong><small>用户与注册策略</small></span>
              <ChevronRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </section> : null}
        <section className="account-settings account-actions" aria-labelledby="account-actions-heading">
          <h2 id="account-actions-heading">账户操作</h2>
          <div className="settings-list">
            <button className="settings-link settings-link--danger" type="button" aria-label="退出登录" aria-busy={logout.isPending} disabled={logout.isPending} onClick={() => void signOut()}>
              {logout.isPending ? <LoaderCircle aria-hidden="true" className="spinner" size={18} /> : <LogOut aria-hidden="true" size={18} />}
              <span><strong>{logout.isPending ? "正在退出登录" : "退出登录"}</strong><small>结束当前设备上的登录状态</small></span>
            </button>
          </div>
          {logout.error ? <ErrorNotice error={logout.error} /> : null}
        </section>
      </main>
      <ProductBottomNavigation />
      <Overlay open={avatarOpen} title="选择头像" onClose={() => setAvatarOpen(false)} focusKey={String(selectedAvatar)}>
        <div className="avatar-picker">
          <div className="avatar-picker__grid" role="group" aria-label="默认头像">
            {AVATAR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="avatar-picker__option"
                aria-label={`头像 ${preset}`}
                aria-pressed={selectedAvatar === preset}
                data-overlay-initial-focus={selectedAvatar === preset ? "" : undefined}
                onClick={() => setSelectedAvatar(preset)}
              >
                <MemberAvatar memberId={`avatar-${preset}`} displayName={`头像 ${preset}`} avatarPreset={preset} size="lg" decorative />
                <Check aria-hidden="true" size={18} />
              </button>
            ))}
          </div>
          {avatar.error ? <ErrorNotice error={avatar.error} /> : null}
          <Button className="avatar-picker__save" busy={avatar.isPending} onClick={() => void saveAvatar()}>保存头像</Button>
        </div>
      </Overlay>
      <Overlay open={nicknameOpen} title="修改昵称" onClose={() => setNicknameOpen(false)} focusKey={nicknameOpen ? "nickname" : "closed"}>
        <form className="form-stack nickname-form" onSubmit={(event) => void saveNickname(event)}>
          <Field label="昵称" error={nicknameError ?? undefined}>
            <Input data-overlay-initial-focus value={nickname} autoComplete="name" aria-invalid={nicknameError ? "true" : undefined} required onChange={(event) => { setNickname(event.target.value); setNicknameError(null); }} />
          </Field>
          {displayNameMutation.error ? <ErrorNotice error={displayNameMutation.error} /> : null}
          <Button type="submit" busy={displayNameMutation.isPending}>保存昵称</Button>
        </form>
      </Overlay>
      <Overlay open={themeOpen} title="主题" onClose={() => setThemeOpen(false)} focusKey={themeOpen ? preference : "closed"}>
        <div className="theme-picker" role="radiogroup" aria-label="显示模式">
          {themeOptions.map(([value, label, icon]) => (
            <button key={value} type="button" role="radio" aria-checked={preference === value} data-overlay-initial-focus={preference === value ? "" : undefined} onClick={() => setPreference(value)}>
              {icon}<span>{label}</span>{preference === value ? <Check aria-hidden="true" size={18} /> : null}
            </button>
          ))}
        </div>
      </Overlay>
    </div>
  );
}
