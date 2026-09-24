import { ChevronRight, Plus } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError } from "../../api/error";
import { usePwaUpdateBlock } from "../../app/pwa-update-safety";
import { Overlay } from "../../components/overlay";
import { Button, ErrorNotice, Field, Input, LoadingState, Select } from "../../components/ui";
import { useAiSettingsQuery, useUpdateAiSettingsMutation, type AiSettings } from "./api";
import { aiDraftInput, createAiDraft, modelError, validateAiDraft, type AiDraft, type DraftErrors, type ModelDraft } from "./ai-settings-draft";

type Editor = { saved: AiSettings; initial: AiDraft; draft: AiDraft };
type ModelPanel = { model: ModelDraft; adding: boolean; view: "edit" | "delete"; replacement: string };
function editorFor(saved: AiSettings): Editor {
  const draft = createAiDraft(saved);
  return { saved, initial: draft, draft };
}
function changed(editor: Editor) { return JSON.stringify(editor.draft) !== JSON.stringify(editor.initial); }

/** 原生按钮负责键盘和禁用语义，视觉轨道不缩小 44px 的可点击范围。 */
function AiSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <div className="ai-setting-row"><span>{label}</span><button className="ai-setting-switch" type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span aria-hidden="true"><i /></span></button></div>;
}

/**
 * 配置页只有统一保存才写入；模型面板维护局部副本，“完成”仅更新页面草稿。
 * 查询刷新只接管无修改、无打开面板的页面，防止切回窗口或恢复网络时覆盖用户输入。
 * 密钥仅保留在组件内存，提交成功、恢复或卸载后不继续保存输入原文。
 */
