import { ArrowRight, Eye, EyeOff, LogIn, UserPlus, UserRoundCheck, UsersRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Brand } from "../../components/brand";
import { Button, ErrorNotice, Field, Input, LoadingState } from "../../components/ui";
import { useInvitationPreviewQuery, useJoinInvitationMutation, useJoinRequestQuery, useLoginMutation, useRegisterMutation, useSessionQuery } from "./api";

function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-layout__visual" aria-label="朋友共同旅行与记账">
        <img src="/auth/auth-hero.webp" alt="朋友们一起旅行" width={1024} height={1024} />
        <div className="auth-layout__caption">
          <strong>一起花，清楚分。</strong>
          <span>旅行、聚餐和合租账目，在一个地方算清。</span>
        </div>
      </section>
      <section className="auth-layout__form">
        <div className="auth-panel">
          <Brand />
          {children}
        </div>
      </section>
    </main>
  );
}

function PasswordInput({ value, onChange, autoComplete }: { value: string; onChange: (value: string) => void; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-input">
      <Input
        aria-label="密码"
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required
        minLength={8}
        maxLength={128}
      />
      <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "隐藏密码" : "显示密码"}>
        {visible ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}
      </button>
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
        <p className="eyebrow">欢迎回来</p>
        <h1>登录伙记</h1>
        <p>继续查看活动账目和成员余额。</p>
      </header>
      <form className="form-stack" onSubmit={submit}>
        <Field label="用户名">
          <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required minLength={3} maxLength={32} autoFocus />
        </Field>
        <Field label="密码">
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
        <Button type="submit" busy={mutation.isPending}>
          <LogIn aria-hidden="true" size={18} /> 登录
        </Button>
      </form>
      <p className="auth-panel__switch">收到邀请但还没有账号？ <Link to="/register">注册</Link></p>
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

  if (session.data) return <Navigate to={invitationToken ? `/join/${invitationToken}` : "/activities"} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutation.mutateAsync({ username, displayName, password, invitationToken });
    navigate(`/join/${invitationToken}`, { replace: true });
  }

  return (
    <AuthLayout>
      <header className="auth-panel__header">
        <p className="eyebrow">凭邀请加入</p>
        <h1>创建账号</h1>
        <p>注册后仍会再次确认邀请，避免加入错误活动。</p>
      </header>
      <form className="form-stack" onSubmit={submit}>
        <Field label="邀请口令" hint="从邀请链接自动带入，也可以粘贴完整口令。">
          <Input value={invitationToken} onChange={(event) => setInvitationToken(event.target.value.trim())} required autoFocus />
        </Field>
        <Field label="用户名" hint="3–32 位，仅限字母、数字、点、下划线和连字符。">
          <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required minLength={3} maxLength={32} />
        </Field>
        <Field label="显示名称">
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required maxLength={80} />
        </Field>
        <Field label="密码" hint="8–128 个字符，可以使用密码管理器生成和粘贴。">
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
        <Button type="submit" busy={mutation.isPending}>
          <UserPlus aria-hidden="true" size={18} /> 注册并继续
        </Button>
      </form>
      <p className="auth-panel__switch">已有账号？ <Link to="/login">登录</Link></p>
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
