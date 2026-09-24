import type { AiSettings, AiSettingsInput } from "./api";

export type ModelDraft = { id: string; name: string; supportsImage: boolean };
export type AiDraft = {
  enabled: boolean;
  baseUrl: string;
  models: ModelDraft[];
  defaultId: string | null;
  imageEnabled: boolean;
  maxImageMiB: string;
  timeoutSeconds: string;
  jsonMode: boolean;
  keyAction: "keep" | "replace" | "clear";
  apiKey: string;
};
export type DraftErrors = Partial<Record<"baseUrl" | "apiKey" | "models" | "defaultModel" | "maxImageMiB" | "timeoutSeconds", string>>;

/** 临时 ID 只关联当前页面中的模型和默认选择，不进入接口，重命名不会丢失默认身份。 */
export function createAiDraft(settings: AiSettings): AiDraft {
  const models = settings.models.map((model, index) => ({ ...model, id: `saved-${index}` }));
  return {
    enabled: settings.enabled, baseUrl: settings.baseUrl ?? "", models,
    defaultId: models.find((model) => model.name === settings.defaultModel)?.id ?? null,
    imageEnabled: settings.imageEnabled, maxImageMiB: String(settings.maxImageBytes / (1024 * 1024)),
    timeoutSeconds: String(settings.timeoutSeconds), jsonMode: settings.jsonMode,
    keyAction: "keep", apiKey: "",
  };
}

export function modelError(model: ModelDraft, models: ModelDraft[], adding: boolean): string | undefined {
  const name = model.name.trim();
  if (!name || Array.from(name).length > 128) return "模型 ID 需为 1–128 个字符。";
  if (models.some((item) => item.id !== model.id && item.name.trim() === name)) return "该模型 ID 已存在。";
  if (adding && models.length >= 32) return "最多可配置 32 个模型。";
  return undefined;
}

/** 前端仅解释可确定的输入错误；网络地址安全、密钥有效性与并发版本仍由服务端裁决。 */
export function validateAiDraft(draft: AiDraft, saved: AiSettings): DraftErrors {
  const errors: DraftErrors = {};
  const enabled = draft.enabled && draft.keyAction !== "clear";
  const baseUrl = draft.baseUrl.trim();
  if (!baseUrl && enabled) errors.baseUrl = "启用 AI 前请填写接口地址。";
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash
        || new TextEncoder().encode(baseUrl).length > 2048 || /(?:\/\.\.?\/|\/\.\.?$|%2e)/i.test(baseUrl)
        || url.pathname.replace(/\/+$/, "").endsWith("/chat/completions")) {
        errors.baseUrl = "请填写不含凭据、查询参数或 chat/completions 的 HTTP(S) 基础地址。";
      }
    } catch { errors.baseUrl = "请输入有效的 HTTP(S) 接口地址。"; }
  }
  if (draft.keyAction === "replace" && !draft.apiKey.trim()) errors.apiKey = "请输入新的 API 密钥，或取消更换。";
  if (enabled && draft.keyAction !== "replace" && saved.apiKeyStatus !== "CONFIGURED") errors.apiKey = "启用 AI 前请配置可用的 API 密钥。";
  if (draft.models.length > 32 || draft.models.some((model) => modelError(model, draft.models, false))) errors.models = "请检查模型 ID，最多 32 个且不能重复。";
  if (enabled && !draft.models.some((model) => model.id === draft.defaultId)) errors.defaultModel = "启用 AI 前请添加并选择默认模型。";
  const limit = Number(draft.maxImageMiB);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) errors.maxImageMiB = "图片大小上限必须是 1–10 MiB 的整数。";
  const timeout = Number(draft.timeoutSeconds);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) errors.timeoutSeconds = "请求超时必须是 1–120 秒的整数。";
  return errors;
}

/** 保留、更换、清除互斥；清除的关闭效果在界面与提交中一致，撤销清除可恢复原草稿开关。 */
export function aiDraftInput(draft: AiDraft, saved: AiSettings): AiSettingsInput {
  const enabled = draft.enabled && draft.keyAction !== "clear";
  const selected = draft.models.find((model) => model.id === draft.defaultId);
  return {
    enabled, baseUrl: draft.baseUrl.trim() || null,
    models: draft.models.map(({ name, supportsImage }) => ({ name: name.trim(), supportsImage })),
    defaultModel: selected?.name.trim() ?? null,
    imageEnabled: enabled && selected?.supportsImage === true && draft.imageEnabled,
    maxImageBytes: Number(draft.maxImageMiB) * 1024 * 1024,
    timeoutSeconds: Number(draft.timeoutSeconds), jsonMode: draft.jsonMode,
    version: saved.version, clearApiKey: draft.keyAction === "clear",
    ...(draft.keyAction === "replace" ? { apiKey: draft.apiKey.trim() } : {}),
  };
}
