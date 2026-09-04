import { ArrowRight, Eye, EyeOff, LockKeyhole, LogIn, UserPlus, UserRound, UserRoundCheck, UsersRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Brand } from "../../components/brand";
import { Button, ErrorNotice, Field, Input, LoadingState } from "../../components/ui";
import { useInvitationPreviewQuery, useJoinInvitationMutation, useJoinRequestQuery, useLoginMutation, useRegisterMutation, useSessionQuery } from "./api";

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="account-page">
      <div className="account-card">
        <section className="account-card__hero" aria-label="朋友共同旅行与记账">
          <img src="/auth/auth-hero.webp" alt="朋友们一起旅行" width={950} height={625} />
        </section>
        <section className="account-card__body">
          <div className="account-brand">
            <img src="/icons/icon-192.png" alt="" width={64} height={64} />
            <span><strong>伙记</strong><small>HuddleTab</small></span>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-input-wrap">
      <LockKeyhole aria-hidden="true" size={20} />
      <Input
        id={id}
        name={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required
        minLength={8}
        maxLength={128}
      />
      <button className="auth-password-toggle" type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "隐藏密码" : "显示密码"}>
        {visible ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}
      </button>
    </div>
  );
}

function AuthField({ id, label, value, onChange, autoComplete, icon, type = "text", minLength, maxLength, autoFocus }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  icon?: React.ReactNode;
  type?: "text" | "password";
  minLength?: number;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  return (
    <label className="auth-field" htmlFor={id}>
      <span>{label}</span>
      {type === "password" ? <PasswordInput id={id} value={value} onChange={onChange} autoComplete={autoComplete} /> : (
        <div className="auth-input-wrap">
          {icon}
          <Input id={id} name={id} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} required minLength={minLength} maxLength={maxLength} autoFocus={autoFocus} />
        </div>
      )}
    </label>
  );
}

/** 认证页底部的分隔式切换入口，保持 v0.0.2 的视觉层级，同时保留键盘可访问链接。 */
function AuthSwitch({ prompt, label, href }: { prompt: string; label: string; href: string }) {
  return (
    <div className="auth-switch">
      <span aria-hidden="true" />
      <div><span>{prompt}</span><Link to={href}>{label}<ArrowRight aria-hidden="true" size={16} /></Link></div>
      <span aria-hidden="true" />
    </div>
  );
}

export function LoginPage() {
  const session = useSessionQuery();
  const mutation = useLoginMutation();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (session.data) return <Navigate to="/activities" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutation.mutateAsync({ username, password });
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from?.startsWith("/") ? from : "/activities", { replace: true });
  }

  return (
    <AuthLayout>
      <header className="auth-panel__header">
        <h1 aria-label="登录伙记">登录</h1>
        <p>继续管理你的活动和账目</p>
      </header>
      <form className="auth-form" onSubmit={submit}>
        <AuthField id="login-username" label="用户名" value={username} onChange={setUsername} autoComplete="username" minLength={3} maxLength={32} autoFocus icon={<UserRound aria-hidden="true" size={20} />} />
        <AuthField id="login-password" label="密码" value={password} onChange={setPassword} autoComplete="current-password" type="password" />
        {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
        <Button className="auth-submit" type="submit" busy={mutation.isPending}>
          <LogIn aria-hidden="true" size={18} /> 登录
        </Button>
      </form>
      <AuthSwitch prompt="还没有账号？" label="注册新账号" href="/register" />
    </AuthLayout>
  );
}

export function RegisterPage() {
  const session = useSessionQuery();
  const mutation = useRegisterMutation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [invitationToken, setInvitationToken] = useState(searchParams.get("invite") ?? "");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string>();

  if (session.data) return <Navigate to={invitationToken ? `/join/${invitationToken}` : "/activities"} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(undefined);
    if (password !== confirmPassword) {
      setLocalError("两次输入的密码不一致。");
      return;
    }
    await mutation.mutateAsync({ username, displayName, password, invitationToken: invitationToken || undefined });
    navigate(invitationToken ? `/join/${invitationToken}` : "/activities", { replace: true });
  }

  return (
    <AuthLayout>
      <header className="auth-panel__header">
        <h1>创建账号</h1>
        <p>创建账号后即可开始管理活动和账目。</p>
      </header>
      <form className="auth-form" onSubmit={submit}>
        <AuthField id="register-nickname" label="昵称" value={displayName} onChange={setDisplayName} autoComplete="name" maxLength={80} autoFocus />
        <AuthField id="register-username" label="用户名" value={username} onChange={setUsername} autoComplete="username" minLength={3} maxLength={32} icon={<UserRound aria-hidden="true" size={20} />} />
        <AuthField id="register-password" label="密码" value={password} onChange={setPassword} autoComplete="new-password" type="password" />
        <AuthField id="register-confirm-password" label="确认密码" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" type="password" />
        <Field label="邀请口令" hint="开放注册可留空；有邀请时可粘贴口令。"><Input value={invitationToken} onChange={(event) => setInvitationToken(event.target.value.trim())} /></Field>
        {localError ? <div className="field__error" role="alert">{localError}</div> : null}
        {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
        <Button className="auth-submit" type="submit" busy={mutation.isPending}>
          <UserPlus aria-hidden="true" size={18} /> 注册
        </Button>
      </form>
      <AuthSwitch prompt="已有账号？" label="登录" href="/login" />
    </AuthLayout>
  );
}

