import { ArrowLeft, Bot, ChevronRight, Database, HardDrive, UsersRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AdminUsersContent } from "./users";
import { AiSettingsEditor } from "./ai-settings";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { ErrorNotice, LoadingState } from "../../components/ui";
import { useOnlineStatus } from "../activities/offline-workspace";
import { useSessionQuery } from "../auth/api";
import {
  useAdminStorageQuery,
  useRegistrationPolicyQuery,
  useSystemInformationQuery,
  useUpdateRegistrationPolicyMutation,
} from "./api";

/** 管理页共用返回栏和内容宽度；注册策略属于用户管理的下级入口。 */
function AdminFrame({ title, children, action, backTo = "/admin", backLabel = "返回系统管理" }: { title: string; children: React.ReactNode; action?: React.ReactNode; backTo?: string; backLabel?: string }) {
  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--no-nav admin-page">
        <header className="me-subpage-header">
          <Link className="icon-button" to={backTo} aria-label={backLabel} title={backLabel}><ArrowLeft aria-hidden="true" size={20} /></Link>
          <h1>{title}</h1>
          {action ?? <span aria-hidden="true" />}
        </header>
        <div className="admin-page__content">{children}</div>
      </main>
      <ProductBottomNavigation />
    </div>
  );
}

export function AdminHomePage() {
  return (
    <AdminFrame title="系统管理" backTo="/me" backLabel="返回我的">
      <div className="settings-list admin-entry-list">
        <Link className="settings-link" to="/admin/users" aria-label="用户管理">
          <UsersRound aria-hidden="true" size={18} />
          <span><strong>用户管理</strong></span><ChevronRight aria-hidden="true" size={18} />
        </Link>
        <Link className="settings-link" to="/admin/ai" aria-label="AI 智能录入">
          <Bot aria-hidden="true" size={18} />
          <span><strong>AI 智能录入</strong></span><ChevronRight aria-hidden="true" size={18} />
        </Link>
        <Link className="settings-link" to="/admin/system" aria-label="系统信息">
          <HardDrive aria-hidden="true" size={18} />
          <span><strong>系统信息</strong></span><ChevronRight aria-hidden="true" size={18} />
        </Link>
      </div>
    </AdminFrame>
  );
}

export function AdminUsersPage() {
  return <AdminFrame title="用户管理" action={<Link className="admin-header-action" to="/admin/settings">注册策略</Link>}><AdminUsersContent /></AdminFrame>;
}

export function AdminSettingsPage() {
  const session = useSessionQuery();
  const online = useOnlineStatus();
  const userId = session.data?.userId ?? "";
  const policy = useRegistrationPolicyQuery(userId, online);
  const update = useUpdateRegistrationPolicyMutation(userId);
  const [error, setError] = useState<unknown>();
  const [saved, setSaved] = useState(false);
  async function save(value: "OPEN" | "INVITE_ONLY") {
    if (!policy.data || !online || update.isPending || value === policy.data.policy) return;
    setError(undefined); setSaved(false);
    try { await update.mutateAsync({ policy: value, version: policy.data.version }); setSaved(true); }
    catch (reason) { setError(reason); }
  }
  return (
    <AdminFrame title="注册策略" backTo="/admin/users" backLabel="返回用户管理">
      {!online ? <div className="notice" role="status">当前离线，系统设置需要联网后使用。</div> : null}
      {policy.isPending && online ? <LoadingState label="正在读取注册策略…" /> : null}
      {policy.error ? <ErrorNotice error={policy.error} /> : null}
      {error ? <ErrorNotice error={error} /> : null}
      {policy.data ? <section className="admin-settings-card registration-policy-card" aria-label="注册方式">
        <label className="settings-choice"><input type="radio" name="registration-policy" checked={policy.data.policy === "INVITE_ONLY"} disabled={!online || update.isPending} onChange={() => void save("INVITE_ONLY")} />仅允许邀请注册</label>
        <label className="settings-choice"><input type="radio" name="registration-policy" checked={policy.data.policy === "OPEN"} disabled={!online || update.isPending} onChange={() => void save("OPEN")} />开放注册</label>
        <p className="form-hint">开放注册关闭后，仍需有效活动邀请才能创建账号。</p>
        {update.isPending || saved ? <p className="form-hint" role="status">{update.isPending ? "正在保存注册策略…" : "注册策略已保存"}</p> : null}
      </section> : null}
    </AdminFrame>
  );
}

export function AdminAiSettingsPage() {
  const session = useSessionQuery();
  const online = useOnlineStatus();
  return <AdminFrame title="AI 智能录入"><AiSettingsEditor userId={session.data?.userId ?? ""} online={online} /></AdminFrame>;
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
      <section className="admin-settings-card" aria-label="运行信息">
        <dl className="admin-system-metrics">
          <Metric label="应用版本" value={information.data.appVersion} />
          <Metric label="PWA 版本" value={information.data.pwaVersion} />
          <Metric label="数据库版本" value={information.data.databaseVersion} />
          <Metric label="数据目录" value={information.data.dataDirectory} />
        </dl>
      </section>
      <section className="admin-settings-card" aria-label="存储使用">
        <dl className="admin-system-metrics">
          <Metric label="合计" value={formatBytes(storage.data.totalBytes)} strong />
          <Metric icon={<Database aria-hidden="true" size={16} />} label="数据库" value={formatBytes(storage.data.databaseBytes)} />
          <Metric label="上传文件" value={formatBytes(storage.data.uploadsBytes)} />
        </dl>
        <p className="form-hint">仅统计数据库和私有图片附件。</p>
      </section>
    </AdminFrame>
  );
}

function Metric({ icon, label, value, strong = false }: { readonly icon?: React.ReactNode; readonly label: string; readonly value: string; readonly strong?: boolean }) {
  return <div className={`admin-system-metric${label === "数据目录" ? " admin-system-metric--path" : ""}${strong ? " admin-system-metric--total" : ""}`}><dt>{icon ? <span aria-hidden="true">{icon}</span> : null}{label}</dt><dd className={strong ? "strong" : undefined}>{value}</dd></div>;
}
