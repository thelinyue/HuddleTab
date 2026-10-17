import { ArrowRight, Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, ErrorNotice, Input, LoadingState } from "../../components/ui";
import { ApiRequestError } from "../../api/error";
import { useInvitationJoinOptionsQuery, useInvitationPreviewQuery, useJoinInvitationMutation, useJoinRequestQuery, useLoginMutation, useRegisterMutation, useRegistrationPolicyQuery, useSessionQuery } from "./api";

/** 三个入口共用轻量外壳；加载、错误和审批状态也保留品牌及同一内容宽度，手机端按文档自然滚动。 */
function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="account-page">
      <section className="account-card">
        <Link className="account-brand" to="/activities" aria-label="伙记首页">
          <img src="/icons/icon-192.png" alt="" width={40} height={40} />
          <strong>伙记</strong>
        </Link>
        {children}
      </section>
    </main>
  );
}

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-input-wrap">
      <Input
        id={id}
        name={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        required
        minLength={8}
        maxLength={128}
      />
      <button className="auth-password-toggle" type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible}>
        {visible ? <EyeOff aria-hidden="true" size={19} /> : <Eye aria-hidden="true" size={19} />}
      </button>
    </div>
  );
}

function AuthField({ id, label, value, onChange, autoComplete, type = "text", minLength, maxLength }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  type?: "text" | "password";
  minLength?: number;
  maxLength?: number;
}) {
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      {type === "password" ? <PasswordInput id={id} value={value} onChange={onChange} autoComplete={autoComplete} /> : (
        <Input id={id} name={id} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} autoCapitalize={autoComplete === "username" || autoComplete === "off" ? "none" : undefined} spellCheck={autoComplete === "username" || autoComplete === "off" ? false : undefined} required minLength={minLength} maxLength={maxLength} />
      )}
    </div>
  );
}