export function AiSettingsEditor({ userId, online }: { userId: string; online: boolean }) {
  const settings = useAiSettingsQuery(userId, online);
  const update = useUpdateAiSettingsMutation(userId);
  const [editor, setEditor] = useState<Editor | null>(() => settings.data ? editorFor(settings.data) : null);
  const [panel, setPanel] = useState<ModelPanel | null>(null);
  const [panelError, setPanelError] = useState<string>();
  const [errors, setErrors] = useState<DraftErrors>({});
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [savedMessage, setSavedMessage] = useState(false);
  const [imageNotice, setImageNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const inFlight = useRef(false);
  const nextModelId = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = editor ? changed(editor) : false;
  const busy = saving || reloading || update.isPending;
  usePwaUpdateBlock(dirty || panel !== null || busy);

  useEffect(() => {
    const data = settings.data;
    if (!data) return;
    // 保存返回值可能先于查询刷新到达；旧查询结果不能把已保存版本回退。
    setEditor((current) => current && (changed(current) || panel || inFlight.current || current.saved.version >= data.version) ? current : editorFor(data));
  }, [settings.data, panel]);

  function change(patch: Partial<AiDraft>) {
    if (!editor || inFlight.current || !online) return;
    const draft = { ...editor.draft, ...patch };
    if (draft.imageEnabled && (!draft.enabled || !draft.models.find((model) => model.id === draft.defaultId)?.supportsImage)) {
      draft.imageEnabled = false;
      setImageNotice(draft.enabled ? "默认模型不支持图片识别，图片识别已关闭，保存后生效。" : "AI 已关闭，图片识别也将关闭，保存后生效。");
    } else setImageNotice("");
    setEditor({ ...editor, draft });
    setErrors({}); setSavedMessage(false);
    if (!conflict) setError(undefined);
  }

  function reset(saved: AiSettings) {
    setEditor(editorFor(saved)); setErrors({}); setError(undefined); setConflict(false);
    setImageNotice(""); setPanel(null); setSavedMessage(false);
  }

  async function reload() {
    if (inFlight.current || !online) return;
    inFlight.current = true; setReloading(true);
    try {
      const result = await settings.refetch();
      if (result.error) { setError(result.error); return; }
      if (result.data) reset(result.data);
    } catch (reason) { setError(reason); }
    finally { inFlight.current = false; setReloading(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || !dirty || !online || inFlight.current || panel) return;
    const validation = validateAiDraft(editor.draft, editor.saved);
    setErrors(validation); setSavedMessage(false);
    const first = Object.keys(validation)[0];
    if (first) {
      formRef.current?.querySelector<HTMLElement>(`[data-ai-field="${first}"]`)?.focus();
      return;
    }
    inFlight.current = true; setSaving(true); setError(undefined);
    try {
      const result = await update.mutateAsync(aiDraftInput(editor.draft, editor.saved));
      reset(result); setSavedMessage(true);
    } catch (reason) {
      if (reason instanceof ApiRequestError && reason.status === 409) {
        setConflict(true); setError(new Error("设置已被其他管理员修改，当前输入已保留。"));
      } else setError(reason);
    } finally { inFlight.current = false; setSaving(false); }
  }

  function openModel(trigger: HTMLButtonElement, model?: ModelDraft) {
    if (busy || !online) return;
    // Safari 点击按钮时不会自动聚焦，先记录入口，关闭面板后才能恢复键盘位置。
    trigger.focus({ preventScroll: true });
    setPanelError(undefined);
    setPanel({ model: model ? { ...model } : { id: `new-${++nextModelId.current}`, name: "", supportsImage: false }, adding: !model, view: "edit", replacement: "" });
  }

  function completeModel(event: FormEvent) {
    event.preventDefault();
    if (!editor || !panel || busy || !online) return;
    const message = modelError(panel.model, editor.draft.models, panel.adding);
    if (message) { setPanelError(message); return; }
    const model = { ...panel.model, name: panel.model.name.trim() };
    const models = panel.adding ? [...editor.draft.models, model] : editor.draft.models.map((item) => item.id === model.id ? model : item);
    change({ models, defaultId: panel.adding && editor.draft.models.length === 0 ? model.id : editor.draft.defaultId });
    setPanel(null);
  }

  function deleteModel() {
    if (!editor || !panel || busy || !online) return;
    const models = editor.draft.models.filter((model) => model.id !== panel.model.id);
    const wasDefault = panel.model.id === editor.draft.defaultId;
    if (wasDefault && models.length && !models.some((model) => model.id === panel.replacement)) return;
    change({ models, defaultId: wasDefault ? panel.replacement || null : editor.draft.defaultId, ...(models.length === 0 ? { enabled: false, imageEnabled: false } : {}) });
    setPanel(null);
  }

  if (!editor) {
    if (!online) return <div className="notice" role="status">当前离线，联网后才能读取 AI 设置。</div>;
    if (settings.error) return <div className="form-stack"><ErrorNotice error={settings.error} /><Button onClick={() => void settings.refetch()}>重试</Button></div>;
    return <LoadingState label="正在读取 AI 设置…" />;
  }
  const { draft, saved } = editor;
  const clearing = draft.keyAction === "clear";
  const enabled = draft.enabled && !clearing;
  const defaultModel = draft.models.find((model) => model.id === draft.defaultId);
  const imageReady = enabled && defaultModel?.supportsImage === true;
  const showKeyInput = !clearing && (draft.keyAction === "replace" || saved.apiKeyStatus !== "CONFIGURED");
  const replacing = draft.keyAction === "replace";
  const others = panel ? draft.models.filter((model) => model.id !== panel.model.id) : [];
  const deletingDefault = panel?.model.id === draft.defaultId;

  return <div className="ai-settings-editor">
    <p className="form-hint">只生成账单草稿，确认后才会记账。</p>
    {!online ? <div className="notice" role="status">当前离线，修改已保留，联网后可保存。</div> : null}
    {settings.error && online ? <ErrorNotice error={settings.error} /> : null}
    {error ? <ErrorNotice error={error} /> : null}
    {conflict ? <div className="ai-conflict"><p className="form-hint">重新加载将放弃当前未保存的修改。</p><Button variant="secondary" disabled={!online || busy} onClick={() => void reload()}>放弃修改并重新加载</Button></div> : null}
    <form ref={formRef} className="ai-settings-form" onSubmit={(event) => void save(event)} noValidate>
      <fieldset className="ai-settings-fields" disabled={!online || busy}>
        <section className="admin-settings-card ai-settings-card" aria-label="AI 连接配置">
          <AiSwitch label="启用 AI 智能录入" checked={enabled} disabled={clearing} onChange={(value) => change({ enabled: value })} />
          <Field label="接口地址" error={errors.baseUrl} hint="Base URL：填写接口基础地址，不包含 /chat/completions。">
            <Input aria-label="接口地址" data-ai-field="baseUrl" value={draft.baseUrl} aria-invalid={Boolean(errors.baseUrl)} autoComplete="off" placeholder="https://api.example.com/v1" onChange={(event) => change({ baseUrl: event.target.value })} />
          </Field>
          <div className="ai-key-row"><span><strong>API 密钥</strong><small>{clearing ? "待清除" : replacing ? "待更换" : saved.apiKeyStatus === "CONFIGURED" ? "已配置" : saved.apiKeyStatus === "NOT_SET" ? "未配置" : "需要重新配置"}</small></span><div>
            {clearing ? <button className="settings-text-button" type="button" onClick={() => change({ keyAction: "keep", apiKey: "" })}>撤销清除</button> : <>
              {saved.apiKeyStatus === "CONFIGURED" && !replacing ? <button className="settings-text-button" type="button" onClick={() => change({ keyAction: "replace", apiKey: "" })}>更换</button> : null}
              {replacing ? <button className="settings-text-button" type="button" onClick={() => change({ keyAction: "keep", apiKey: "" })}>取消更换</button> : null}
              {saved.apiKeyStatus !== "NOT_SET" ? <button className="settings-text-button settings-text-button--danger" type="button" onClick={() => change({ keyAction: "clear", apiKey: "" })}>清除</button> : null}
            </>}
          </div></div>
          {showKeyInput ? <Field label="新的 API 密钥" error={errors.apiKey} hint="原密钥不会回显；新密钥仅在保存后生效。"><Input aria-label="新的 API 密钥" data-ai-field="apiKey" type="password" value={draft.apiKey} aria-invalid={Boolean(errors.apiKey)} autoComplete="new-password" onChange={(event) => change({ keyAction: "replace", apiKey: event.target.value })} /></Field> : null}
          {saved.apiKeyStatus === "RECONFIGURATION_REQUIRED" && !clearing ? <p role="alert" className="field__error">原 API 密钥无法解密，请重新填写或清除后保存。</p> : null}
          {clearing ? <p role="status" className="form-hint">保存后将清除密钥，并关闭 AI 和图片识别。现在仍可撤销。</p> : null}
        </section>
        <section className="admin-settings-card ai-settings-card" aria-label="AI 模型配置">
          <div className="ai-models-heading"><span>模型 <small>{draft.models.length} / 32</small></span><button className="settings-text-button" type="button" disabled={draft.models.length >= 32} onClick={(event) => openModel(event.currentTarget)}><Plus aria-hidden="true" size={16} />添加</button></div>
          <div className="ai-model-list" role="radiogroup" aria-label="默认模型" tabIndex={-1} data-ai-field="defaultModel" aria-invalid={Boolean(errors.defaultModel)}>
            {draft.models.map((model) => <div className="ai-model-list__row" key={model.id}>
              <label className="ai-model-list__radio"><input type="radio" name="default-ai-model" checked={draft.defaultId === model.id} aria-label={`使用 ${model.name} 作为默认模型`} onChange={() => change({ defaultId: model.id })} /></label>
              <button type="button" className="ai-model-list__edit" aria-label={`编辑模型 ${model.name}`} onClick={(event) => openModel(event.currentTarget, model)}><span><strong>{model.name}</strong><span className="ai-model-list__badges">{draft.defaultId === model.id ? <small className="ai-model-list__default">默认</small> : null}<small>{model.supportsImage ? "支持图片" : "文字"}</small></span></span><ChevronRight aria-hidden="true" size={18} /></button>
            </div>)}
            {!draft.models.length ? <p className="form-hint ai-model-list__empty">暂无模型，请添加服务商提供的模型 ID。</p> : null}
          </div>
          <div tabIndex={-1} data-ai-field="models">{errors.models || errors.defaultModel ? <p role="alert" className="field__error">{errors.models ?? errors.defaultModel}</p> : <p className="form-hint">文字与图片均使用默认模型。点击模型可编辑。</p>}</div>
          <AiSwitch label="启用图片识别" checked={imageReady && draft.imageEnabled} disabled={!imageReady} onChange={(value) => change({ imageEnabled: value })} />
          {imageNotice ? <p className="form-hint" role="status">{imageNotice}</p> : enabled && !defaultModel?.supportsImage ? <p className="form-hint">请先选择支持图片识别的默认模型。</p> : null}
          <label className="ai-number-row"><span>图片大小上限</span><span><Input aria-label="图片大小上限" data-ai-field="maxImageMiB" type="number" min={1} max={10} step={1} inputMode="numeric" value={draft.maxImageMiB} aria-invalid={Boolean(errors.maxImageMiB)} onChange={(event) => change({ maxImageMiB: event.target.value })} /><small>MiB</small></span></label>
          {errors.maxImageMiB ? <p className="field__error" role="alert">{errors.maxImageMiB}</p> : null}
        </section>
        <section className="admin-settings-card ai-settings-card" aria-label="AI 请求参数">
          <label className="ai-number-row"><span>请求超时</span><span><Input aria-label="请求超时" data-ai-field="timeoutSeconds" type="number" min={1} max={120} step={1} inputMode="numeric" value={draft.timeoutSeconds} aria-invalid={Boolean(errors.timeoutSeconds)} onChange={(event) => change({ timeoutSeconds: event.target.value })} /><small>秒</small></span></label>
          {errors.timeoutSeconds ? <p className="field__error" role="alert">{errors.timeoutSeconds}</p> : null}
          <AiSwitch label="JSON 输出模式" checked={draft.jsonMode} onChange={(value) => change({ jsonMode: value })} />
          <p className="form-hint">向服务发送 JSON Mode 参数；不支持 response_format 的服务请关闭。</p>
        </section>
      </fieldset>
      <div className="ai-save-status"><span role="status">{saving ? "正在保存…" : savedMessage ? "设置已保存" : dirty ? "有未保存的修改" : "已保存"}</span><button className="settings-text-button" type="button" disabled={!dirty || busy || panel !== null} onClick={() => reset(editor.saved)}>恢复已保存</button></div>
      <Button className="ai-save-button" type="submit" busy={saving} disabled={!dirty || !online || busy || panel !== null}>保存设置</Button>
    </form>
    <Overlay open={panel !== null} title={panel?.view === "delete" ? "删除默认模型" : panel?.adding ? "添加模型" : "编辑模型"} onClose={() => { if (!busy) setPanel(null); }} onBeforeClose={() => !busy} onBack={panel?.view === "delete" ? { label: "返回编辑模型", onClick: () => setPanel({ ...panel, view: "edit" }) } : undefined} focusKey={panel ? `${panel.model.id}-${panel.view}` : "closed"} className="ai-model-overlay">
      {panel?.view === "edit" ? <form className="form-stack" onSubmit={completeModel} noValidate><fieldset className="ai-model-panel-fields" disabled={!online || busy}>
        <Field label="模型 ID" error={panelError} hint="填写服务商提供的完整模型 ID。"><Input data-overlay-initial-focus aria-label="模型 ID" value={panel.model.name} aria-invalid={Boolean(panelError)} autoComplete="off" onChange={(event) => { setPanel({ ...panel, model: { ...panel.model, name: event.target.value } }); setPanelError(undefined); }} /></Field>
        <AiSwitch label="支持图片识别" checked={panel.model.supportsImage} onChange={(value) => setPanel({ ...panel, model: { ...panel.model, supportsImage: value } })} />
        {panel.model.id === draft.defaultId ? <p className="ai-model-current">这是当前默认模型。修改 ID 后仍保持默认。</p> : panel.adding && !draft.models.length ? <p className="form-hint">首个模型将作为默认模型。</p> : null}
        <Button type="submit">完成</Button>
        {!panel.adding ? <button className="settings-text-button settings-text-button--danger" type="button" onClick={() => { if (deletingDefault || draft.models.length === 1) setPanel({ ...panel, view: "delete", replacement: "" }); else deleteModel(); }}>删除模型</button> : null}
        <p className="form-hint">完成后返回列表，保存设置后生效。</p>
      </fieldset></form> : panel ? <div className="form-stack">
        <p className="ai-model-delete-name">将从配置中移除 <strong>{draft.models.find((model) => model.id === panel.model.id)?.name}</strong>。</p>
        {others.length ? <Field label="新的默认模型"><Select data-overlay-initial-focus aria-label="新的默认模型" value={panel.replacement} disabled={!online || busy} onChange={(event) => setPanel({ ...panel, replacement: event.target.value })}><option value="">请选择替代模型</option>{others.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</Select></Field> : null}
        <p className="form-hint">{others.length ? "如果替代模型不支持图片识别，图片识别将同步关闭。" : "这是最后一个模型，删除后将关闭 AI 和图片识别。"}保存设置后生效。</p>
        <Button variant="danger" disabled={!online || busy || (others.length > 0 && !panel.replacement)} onClick={deleteModel}>{others.length ? "删除并替换默认模型" : "删除并关闭 AI"}</Button>
        <Button variant="secondary" onClick={() => setPanel({ ...panel, view: "edit" })}>取消</Button>
      </div> : null}
    </Overlay>
  </div>;
}
