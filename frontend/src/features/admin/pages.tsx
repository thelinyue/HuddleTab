import { ArrowLeft, Bot, ChevronRight, Database, HardDrive, KeyRound, Plus, Settings2, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError, errorMessage } from "../../api/error";
import { MemberAvatar } from "../../components/member-avatar";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { Button, ErrorNotice, Input, LoadingState } from "../../components/ui";
import { Overlay } from "../../components/overlay";
import { useOnlineStatus } from "../activities/offline-workspace";
import { useSessionQuery } from "../auth/api";
import {
  type AdminUser,
  useAdminStorageQuery,
  useAdminUsersQuery,
  useAiSettingsQuery,
  useRegistrationPolicyQuery,
  useResetAdminPasswordMutation,
  useSystemInformationQuery,
  useUpdateAdminRoleMutation,
  useUpdateAdminUserStatusMutation,
  useUpdateRegistrationPolicyMutation,
  useUpdateAiSettingsMutation,
  type AiSettingsInput,
} from "./api";

function AdminFrame({ title, children, backTo = "/admin", backLabel = "返回系统管理" }: { title: string; children: React.ReactNode; backTo?: string; backLabel?: string }) {
  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--no-nav admin-page">
        <header className="me-subpage-header">
          <Link className="icon-button" to={backTo} aria-label={backLabel} title={backLabel}><ArrowLeft aria-hidden="true" size={20} /></Link>
          <h1>{title}</h1>
          <span aria-hidden="true" />
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
          <span><strong>用户管理</strong><small>管理用户状态与系统管理员权限</small></span><ChevronRight aria-hidden="true" size={18} />
        </Link>
        <Link className="settings-link" to="/admin/settings" aria-label="注册策略">
          <Settings2 aria-hidden="true" size={18} />
          <span><strong>注册策略</strong><small>设置是否需要邀请才能创建账号</small></span><ChevronRight aria-hidden="true" size={18} />
        </Link>
        <Link className="settings-link" to="/admin/ai" aria-label="AI 智能录入">
          <Bot aria-hidden="true" size={18} />
          <span><strong>AI 智能录入</strong><small>配置模型与图片识别能力</small></span><ChevronRight aria-hidden="true" size={18} />
        </Link>
        <Link className="settings-link" to="/admin/system" aria-label="系统信息">
          <HardDrive aria-hidden="true" size={18} />
          <span><strong>系统信息</strong><small>查看存储占用与运行版本</small></span><ChevronRight aria-hidden="true" size={18} />
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
              <MemberAvatar memberId={user.id} userId={user.id} displayName={user.displayName} avatarPreset={user.avatarPreset} avatarImageId={user.avatarImageId} />
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
    <Overlay open title="重置密码" onBack={{ label: "返回用户管理", onClick: onClose }} onClose={onClose} focusKey={target.id}>
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

type AiModelDraft = { name: string; supportsImage: boolean };

/** 管理设置只编辑可公开显示的配置；API Key 仅通过空值保留、明文替换或清除三种动作提交。 */
function AiExpenseSettingsCard({ userId, online }: { userId: string; online: boolean }) {
  const settings = useAiSettingsQuery(userId, online);
  const update = useUpdateAiSettingsMutation(userId);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState<AiModelDraft[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [timeoutSeconds, setTimeoutSeconds] = useState("30");
  const [imageEnabled, setImageEnabled] = useState(false);
  const [maxImageBytes, setMaxImageBytes] = useState("10");
  const [jsonMode, setJsonMode] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [error, setError] = useState<unknown>();
  const [versionConflict, setVersionConflict] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    setEnabled(settings.data.enabled);
    setBaseUrl(settings.data.baseUrl ?? "");
    setModels(settings.data.models.map((model) => ({ name: model.name, supportsImage: model.supportsImage })));
    setDefaultModel(settings.data.defaultModel ?? "");
    setTimeoutSeconds(String(settings.data.timeoutSeconds));
    setImageEnabled(settings.data.imageEnabled);
    setMaxImageBytes(String(settings.data.maxImageBytes / (1024 * 1024)));
    setJsonMode(settings.data.jsonMode);
    setApiKey("");
    setClearApiKey(false);
  }, [settings.data]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings.data) return;
    setError(undefined);
    setVersionConflict(false);
    const timeout = Number(timeoutSeconds);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) {
      setError(new Error("超时时间必须是 1–120 秒的整数。"));
      return;
    }
    const imageLimitMiB = Number(maxImageBytes);
    if (!Number.isInteger(imageLimitMiB) || imageLimitMiB < 1 || imageLimitMiB > 10) {
      setError(new Error("图片大小上限必须是 1–10 MiB 的整数。"));
      return;
    }
    const normalizedModels = models.map((model) => ({ name: model.name.trim(), supportsImage: model.supportsImage }));
    const selectedModel = normalizedModels.find((model) => model.name === defaultModel.trim());
    const input: AiSettingsInput = {
      enabled: clearApiKey ? false : enabled,
      baseUrl: baseUrl.trim() || null,
      models: normalizedModels,
      defaultModel: selectedModel?.name ?? null,
      timeoutSeconds: timeout,
      jsonMode,
      // 服务端禁止基础 AI 关闭时保留图片能力；关闭总开关时一起写入 false。
      imageEnabled: clearApiKey ? false : enabled ? imageEnabled && selectedModel?.supportsImage === true : false,
      maxImageBytes: imageLimitMiB * 1024 * 1024,
      version: settings.data.version,
      clearApiKey,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
    try {
      await update.mutateAsync(input);
      setApiKey("");
      setClearApiKey(false);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 409) {
        setVersionConflict(true);
        setError(new Error("设置已被其他管理员修改，请重新加载后再保存。"));
        return;
      }
      setError(reason);
    }
  }

  if (!online) return <section className="admin-settings-card"><div className="admin-settings-card__heading"><Bot aria-hidden="true" size={20} /><div><h2>AI 智能录入</h2><p>当前离线，联网后才能读取或修改 AI 设置。</p></div></div></section>;
  if (settings.isPending) return <section className="admin-settings-card"><LoadingState label="正在读取 AI 设置…" /></section>;
  if (settings.error) return <section className="admin-settings-card"><ErrorNotice error={settings.error} /></section>;
  if (!settings.data) return null;
  const apiKeyStatus = settings.data.apiKeyStatus;
  const selectedModel = models.find((model) => model.name.trim() === defaultModel.trim());
  const imageModelReady = selectedModel?.supportsImage === true;
  return <section className="admin-settings-card" aria-labelledby="ai-settings-heading">
    <div className="admin-settings-card__heading"><Bot aria-hidden="true" size={20} /><div><h2 id="ai-settings-heading">AI 智能录入</h2><p>只生成账单草稿，不会直接写入账务事实。</p></div></div>
    {apiKeyStatus === "RECONFIGURATION_REQUIRED" ? <div className="notice notice--error" role="alert">API Key 无法解密，请重新填写或清除 API Key 后保存。</div> : null}
    {error ? <ErrorNotice error={error} /> : null}
    {versionConflict ? <Button type="button" variant="secondary" onClick={() => { setVersionConflict(false); setError(undefined); void settings.refetch(); }}>重新加载设置</Button> : null}
    <form className="form-stack ai-settings-form" onSubmit={(event) => void save(event)}>
      <label className="settings-choice"><input type="checkbox" checked={enabled} disabled={update.isPending || clearApiKey} onChange={(event) => setEnabled(event.target.checked)} />启用 AI 智能录入</label>
      <label className="field"><span className="field__label">Base URL</span><Input aria-label="Base URL" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.deepseek.com/v1" autoComplete="off" /></label>
      <div className="ai-models-editor" aria-label="AI 模型列表">
        <div className="ai-models-editor__heading"><span className="field__label">模型</span><Button type="button" variant="secondary" onClick={() => setModels((current) => [...current, { name: "", supportsImage: false }])}><Plus aria-hidden="true" size={16} />添加模型</Button></div>
        {models.length === 0 ? <p className="form-hint">请添加至少一个模型，并选择默认模型。</p> : null}
        {models.map((model, index) => <div className="ai-model-row" key={index}>
          <label className="field"><span className="field__label">模型名称 {index + 1}</span><Input aria-label={`模型名称 ${index + 1}`} value={model.name} onChange={(event) => setModels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} placeholder="deepseek-chat" autoComplete="off" /></label>
          <div className="ai-model-row__options">
            <label className="settings-choice"><input type="radio" name="default-ai-model" aria-label={`模型 ${index + 1} 设为默认`} checked={defaultModel === model.name && model.name.trim().length > 0} onChange={() => setDefaultModel(model.name)} />默认模型</label>
            <label className="settings-choice"><input type="checkbox" aria-label={`模型 ${index + 1} 支持图片识别`} checked={model.supportsImage} onChange={(event) => setModels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, supportsImage: event.target.checked } : item))} />支持图片识别</label>
            <Button type="button" variant="ghost" aria-label={`删除模型 ${index + 1}`} onClick={() => { setModels((current) => current.filter((_item, itemIndex) => itemIndex !== index)); if (defaultModel === model.name) setDefaultModel(""); }}><Trash2 aria-hidden="true" size={16} />删除</Button>
          </div>
        </div>)}
        <p className="form-hint">系统只调用默认模型。勾选“支持图片识别”后，该默认模型才能用于图片识别。</p>
      </div>
      <label className="settings-choice"><input type="checkbox" checked={imageEnabled} disabled={update.isPending || clearApiKey || !enabled || !imageModelReady} onChange={(event) => setImageEnabled(event.target.checked)} />启用图片识别</label>
      {!imageModelReady ? <p className="form-hint">请先为默认模型勾选“支持图片识别”，再启用图片识别。</p> : null}
      <label className="field"><span className="field__label">图片大小上限（MiB）</span><Input aria-label="图片大小上限（MiB）" inputMode="numeric" value={maxImageBytes} onChange={(event) => setMaxImageBytes(event.target.value)} min={1} max={10} /></label>
      <label className="field"><span className="field__label">Timeout（秒）</span><Input aria-label="Timeout（秒）" inputMode="numeric" value={timeoutSeconds} onChange={(event) => setTimeoutSeconds(event.target.value)} min={1} max={120} /></label>
      <label className="field"><span className="field__label">API Key</span><Input aria-label="API Key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={apiKeyStatus === "CONFIGURED" ? "已配置；留空表示保留" : "请输入 API Key"} autoComplete="new-password" /><span className="field__hint">当前状态：{apiKeyStatus === "CONFIGURED" ? "已配置" : apiKeyStatus === "NOT_SET" ? "未配置" : "需要重新配置"}。不会回显密钥。</span></label>
      <label className="settings-choice"><input type="checkbox" checked={clearApiKey} onChange={(event) => { setClearApiKey(event.target.checked); if (event.target.checked) setEnabled(false); }} />清除 API Key</label>
      <label className="settings-choice"><input type="checkbox" checked={jsonMode} onChange={(event) => setJsonMode(event.target.checked)} />发送 JSON Mode 参数</label>
      <p className="form-hint">DeepSeek 等支持 JSON Mode 的服务建议开启；不支持 response_format 的本地兼容服务请关闭。</p>
      <Button type="submit" busy={update.isPending}>保存 AI 设置</Button>
    </form>
  </section>;
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

export function AdminAiSettingsPage() {
  const session = useSessionQuery();
  const online = useOnlineStatus();
  return <AdminFrame title="AI 智能录入"><AiExpenseSettingsCard userId={session.data?.userId ?? ""} online={online} /></AdminFrame>;
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