export function JoinPage() {
  const { token = "" } = useParams();
  const session = useSessionQuery();
  const preview = useInvitationPreviewQuery(token);
  const mutation = useJoinInvitationMutation(session.data?.userId ?? "", token);
  const [requestId, setRequestId] = useState("");
  const joinRequest = useJoinRequestQuery(session.data?.userId ?? "", requestId);
  const navigate = useNavigate();

  if (preview.isPending || session.isPending) return <LoadingState label="正在读取邀请…" />;

  return (
    <main className="center-page">
      <section className="join-panel">
        <Brand />
        {preview.error ? <ErrorNotice error={preview.error} /> : preview.data ? (
          <>
            <span className="join-panel__icon">{preview.data.purpose === "GUEST_BINDING" ? <UserRoundCheck aria-hidden="true" size={30} /> : <UsersRound aria-hidden="true" size={30} />}</span>
            <p className="eyebrow">{preview.data.purpose === "GUEST_BINDING" ? "绑定临时成员身份" : "活动邀请"}</p>
            <h1>{preview.data.activityName}</h1>
            {preview.data.purpose === "GUEST_BINDING" && preview.data.guestDisplayName ? <strong className="join-panel__guest">{preview.data.guestDisplayName}</strong> : null}
            <p>已有 {preview.data.activeMemberCount} 位成员，邀请有效期至 {new Date(preview.data.expiresAt).toLocaleDateString("zh-CN")}。</p>
            {session.data ? (
              <>
                {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
                {requestId ? (
                  <div className="join-request-status" role="status" aria-live="polite">
                    {joinRequest.isPending ? <LoadingState label="正在读取审批结果…" /> : null}
                    {joinRequest.error ? <ErrorNotice error={joinRequest.error} /> : null}
                    {!joinRequest.isPending && !joinRequest.error && joinRequest.data?.status === "APPROVED" ? (
                      <><strong>申请已批准</strong><Link className="button button--primary" to={`/activities/${joinRequest.data.activityId}`}>打开活动 <ArrowRight aria-hidden="true" size={18} /></Link></>
                    ) : null}
                    {!joinRequest.isPending && !joinRequest.error && joinRequest.data?.status === "REJECTED" ? (
                      <><strong>申请未通过</strong><p>活动所有者没有批准本次加入申请。</p></>
                    ) : null}
                    {!joinRequest.isPending && !joinRequest.error && (!joinRequest.data || joinRequest.data.status === "PENDING") ? (
                      <><strong>等待活动所有者审批</strong><p>审批结果会显示在通知中。</p></>
                    ) : null}
                  </div>
                ) : (
                  <Button
                    busy={mutation.isPending}
                    onClick={() => void mutation.mutateAsync().then((joined) => {
                      if (joined.status === "PENDING_APPROVAL" && joined.requestId) {
                        setRequestId(joined.requestId);
                      } else {
                        navigate(`/activities/${joined.activityId}`);
                      }
                    }).catch(() => undefined)}
                  >
                    {preview.data.purpose === "GUEST_BINDING" ? "确认绑定" : "加入活动"} <ArrowRight aria-hidden="true" size={18} />
                  </Button>
                )}
              </>
            ) : (
              <div className="button-row">
                <Link className="button button--primary" to={`/register?invite=${encodeURIComponent(token)}`}>{preview.data.purpose === "GUEST_BINDING" ? "注册并绑定" : "注册并加入"}</Link>
                <Link className="button button--secondary" to="/login" state={{ from: `/join/${token}` }}>登录</Link>
              </div>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
