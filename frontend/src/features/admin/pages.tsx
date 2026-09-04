import { ArrowLeft, Database, HardDrive, KeyRound, Settings2, ShieldCheck, UserCog, UsersRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../../api/error";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { Button, ErrorNotice, Input, LoadingState } from "../../components/ui";
import { Overlay } from "../activities/pages";
import { useOnlineStatus } from "../activities/offline-workspace";
import { useSessionQuery } from "../auth/api";
import {
  type AdminUser,
  useAdminStorageQuery,
  useAdminUsersQuery,
  useRegistrationPolicyQuery,
  useResetAdminPasswordMutation,
  useSystemInformationQuery,
  useUpdateAdminRoleMutation,
  useUpdateAdminUserStatusMutation,
  useUpdateRegistrationPolicyMutation,
} from "./api";

function AdminFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="me-subpage-header">
          <Link className="icon-button" to="/admin" aria-label="返回系统管理" title="返回系统管理"><ArrowLeft aria-hidden="true" size={20} /></Link>
          <h1>{title}</h1>
          <span aria-hidden="true" />
        </header>
        {children}
      </main>
      <ProductBottomNavigation />
    </div>
  );
}

export function AdminHomePage() {
  return (
    <AdminFrame title="系统管理">
      <div className="settings-list admin-entry-list">
        <Link className="settings-link" to="/admin/users" aria-label="用户管理">
          <UsersRound aria-hidden="true" size={18} />
          <span><strong>用户管理</strong><small>管理用户状态与系统管理员权限</small></span><span aria-hidden="true">›</span>
        </Link>
        <Link className="settings-link" to="/admin/settings" aria-label="注册策略">
          <Settings2 aria-hidden="true" size={18} />
          <span><strong>注册策略</strong><small>设置是否需要邀请才能创建账号</small></span><span aria-hidden="true">›</span>
        </Link>
        <Link className="settings-link" to="/admin/system" aria-label="系统信息">
          <HardDrive aria-hidden="true" size={18} />
          <span><strong>系统信息</strong><small>查看存储占用与运行版本</small></span><span aria-hidden="true">›</span>
        </Link>
      </div>
    </AdminFrame>
  );
}

export function AdminUsersPage() {
  const session = useSessionQuery();
  const online = useOnlineStatus();
  const userId = session.data?.userId ?? "";
  const users = useAdminUsersQuery(userId, online);
  const status = useUpdateAdminUserStatusMutation(userId);
  const role = useUpdateAdminRoleMutation(userId);
  const reset = useResetAdminPasswordMutation(userId);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [error, setError] = useState<unknown>();

  async function run(action: () => Promise<unknown>) {
    setError(undefined);
    try { await action(); } catch (reason) { setError(reason); }
  }

  if (!online) {
    return <AdminFrame title="用户管理"><div className="notice" role="status">当前离线，系统管理需要联网后使用。</div></AdminFrame>;
  }
  if (users.isPending) return <AdminFrame title="用户管理"><LoadingState label="正在读取用户…" /></AdminFrame>;
  if (users.error) return <AdminFrame title="用户管理"><ErrorNotice error={users.error} /></AdminFrame>;

  return (
    <AdminFrame title="用户管理">
      {error ? <ErrorNotice error={error} /> : null}
      <p className="form-hint">系统管理员只能管理平台账号，不会因此获得任何活动账目权限。</p>
      <ul className="admin-user-list">
        {users.data.map((user) => (
          <li className="admin-user-row" key={user.id}>
            <div className="admin-user-row__identity">
              <span className="profile-avatar" aria-hidden="true"><UserCog size={22} /></span>
              <span><strong>{user.displayName}</strong><small>@{user.username} · {user.disabled ? "已禁用" : "正常"}{user.isSystemAdmin ? " · 系统管理员" : ""}</small></span>
            </div>
            <div className="admin-user-row__actions">
              <Button variant="ghost" disabled={status.isPending || role.isPending || reset.isPending} onClick={() => void run(() => status.mutateAsync({ userId: user.id, disabled: !user.disabled }))}>{user.disabled ? "启用" : "禁用"}</Button>
              <Button variant="ghost" disabled={status.isPending || role.isPending || reset.isPending} onClick={() => void run(() => role.mutateAsync({ userId: user.id, granted: !user.isSystemAdmin }))}>{user.isSystemAdmin ? "撤销管理员" : "设为管理员"}</Button>
              <Button variant="secondary" disabled={status.isPending || role.isPending || reset.isPending} onClick={() => { setError(undefined); setSelected(user); }}>重置密码</Button>
            </div>
          </li>
        ))}
      </ul>
      <ResetPasswordOverlay user={selected} onClose={() => setSelected(null)} mutation={reset} />
    </AdminFrame>
  );
}

