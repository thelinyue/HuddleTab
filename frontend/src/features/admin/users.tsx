import { ChevronRight, KeyRound, Search, ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { MemberAvatar } from "../../components/member-avatar";
import { Overlay } from "../../components/overlay";
import { Button, ConfirmDialog, ErrorNotice, Input, LoadingState } from "../../components/ui";
import { useOnlineStatus } from "../activities/offline-workspace";
import { useSessionQuery } from "../auth/api";
import { type AdminUser, useAdminUsersQuery, useResetAdminPasswordMutation, useUpdateAdminRoleMutation, useUpdateAdminUserStatusMutation } from "./api";

const filters = [
  { id: "all", label: "全部", matches: (_user: AdminUser) => true },
  { id: "active", label: "正常", matches: (user: AdminUser) => !user.disabled },
  { id: "disabled", label: "已禁用", matches: (user: AdminUser) => user.disabled },
  { id: "admin", label: "管理员", matches: (user: AdminUser) => user.isSystemAdmin },
] as const;

/** 搜索先确定计数范围，再应用分类；选中项只保存 ID，面板始终读取最新账号数据。 */
export function AdminUsersContent() {
  const session = useSessionQuery();
  const online = useOnlineStatus();
  const actorId = session.data?.userId ?? "";
  const users = useAdminUsersQuery(actorId, online);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!online) setSelectedId(null); }, [online]);

  if (!online) return <div className="notice" role="status">当前离线，系统管理需要联网后使用。</div>;
  if (users.isPending) return <LoadingState label="正在读取用户…" />;
  if (!users.data) return <div className="form-stack"><ErrorNotice error={users.error} /><Button variant="secondary" onClick={() => void users.refetch()}>重试</Button></div>;

  const query = search.trim().toLocaleLowerCase();
  const searched = users.data.filter((user) => user.displayName.toLocaleLowerCase().includes(query) || user.username.toLocaleLowerCase().includes(query));
  const visible = searched.filter(filters.find((item) => item.id === filter)!.matches);
  const selected = users.data.find((user) => user.id === selectedId);

  function closePanel() {
    setSelectedId(null);
    // 当前用户可能因状态变更离开筛选结果，原入口消失时将焦点交还给搜索框。
    if (!visible.some((user) => user.id === selectedId)) searchRef.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <div className="admin-users-toolbar">
        <label className="admin-users-search"><Search aria-hidden="true" size={18} /><Input ref={searchRef} type="search" aria-label="搜索昵称或用户名" placeholder="搜索昵称或用户名" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className="admin-users-filters" role="group" aria-label="用户筛选">
          {filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label} <span>{searched.filter(item.matches).length}</span></button>)}
        </div>
      </div>
      {users.error ? <div className="form-stack"><ErrorNotice error={users.error} /><Button variant="secondary" busy={users.isFetching} onClick={() => void users.refetch()}>重新读取用户</Button></div> : null}
      <ul className="admin-user-list" aria-label="用户列表">
        {visible.map((user) => (
          <li key={user.id}>
            <button className="admin-user-row" type="button" aria-label={`管理用户 ${user.displayName} @${user.username}${user.id === actorId ? "（我）" : ""}${user.disabled ? "，已禁用" : ""}`} onClick={(event) => {
              // Safari 的触控点击不会自动聚焦按钮；先记录入口，供 Sheet 关闭时恢复且不滚动列表。
              event.currentTarget.focus({ preventScroll: true });
              setSelectedId(user.id);
            }}>
              <MemberAvatar memberId={user.id} userId={user.id} displayName={user.displayName} avatarPreset={user.avatarPreset} avatarImageId={user.avatarImageId} />
              <strong className="admin-user-row__name">{user.displayName}</strong>
              {user.id === actorId ? <span className="admin-user-row__self">（我）</span> : null}
              {user.disabled ? <span className="tag tag--muted">已禁用</span> : null}
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </li>
        ))}
      </ul>
      {!visible.length ? <div className="admin-users-empty" role="status"><p>{users.data.length ? "没有找到匹配的用户" : "暂无用户"}</p>{search || filter !== "all" ? <Button variant="ghost" onClick={() => { setSearch(""); setFilter("all"); }}>清除搜索与筛选</Button> : null}</div> : null}
      {selected ? <UserManagementPanel key={selected.id} user={selected} actorId={actorId} onClose={closePanel} /> : null}
    </>
  );
}

type Confirmation = "disable" | "grant" | "revoke";