/** 次要入口保持轻量，同时携带原邀请地址，避免登录与注册切换时丢失上下文。 */
function AuthSwitch({ prompt, label, href, from }: { prompt: string; label: string; href: string; from?: string }) {
  return (
    <p className="auth-switch"><span>{prompt}</span><Link to={href} state={from ? { from } : undefined}>{label}</Link></p>
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
      </header>
      <form className="auth-form" onSubmit={submit}>
        <AuthField id="login-username" label="用户名" value={username} onChange={setUsername} autoComplete="username" minLength={3} maxLength={32} />
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
  if (invitationToken && preview.isPending) return <AuthLayout><LoadingState label="正在读取邀请…" /></AuthLayout>;
  if (!invitationToken && policy.isPending) return <AuthLayout><LoadingState label="正在读取注册策略…" /></AuthLayout>;
  if (!invitationToken && policy.error) return <AuthLayout><ErrorNotice error={policy.error} /><Button onClick={() => void policy.refetch()}>重试</Button></AuthLayout>;

  if (!invitationToken && policy.data === "INVITE_ONLY") return (
    <AuthLayout>
      <header className="auth-panel__header"><h1>凭邀请注册</h1><p>输入活动邀请口令后继续。</p></header>
      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); if (entryToken.trim()) navigate(`/join/${encodeURIComponent(entryToken.trim())}`); }}>
        <AuthField id="register-invitation" label="邀请口令" value={entryToken} onChange={setEntryToken} autoComplete="off" />
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
      await mutation.mutateAsync({ username, displayName, password, invitationToken: invitationToken || undefined });
      // 注册只创建账号，回到同一邀请后由用户明确选择账务身份，避免提前生成重复成员。
      navigate(invitationToken ? `/join/${encodeURIComponent(invitationToken)}` : "/activities", { replace: true });
    } catch {
      setCompleting(false);
    }
  }

  if (invitationToken && preview.error) return <AuthLayout><ErrorNotice error={preview.error} /><Link className="button button--secondary" to="/login">返回登录</Link></AuthLayout>;

  return (
    <AuthLayout>
      <header className="auth-panel__header">
        <h1>{invitationToken ? "注册账号" : "创建账号"}</h1>
        {invitationToken ? <p>{preview.data?.activityName}</p> : null}
      </header>
      <form className="auth-form" onSubmit={submit}>
        <AuthField id="register-nickname" label="昵称" value={displayName} onChange={setDisplayName} autoComplete="name" maxLength={80} />
        <AuthField id="register-username" label="用户名" value={username} onChange={setUsername} autoComplete="username" minLength={3} maxLength={32} />
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

/** 邀请页把账号认证与账务身份选择分开；选项失效时要求重新确认，绝不隐式新建成员。 */
export function JoinPage() {
  const { token = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const session = useSessionQuery();
  const preview = useInvitationPreviewQuery(token);
  const mutation = useJoinInvitationMutation(session.data?.userId ?? "", token);
  const requestId = searchParams.get("request") ?? "";
  const joinRequest = useJoinRequestQuery(session.data?.userId ?? "", requestId);
  const needsJoinOptions = Boolean(session.data && preview.data?.purpose === "JOIN" && !requestId);
  const joinOptions = useInvitationJoinOptionsQuery(session.data?.userId ?? "", token, needsJoinOptions);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>("");
  const navigate = useNavigate();
  const claimableMembers = joinOptions.data?.claimableMembers ?? [];
  const claimRequest = Boolean(joinRequest.data?.guestMemberId);
  const requireApproval = joinOptions.data?.inviteMode === "REQUIRE_APPROVAL";

  useEffect(() => { setSelectedGuestId(""); }, [token, session.data?.userId]);
  useEffect(() => {
    if (selectedGuestId && joinOptions.data && !joinOptions.data.claimableMembers.some((member) => member.memberId === selectedGuestId)) {
      setSelectedGuestId(null);
    }
  }, [selectedGuestId, joinOptions.data]);

  async function submitJoin() {
    try {
      const joined = await mutation.mutateAsync(preview.data?.purpose === "JOIN" ? selectedGuestId || undefined : undefined);
      if (joined.status === "PENDING_APPROVAL" && joined.requestId) {
        setSearchParams({ request: joined.requestId }, { replace: true });
      } else {
        navigate(`/activities/${joined.activityId}`);
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "GUEST_CLAIM_UNAVAILABLE") {
        setSelectedGuestId(null);
        void joinOptions.refetch();
      }
    }
  }

  function chooseAgain() {
    setSelectedGuestId(null);
    mutation.reset();
    setSearchParams({}, { replace: true });
  }

  if (preview.isPending || session.isPending) return <AuthLayout><LoadingState label="正在读取邀请…" /></AuthLayout>;
  const expiresAt = new Date(preview.data?.expiresAt ?? "");
  const expiryLabel = Number.isNaN(expiresAt.getTime())
    ? "有效期暂无法显示"
    : `邀请有效期至 ${expiresAt.toLocaleDateString("zh-CN")}`;
  const requestStatus = requestId ? (
    <div className="join-request-status" role="status" aria-live="polite">
      {claimRequest ? <p>申请认领「{joinRequest.data?.guestDisplayName ?? "临时成员"}」</p> : null}
      {joinRequest.isPending ? <LoadingState label="正在读取审批结果…" /> : null}
      {joinRequest.error ? <ErrorNotice error={joinRequest.error} /> : null}
      {!joinRequest.isPending && !joinRequest.error && joinRequest.data?.status === "APPROVED" ? (
        <><strong>{claimRequest ? "认领申请已批准" : "申请已批准"}</strong><Link className="button button--primary" to={`/activities/${joinRequest.data.activityId}`}>打开活动 <ArrowRight aria-hidden="true" size={18} /></Link></>
      ) : null}
      {!joinRequest.isPending && !joinRequest.error && joinRequest.data?.status === "REJECTED" ? (
        <><strong>申请未通过</strong><p>活动所有者没有批准本次加入申请。</p>{claimRequest ? <Button variant="secondary" onClick={chooseAgain}>重新选择身份</Button> : null}</>
      ) : null}
      {!joinRequest.isPending && !joinRequest.error && joinRequest.data?.status === "INVALIDATED" ? (
        <><strong>{claimRequest ? "认领申请已失效" : "邀请已作废"}</strong><p>{claimRequest ? "请重新查看邀请或联系活动所有者。" : "请联系活动所有者获取新的邀请链接。"}</p>{claimRequest && !preview.error ? <Button variant="secondary" onClick={chooseAgain}>重新选择身份</Button> : null}</>
      ) : null}
      {!joinRequest.isPending && !joinRequest.error && (!joinRequest.data || joinRequest.data.status === "PENDING") ? (
        <><strong>等待活动所有者审批</strong><p>审批结果会显示在通知中。</p></>
      ) : null}
    </div>
  ) : null;

  return (
    <AuthLayout>
      <div className="join-panel">
        {preview.error ? <><ErrorNotice error={preview.error} />{requestStatus}<Link className="button button--secondary" to="/activities">返回活动列表</Link></> : preview.data ? (
          <>
            <header className="auth-panel__header">
              <p className="eyebrow">{preview.data.purpose === "GUEST_BINDING" ? "绑定临时成员身份" : "活动邀请"}</p>
              <h1>{preview.data.activityName}</h1>
            </header>
            {preview.data.purpose === "GUEST_BINDING" && preview.data.guestDisplayName ? <strong className="join-panel__guest">{preview.data.guestDisplayName}</strong> : null}
            <div className="join-panel__details"><p>已有 {preview.data.activeMemberCount} 位成员</p><p>{expiryLabel}</p></div>
            {session.data ? (
              <>
                {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
                {requestId ? requestStatus : (<>
                  {needsJoinOptions && joinOptions.isPending ? <LoadingState label="正在读取加入身份…" /> : null}
                  {needsJoinOptions && joinOptions.error ? <><ErrorNotice error={joinOptions.error} /><Button variant="secondary" onClick={() => void joinOptions.refetch()}>重试</Button></> : null}
                  {needsJoinOptions && joinOptions.data && (claimableMembers.length > 0 || selectedGuestId === null) ? (
                    <fieldset className="join-identity" disabled={mutation.isPending}>
                      <legend>选择加入身份</legend>
                      <label className="join-identity__option"><input type="radio" name="join-identity" checked={selectedGuestId === ""} onChange={() => setSelectedGuestId("")} /><span>作为新成员加入</span></label>
                      {claimableMembers.map((member) => <label className="join-identity__option" key={member.memberId}><input type="radio" name="join-identity" checked={selectedGuestId === member.memberId} onChange={() => setSelectedGuestId(member.memberId)} /><span>认领「{member.displayName}」</span></label>)}
                    </fieldset>
                  ) : null}
                  {needsJoinOptions && selectedGuestId ? <p className="join-identity__hint">认领后将承接该成员的历史账目。</p> : null}
                  {needsJoinOptions && selectedGuestId === null ? <p className="field__error" role="alert">请重新选择加入身份。</p> : null}
                  <Button
                    busy={mutation.isPending}
                    disabled={needsJoinOptions && (!joinOptions.data || Boolean(joinOptions.error) || selectedGuestId === null)}
                    onClick={() => void submitJoin()}
                  >
                    {preview.data.purpose === "GUEST_BINDING" ? "确认绑定" : selectedGuestId ? requireApproval ? "申请认领" : "认领并加入" : "加入活动"} <ArrowRight aria-hidden="true" size={18} />
                  </Button>
                </>)}
              </>
            ) : (
              <div className="join-panel__actions">
                <Link className="button button--primary" to={`/register?invite=${encodeURIComponent(token)}`}>{preview.data.purpose === "GUEST_BINDING" ? "注册后确认绑定" : "注册后加入"}</Link>
                <AuthSwitch prompt="已有账号？" label="登录" href="/login" from={`/join/${encodeURIComponent(token)}`} />
              </div>
            )}
          </>
        ) : null}
      </div>
    </AuthLayout>
  );
}
