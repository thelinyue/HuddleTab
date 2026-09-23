import { ArrowRight, Eye, EyeOff, LockKeyhole, LogIn, UserPlus, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, ErrorNotice, Field, Input, LoadingState } from "../../components/ui";
import { errorMessage } from "../../api/error";
import { queryKeys } from "../../api/query-keys";
import { joinInvitation, useInvitationPreviewQuery, useJoinInvitationMutation, useJoinRequestQuery, useLoginMutation, useRegisterMutation, useRegistrationPolicyQuery, useSessionQuery } from "./api";

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
function AuthSwitch({ prompt, label, href, from }: { prompt: string; label: string; href: string; from?: string }) {
  return (
    <div className="auth-switch">
      <span aria-hidden="true" />
      <div><span>{prompt}</span><Link to={href} state={from ? { from } : undefined}>{label}<ArrowRight aria-hidden="true" size={16} /></Link></div>
      <span aria-hidden="true" />
    </div>
  );
}

export function LoginPage() {
  const session = useSessionQuery();
  const policy = useRegistrationPolicyQuery();
  const mutation = useLoginMutation();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const requestedFrom = (location.state as { from?: string } | null)?.from;
  const from = requestedFrom?.startsWith("/") && !requestedFrom.startsWith("//") ? requestedFrom : "/activities";
  const inviteToken = from.match(/^\/join\/([^/?#]+)/)?.[1];

  if (session.data) return <Navigate to={from} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutation.mutateAsync({ username, password });
    navigate(from, { replace: true });
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
      {!policy.isFetching && !policy.error && policy.data === "OPEN" ? <AuthSwitch prompt="还没有账号？" label="注册新账号" href={inviteToken ? `/register?invite=${inviteToken}` : "/register"} /> : null}
    </AuthLayout>
  );
}

export function RegisterPage() {
  const session = useSessionQuery();
  const policy = useRegistrationPolicyQuery();
  const mutation = useRegisterMutation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const invitationToken = searchParams.get("invite") ?? "";
  const preview = useInvitationPreviewQuery(invitationToken);
  const [entryToken, setEntryToken] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string>();
  const [completing, setCompleting] = useState(false);

  if (session.data && !completing) return <Navigate to={invitationToken ? `/join/${encodeURIComponent(invitationToken)}` : "/activities"} replace />;
  if (invitationToken && preview.isPending) return <LoadingState label="正在读取邀请…" />;
  if (!invitationToken && policy.isPending) return <LoadingState label="正在读取注册策略…" />;
  if (!invitationToken && policy.error) return <main className="center-page"><ErrorNotice error={policy.error} /><Button onClick={() => void policy.refetch()}>重试</Button></main>;

  if (!invitationToken && policy.data === "INVITE_ONLY") return (
    <AuthLayout>
      <header className="auth-panel__header"><h1>凭邀请注册</h1><p>输入活动邀请口令后继续。</p></header>
      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); if (entryToken.trim()) navigate(`/join/${encodeURIComponent(entryToken.trim())}`); }}>
        <Field label="邀请口令"><Input value={entryToken} onChange={(event) => setEntryToken(event.target.value)} required autoFocus /></Field>
        <Button className="auth-submit" type="submit">查看邀请 <ArrowRight aria-hidden="true" size={18} /></Button>
      </form>
      <AuthSwitch prompt="已有账号？" label="登录" href="/login" />
    </AuthLayout>
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(undefined);
    if (password !== confirmPassword) {
      setLocalError("两次输入的密码不一致。");
      return;
    }
    setCompleting(true);
    try {
      const registered = await mutation.mutateAsync({ username, displayName, password, invitationToken: invitationToken || undefined });
      if (!invitationToken) {
        navigate("/activities", { replace: true });
      } else if (preview.data?.purpose === "GUEST_BINDING") {
        navigate(`/join/${encodeURIComponent(invitationToken)}`, { replace: true });
      } else {
        try {
          const joined = await joinInvitation(invitationToken);
          if (joined.status === "PENDING_APPROVAL" && joined.requestId) {
            navigate(`/join/${encodeURIComponent(invitationToken)}?request=${encodeURIComponent(joined.requestId)}`, { replace: true });
          } else {
            await queryClient.invalidateQueries({ queryKey: queryKeys.activitiesCurrent(registered.userId) });
            navigate(`/activities/${joined.activityId}`, { replace: true });
          }
        } catch (error) {
          navigate(`/join/${encodeURIComponent(invitationToken)}`, { replace: true, state: { joinError: errorMessage(error) } });
        }
      }
    } catch {
      setCompleting(false);
    }
  }

  if (invitationToken && preview.error) return <main className="center-page"><ErrorNotice error={preview.error} /><Link className="button button--secondary" to="/login">返回登录</Link></main>;

  return (
    <AuthLayout>
      <header className="auth-panel__header">
        <h1>{invitationToken ? preview.data?.purpose === "GUEST_BINDING" ? "注册并绑定" : "注册并加入" : "创建账号"}</h1>
        <p>{invitationToken ? preview.data?.activityName : "创建账号后即可开始管理活动和账目。"}</p>
      </header>
      <form className="auth-form" onSubmit={submit}>
        <AuthField id="register-nickname" label="昵称" value={displayName} onChange={setDisplayName} autoComplete="name" maxLength={80} autoFocus />
        <AuthField id="register-username" label="用户名" value={username} onChange={setUsername} autoComplete="username" minLength={3} maxLength={32} icon={<UserRound aria-hidden="true" size={20} />} />
        <AuthField id="register-password" label="密码" value={password} onChange={setPassword} autoComplete="new-password" type="password" />
        <AuthField id="register-confirm-password" label="确认密码" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" type="password" />
        {preview.data?.purpose === "GUEST_BINDING" ? <p>请使用邀请者指定的用户名注册。注册后还需确认绑定。</p> : null}
        {localError ? <div className="field__error" role="alert">{localError}</div> : null}
        {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
        <Button className="auth-submit" type="submit" busy={completing} disabled={completing}>
          <UserPlus aria-hidden="true" size={18} /> 注册
        </Button>
      </form>
      <AuthSwitch prompt="已有账号？" label="登录" href="/login" from={invitationToken ? `/join/${encodeURIComponent(invitationToken)}` : undefined} />
    </AuthLayout>
  );
}