function ResetPasswordOverlay({ user, onClose, mutation }: { user: AdminUser | null; onClose: () => void; mutation: ReturnType<typeof useResetAdminPasswordMutation> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string>();
  if (!user) return null;
  const target = user;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { setError("新密码与确认密码不一致。"); return; }
    setError(undefined);
    try {
      await mutation.mutateAsync({ userId: target.id, newPassword: password });
      setPassword(""); setConfirmation(""); onClose();
    } catch (reason) { setError(errorMessage(reason)); }
  }
  return (
    <Overlay open title="重置密码" backLabel="返回用户管理" onBack={onClose} onClose={onClose} focusKey={target.id}>
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <p className="form-hint">将撤销该用户的全部登录 Session。密码不会显示给其他人。</p>
        <div className="field">
          <label className="field__label" htmlFor="admin-reset-password">新密码</label>
          <Input id="admin-reset-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required autoFocus />
          <span className="field__hint">8–128 个字符，可以使用密码管理器生成和粘贴。</span>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="admin-reset-password-confirm">确认新密码</label>
          <Input id="admin-reset-password-confirm" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={8} maxLength={128} autoComplete="new-password" required />
        </div>
        {error ? <ErrorNotice error={new Error(error)} /> : null}
        <Button type="submit" busy={mutation.isPending}><KeyRound aria-hidden="true" size={18} />确认重置</Button>
      </form>
    </Overlay>
  );
}

export function AdminSettingsPage() {
  const session = useSessionQuery();
  const online = useOnlineStatus();
  const userId = session.data?.userId ?? "";
  const policy = useRegistrationPolicyQuery(userId, online);
  const update = useUpdateRegistrationPolicyMutation(userId);
  const [error, setError] = useState<unknown>();
  async function save(value: "OPEN" | "INVITE_ONLY") {
    if (!policy.data) return;
    setError(undefined);
    try { await update.mutateAsync({ policy: value, version: policy.data.version }); }
    catch (reason) { setError(reason); }
  }
  return (
    <AdminFrame title="注册策略">
      {!online ? <div className="notice" role="status">当前离线，系统设置需要联网后使用。</div> : null}
      {policy.isPending && online ? <LoadingState label="正在读取注册策略…" /> : null}
      {policy.error ? <ErrorNotice error={policy.error} /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      {policy.data ? <section className="admin-settings-card">
        <div className="admin-settings-card__heading"><ShieldCheck aria-hidden="true" size={20} /><div><h2>账号注册</h2><p>开放注册关闭后，仍需有效活动邀请才能创建账号。</p></div></div>
        <label className="settings-choice"><input type="radio" name="registration-policy" checked={policy.data.policy === "INVITE_ONLY"} disabled={!online || update.isPending} onChange={() => void save("INVITE_ONLY")} />仅允许邀请注册</label>
        <label className="settings-choice"><input type="radio" name="registration-policy" checked={policy.data.policy === "OPEN"} disabled={!online || update.isPending} onChange={() => void save("OPEN")} />开放注册</label>
      </section> : null}
    </AdminFrame>
  );
}

function formatBytes(value: string): string {
  try {
    let bytes = BigInt(value);
    const units = ["B", "KB", "MB", "GB", "TB"];
    let unit = 0;
    while (bytes >= 1024n && unit < units.length - 1) {
      bytes /= 1024n;
      unit += 1;
    }
    return `${new Intl.NumberFormat("zh-CN").format(bytes)} ${units[unit]}`;
  } catch {
    return "—";
  }
}

export function AdminSystemInformationPage() {
  const session = useSessionQuery();
  const online = useOnlineStatus();
  const userId = session.data?.userId ?? "";
  const storage = useAdminStorageQuery(userId, online);
  const information = useSystemInformationQuery(userId, online);

  if (!online) {
    return <AdminFrame title="系统信息"><div className="notice" role="status">当前离线，系统信息需要联网后使用。</div></AdminFrame>;
  }
  if (storage.isPending || information.isPending) {
    return <AdminFrame title="系统信息"><LoadingState label="正在读取系统信息…" /></AdminFrame>;
  }
  const error = storage.error ?? information.error;
  if (error) {
    return <AdminFrame title="系统信息"><ErrorNotice error={error} /></AdminFrame>;
  }
  if (!storage.data || !information.data) return null;

  return (
    <AdminFrame title="系统信息">
      <section className="admin-settings-card" aria-labelledby="storage-heading">
        <div className="admin-settings-card__heading"><HardDrive aria-hidden="true" size={20} /><div><h2 id="storage-heading">存储使用</h2><p>仅统计数据库和私有图片附件。</p></div></div>
        <dl className="admin-system-metrics">
          <Metric icon={<Database aria-hidden="true" size={16} />} label="数据库" value={formatBytes(storage.data.databaseBytes)} />
          <Metric label="上传文件" value={formatBytes(storage.data.uploadsBytes)} />
          <Metric label="合计" value={formatBytes(storage.data.totalBytes)} strong />
        </dl>
      </section>
      <section className="admin-settings-card" aria-labelledby="runtime-heading">
        <div className="admin-settings-card__heading"><ShieldCheck aria-hidden="true" size={20} /><div><h2 id="runtime-heading">运行信息</h2><p>当前服务实例的版本与数据目录。</p></div></div>
        <dl className="admin-system-metrics">
          <Metric label="应用版本" value={information.data.appVersion} />
          <Metric label="PWA 版本" value={information.data.pwaVersion} />
          <Metric label="数据库版本" value={information.data.databaseVersion} />
          <Metric label="数据目录" value={information.data.dataDirectory} />
        </dl>
      </section>
    </AdminFrame>
  );
}

function Metric({ icon, label, value, strong = false }: { readonly icon?: React.ReactNode; readonly label: string; readonly value: string; readonly strong?: boolean }) {
  return <div className="admin-system-metric"><dt>{icon ? <span aria-hidden="true">{icon}</span> : null}{label}</dt><dd className={strong ? "strong" : undefined}>{value}</dd></div>;
}