/** 同一层 Sheet 管理账号与密码子表单；敏感操作确认后写入，密码子表单卸载即丢弃草稿。 */
function UserManagementPanel({ user, actorId, onClose }: { user: AdminUser; actorId: string; onClose: () => void }) {
  const status = useUpdateAdminUserStatusMutation(actorId);
  const role = useUpdateAdminRoleMutation(actorId);
  const reset = useResetAdminPasswordMutation(actorId);
  const [view, setView] = useState<"details" | "password">("details");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const busy = submitting || status.isPending || role.isPending || reset.isPending;
  const self = user.id === actorId;
  const confirmationTitle = confirmation === "disable" ? "禁用账号" : confirmation === "grant" ? "设为管理员" : "撤销管理员";

  async function run(action: "enable" | Confirmation) {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setSubmitting(true); setError(undefined); setMessage("");
    try {
      if (action === "enable" || action === "disable") await status.mutateAsync({ userId: user.id, disabled: action === "disable" });
      else await role.mutateAsync({ userId: user.id, granted: action === "grant" });
      setConfirmation(null);
      setMessage(action === "enable" ? "账号已启用。" : action === "disable" ? "账号已禁用。" : action === "grant" ? "已设为系统管理员。" : "已撤销系统管理员权限。");
    } catch (reason) { setError(reason); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  function confirm(action: Confirmation) { setError(undefined); setMessage(""); setConfirmation(action); }
  function backToDetails() { if (!busy) { setView("details"); setError(undefined); } }

  return (
    <>
      <Overlay open title={view === "password" ? "重置密码" : "管理用户"} onClose={onClose} onBeforeClose={() => !busy && !confirmation} onBack={view === "password" ? { label: "返回管理用户", onClick: backToDetails } : undefined} focusKey={view} initialFocus="mobile-dialog" className="admin-user-overlay">
        <div className="admin-user-profile">
          <MemberAvatar memberId={user.id} userId={user.id} displayName={user.displayName} avatarPreset={user.avatarPreset} avatarImageId={user.avatarImageId} />
          <div><strong>{user.displayName}</strong><span>@{user.username}</span>{self ? <small>当前账号</small> : null}</div>
        </div>
        {view === "password" ? <AdminPasswordForm user={user} self={self} mutation={reset} onSuccess={() => { setView("details"); setMessage("密码已重置，该用户需要重新登录。"); }} onBusyChange={setSubmitting} /> : (
          <div className="form-stack">
            <dl className="admin-user-facts"><div><dt>账号状态</dt><dd>{user.disabled ? "已禁用" : "正常"}</dd></div><div><dt>系统管理员</dt><dd>{user.isSystemAdmin ? "是" : "否"}</dd></div></dl>
            {message ? <p className="notice" role="status">{message}</p> : null}
            {error && !confirmation ? <ErrorNotice error={error} /> : null}
            <div className="settings-list">
              <button className="settings-link" type="button" disabled={busy} onClick={() => confirm(user.isSystemAdmin ? "revoke" : "grant")}><ShieldCheck aria-hidden="true" size={18} /><span>{user.isSystemAdmin ? "撤销管理员" : "设为管理员"}</span><ChevronRight aria-hidden="true" size={18} /></button>
              <button className="settings-link" type="button" disabled={busy} onClick={() => { setError(undefined); setMessage(""); setView("password"); }}><KeyRound aria-hidden="true" size={18} /><span>重置密码</span><ChevronRight aria-hidden="true" size={18} /></button>
            </div>
            <Button variant={user.disabled ? "secondary" : "danger"} busy={submitting} disabled={busy} onClick={() => user.disabled ? void run("enable") : confirm("disable")}>{user.disabled ? "启用账号" : "禁用账号"}</Button>
            <p className="form-hint">系统管理员只能管理平台账号，不会因此获得任何活动账目权限。</p>
          </div>
        )}
      </Overlay>
      <ConfirmDialog open={confirmation !== null} title={confirmationTitle} confirmLabel={`确认${confirmationTitle}`} busy={busy} onCancel={() => { if (!busy) { setConfirmation(null); setError(undefined); } }} onConfirm={() => { if (confirmation) void run(confirmation); }} error={error ? <ErrorNotice error={error} /> : undefined} message={<>
        <p className="admin-user-confirm-target">{user.displayName}（@{user.username}）</p>
        <p>{confirmation === "disable" ? "禁用后，该用户将无法登录，已有登录状态将失效。" : confirmation === "grant" ? "该用户将能够管理平台账号与系统设置，但不会因此获得活动账目权限。" : "撤销后，该用户将失去系统管理权限，已有登录状态将失效。"}</p>
        {self && confirmation !== "grant" ? <p>这是你当前使用的账号，操作成功后你将退出登录。</p> : null}
      </>} />
    </>
  );
}

/** 密码仅存在于本次表单生命周期中；失败允许重试，离开表单不保留敏感输入。 */
function AdminPasswordForm({ user, self, mutation, onSuccess, onBusyChange }: { user: AdminUser; self: boolean; mutation: ReturnType<typeof useResetAdminPasswordMutation>; onSuccess: () => void; onBusyChange: (busy: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<unknown>();
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || mutation.isPending) return;
    if (password !== confirmation) { setError(new Error("新密码与确认密码不一致。")); return; }
    inFlight.current = true; setSubmitting(true); onBusyChange(true); setError(undefined);
    try { await mutation.mutateAsync({ userId: user.id, newPassword: password }); onSuccess(); }
    catch (reason) { setError(reason); }
    finally { inFlight.current = false; setSubmitting(false); onBusyChange(false); }
  }
  return <form className="form-stack" onSubmit={(event) => void submit(event)}>
    <p className="form-hint">重置后，该用户的所有登录状态将失效，需要使用新密码重新登录。{self ? "这是你当前使用的账号，重置成功后你将退出登录。" : ""}</p>
    <div className="field"><label className="field__label" htmlFor="admin-reset-password">新密码</label><Input id="admin-reset-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required disabled={submitting} /><span className="field__hint">8–128 个字符，可以使用密码管理器生成和粘贴。</span></div>
    <div className="field"><label className="field__label" htmlFor="admin-reset-password-confirm">确认新密码</label><Input id="admin-reset-password-confirm" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required disabled={submitting} /></div>
    {error ? <ErrorNotice error={error} /> : null}
    <Button type="submit" busy={submitting || mutation.isPending}><KeyRound aria-hidden="true" size={18} />确认重置</Button>
  </form>;
}