export function JoinPage() {
  const { token = "" } = useParams();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const session = useSessionQuery();
  const preview = useInvitationPreviewQuery(token);
  const mutation = useJoinInvitationMutation(session.data?.userId ?? "", token);
  const [requestId, setRequestId] = useState(searchParams.get("request") ?? "");
  const joinRequest = useJoinRequestQuery(session.data?.userId ?? "", requestId);
  const navigate = useNavigate();
  const joinError = (location.state as { joinError?: string } | null)?.joinError;

  if (preview.isPending || session.isPending) return <LoadingState label="正在读取邀请…" />;
  const expiresAt = new Date(preview.data?.expiresAt ?? "");
  const expiryLabel = Number.isNaN(expiresAt.getTime())
    ? "有效期暂无法显示"
    : `邀请有效期至 ${expiresAt.toLocaleDateString("zh-CN")}`;
  const requestStatus = requestId ? (
    <div className="join-request-status" role="status" aria-live="polite">
      {joinRequest.isPending ? <LoadingState label="正在读取审批结果…" /> : null}
      {joinRequest.error ? <ErrorNotice error={joinRequest.error} /> : null}
      {!joinRequest.isPending && !joinRequest.error && joinRequest.data?.status === "APPROVED" ? (
        <><strong>申请已批准</strong><Link className="button button--primary" to={`/activities/${joinRequest.data.activityId}`}>打开活动 <ArrowRight aria-hidden="true" size={18} /></Link></>
      ) : null}
      {!joinRequest.isPending && !joinRequest.error && joinRequest.data?.status === "REJECTED" ? (
        <><strong>申请未通过</strong><p>活动所有者没有批准本次加入申请。</p></>
      ) : null}
      {!joinRequest.isPending && !joinRequest.error && joinRequest.data?.status === "INVALIDATED" ? (
        <><strong>邀请已作废</strong><p>请联系活动所有者获取新的邀请链接。</p></>
      ) : null}
      {!joinRequest.isPending && !joinRequest.error && (!joinRequest.data || joinRequest.data.status === "PENDING") ? (
        <><strong>等待活动所有者审批</strong><p>审批结果会显示在通知中。</p></>
      ) : null}
    </div>
  ) : null;

  return (
    <main className="center-page join-page">
      <section className="join-panel">
        {/* 应用图标用于品牌识别，邀请插画独立展示，避免将场景插画误作标志。 */}
        <Link className="join-panel__brand" to="/activities" aria-label="伙记 HuddleTab 首页">
          <img className="join-panel__brand-icon" src="/icons/icon-192.png" alt="" aria-hidden="true" width="48" height="48" />
          <span className="join-panel__brand-copy"><strong>伙记</strong><small>HuddleTab</small></span>
        </Link>
        <img className="join-panel__illustration" src="/illustrations/invitation.webp" alt="" aria-hidden="true" decoding="async" />
        {joinError ? <div className="field__error" role="alert">账号已创建，但未能加入活动：{joinError}</div> : null}
        {preview.error ? <><ErrorNotice error={preview.error} />{requestStatus}<Link className="button button--secondary" to="/activities">返回活动列表</Link></> : preview.data ? (
          <>
            <p className="eyebrow">{preview.data.purpose === "GUEST_BINDING" ? "绑定临时成员身份" : "活动邀请"}</p>
            <h1>{preview.data.activityName}</h1>
            {preview.data.purpose === "GUEST_BINDING" && preview.data.guestDisplayName ? <strong className="join-panel__guest">{preview.data.guestDisplayName}</strong> : null}
            <div className="join-panel__details"><p>已有 {preview.data.activeMemberCount} 位成员</p><p>{expiryLabel}</p></div>
            {session.data ? (
              <>
                {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
                {requestId ? requestStatus : (
                  <Button
                    busy={mutation.isPending}
                    onClick={() => void mutation.mutateAsync().then((joined) => {
                      if (joined.status === "PENDING_APPROVAL" && joined.requestId) {
                        setRequestId(joined.requestId);
                        setSearchParams({ request: joined.requestId }, { replace: true });
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
              <div className="join-panel__actions">
                <Link className="button button--primary" to={`/register?invite=${encodeURIComponent(token)}`}>{preview.data.purpose === "GUEST_BINDING" ? "注册后确认绑定" : "注册并加入"}</Link>
                <p>已有账号？<Link to="/login" state={{ from: `/join/${encodeURIComponent(token)}` }}>登录</Link></p>
              </div>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}
