import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { Button, Textarea } from "../../components/ui";
import { minorToInput, normalizeCurrency } from "../../domain-preview/money";
import type { ActivityMember } from "../activities/api";
import { createAiTextDraft, type AiExpenseDraft } from "./api";
import { categories } from "./shared";

export type AiFieldState = "AI_SUGGESTED" | "NEEDS_CONFIRMATION" | "MISSING" | "CONFLICT";
export type AiExpenseField = "title" | "amount" | "currency" | "occurredAt" | "category" | "note" | "payer" | "participants" | "split";

export type AiMemberSuggestionForEditor = {
  mention: string;
  matchStatus: string;
  memberId?: string;
  candidateMemberIds: string[];
  candidateNames: string[];
  amountMinor?: string;
  value?: string;
};

/**
 * 编辑器只接收这份已经过服务端成员边界和金额边界过滤的值。
 * Provider 原始 JSON、提示词、HTTP 状态和配置秘密不会进入这个类型。
 */
export type AiExpenseEditorInitialValues = {
  title?: string;
  amountMinor?: string;
  currency?: string;
  occurredAt?: string;
  category?: (typeof categories)[number][0];
  note?: string;
  payerMode?: "single" | "multiple";
  payerIds?: string[];
  paymentValues?: Record<string, string>;
  participantIds?: string[];
  splitMode?: "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT";
  splitValues?: Record<string, string>;
  fieldStates: Partial<Record<AiExpenseField, AiFieldState>>;
  memberSuggestions: AiMemberSuggestionForEditor[];
  warnings: string[];
  incompleteFields: string[];
};

/** 用户编辑某个区域后移除该区域的 AI 来源状态，避免继续把用户值标成模型建议。 */
export function dismissAiFieldState(
  states: Partial<Record<AiExpenseField, AiFieldState>>,
  field: AiExpenseField,
): Partial<Record<AiExpenseField, AiFieldState>> {
  if (!(field in states)) return states;
  const next = { ...states };
  delete next[field];
  return next;
}

type AiMemberSuggestion = components["schemas"]["AiExpenseDraftMemberSuggestion"];
type AiSplitParticipant = components["schemas"]["AiSplitParticipantData"];
type AiSplitSuggestion = components["schemas"]["AiSplitSuggestionData"];

function activeMemberMap(members: readonly ActivityMember[]) {
  return new Map(members.filter((member) => member.status === "ACTIVE").map((member) => [member.memberId, member]));
}

function safeMemberSuggestion(suggestion: AiMemberSuggestion | AiSplitParticipant, membersById: ReadonlyMap<string, ActivityMember>): AiMemberSuggestionForEditor {
  const candidateMemberIds = suggestion.candidateMemberIds.filter((id) => membersById.has(id));
  const memberId = suggestion.matchStatus === "MATCHED" && suggestion.memberId && membersById.has(suggestion.memberId)
    ? suggestion.memberId
    : undefined;
  const candidateNames = candidateMemberIds.flatMap((id) => {
    const member = membersById.get(id);
    return member ? [member.displayName] : [];
  });
  return {
    mention: suggestion.mention,
    matchStatus: memberId ? "MATCHED" : suggestion.matchStatus === "AMBIGUOUS" ? "AMBIGUOUS" : "UNMATCHED",
    memberId,
    candidateMemberIds,
    candidateNames,
    amountMinor: "amount" in suggestion ? suggestion.amount?.amountMinor : undefined,
    value: "value" in suggestion && typeof suggestion.value === "string" ? suggestion.value : undefined,
  };
}

function categoryFromSuggestion(value: string | null | undefined): AiExpenseEditorInitialValues["category"] {
  const normalized = value?.trim().toUpperCase();
  const byCode = categories.find(([code]) => code === normalized)?.[0];
  if (byCode) return byCode;
  const byLabel = categories.find(([, label]) => label === value?.trim())?.[0];
  return byLabel;
}

function safeMinor(value: string | undefined): string | undefined {
  return value && /^(0|[1-9]\d*)$/.test(value) ? value : undefined;
}

function splitSuggestions(
  split: AiSplitSuggestion | null | undefined,
  membersById: ReadonlyMap<string, ActivityMember>,
  currency: string,
  warnings: string[],
): { participantIds?: string[]; splitMode?: AiExpenseEditorInitialValues["splitMode"]; splitValues?: Record<string, string> } {
  if (!split || !["EQUAL", "EXACT", "PERCENTAGE", "WEIGHT"].includes(split.mode)) return {};
  const participants = split.participants.map((item) => safeMemberSuggestion(item, membersById));
  const participantIds = [...new Set(participants.flatMap((item) => item.memberId ? [item.memberId] : []))];
  if (participantIds.length !== participants.length || participantIds.length === 0) {
    warnings.push("分摊成员未能全部确认，请在分摊设置中手动选择。");
  }
  const splitValues: Record<string, string> = {};
  let valuesComplete = split.mode === "EQUAL";
  for (const participant of participants) {
    if (!participant.memberId || participant.value === undefined) {
      if (split.mode !== "EQUAL") valuesComplete = false;
      continue;
    }
    if (split.mode === "EXACT") {
      const amountMinor = safeMinor(participant.value);
      if (!amountMinor) {
        valuesComplete = false;
        continue;
      }
      splitValues[participant.memberId] = minorToInput(amountMinor, currency);
    } else if (split.mode === "PERCENTAGE" || split.mode === "WEIGHT") {
      const value = participant.value;
      if (!value || !/^(0|[1-9]\d*)$/.test(value)) {
        valuesComplete = false;
        continue;
      }
      splitValues[participant.memberId] = value;
    }
  }
  if (split.mode !== "EQUAL" && !valuesComplete) warnings.push("分摊信息不完整，请在现有分摊编辑器中确认。");
  return {
    participantIds: participantIds.length ? participantIds : undefined,
    splitMode: split.mode as AiExpenseEditorInitialValues["splitMode"],
    splitValues: Object.keys(splitValues).length ? splitValues : undefined,
  };
}

/** 将 AI DTO 转为编辑器初始值；所有 ID 都必须来自当前活动的 ACTIVE 成员集合。 */
export function normalizeAiDraftForEditor(
  draft: AiExpenseDraft,
  members: readonly ActivityMember[],
  baseCurrency: string,
): AiExpenseEditorInitialValues {
  const membersById = activeMemberMap(members);
  const warnings = draft.warnings.map((warning) => warning.message);
  const suggestions = draft.payerSuggestions.map((suggestion) => safeMemberSuggestion(suggestion, membersById));
  const splitParticipants = draft.splitSuggestion?.participants.map((item) => safeMemberSuggestion(item, membersById)) ?? [];
  const memberSuggestions = [...suggestions, ...splitParticipants.filter((item) => !suggestions.some((existing) => existing.mention === item.mention))];
  for (const suggestion of memberSuggestions) {
    if (suggestion.matchStatus === "AMBIGUOUS") {
      warnings.push(suggestion.candidateNames.length
        ? `存在多位名为“${suggestion.mention}”的成员（${suggestion.candidateNames.join("、")}），请手动选择。`
        : `成员“${suggestion.mention}”需要手动确认。`);
    } else if (suggestion.matchStatus === "UNMATCHED") {
      warnings.push(`未找到成员“${suggestion.mention}”，请手动选择。`);
    }
  }

  const amountMinor = safeMinor(draft.amount?.amountMinor);
  if (draft.amount && !amountMinor) warnings.push("账单金额格式无效，请手动填写。");
  let currency: string | undefined;
  if (draft.amount?.currency) {
    try {
      currency = normalizeCurrency(draft.amount.currency);
    } catch {
      warnings.push("未识别币种，请手动选择。");
    }
  }
  const amount = amountMinor && currency ? { amountMinor, currency } : undefined;
  const payerMatches = suggestions.filter((suggestion) => suggestion.memberId);
  const payerIds = [...new Set(payerMatches.flatMap((suggestion) => suggestion.memberId ? [suggestion.memberId] : []))];
  const paymentValues: Record<string, string> = {};
  for (const suggestion of payerMatches) {
    const value = safeMinor(suggestion.amountMinor);
    if (suggestion.memberId && value) paymentValues[suggestion.memberId] = minorToInput(value, currency ?? baseCurrency);
  }
  if (payerIds.length > 1) {
    const expected = amount?.amountMinor;
    const paymentTotal = payerMatches.reduce((sum, suggestion) => {
      const value = safeMinor(suggestion.amountMinor);
      return sum + (value ? BigInt(value) : 0n);
    }, 0n);
    if (Object.keys(paymentValues).length !== payerIds.length || !expected || paymentTotal !== BigInt(expected)) {
      warnings.push("付款金额尚未平衡，请在付款人设置中确认。");
    }
  } else if (payerIds.length === 1 && amount?.amountMinor) {
    const suggestedAmount = safeMinor(payerMatches[0]?.amountMinor);
    if (suggestedAmount && suggestedAmount !== amount.amountMinor) warnings.push("付款金额尚未平衡，请在付款人设置中确认。");
  }

  const split = splitSuggestions(draft.splitSuggestion, membersById, currency ?? baseCurrency, warnings);
  const note = [draft.note?.trim(), draft.location?.trim() ? `地点：${draft.location.trim()}` : undefined].filter(Boolean).join("\n") || undefined;
  const fieldStates: AiExpenseEditorInitialValues["fieldStates"] = {
    title: draft.title || draft.merchant ? "AI_SUGGESTED" : "MISSING",
    amount: amount ? "AI_SUGGESTED" : "MISSING",
    currency: currency ? "AI_SUGGESTED" : "MISSING",
    occurredAt: draft.occurredAt ? "AI_SUGGESTED" : "MISSING",
    category: categoryFromSuggestion(draft.categorySuggestion) ? "AI_SUGGESTED" : "MISSING",
    note: note ? "AI_SUGGESTED" : undefined,
    payer: payerIds.length && !warnings.includes("付款金额尚未平衡，请在付款人设置中确认。") ? "AI_SUGGESTED" : "NEEDS_CONFIRMATION",
    participants: split.participantIds?.length ? "AI_SUGGESTED" : "NEEDS_CONFIRMATION",
    split: split.splitMode ? (split.splitValues || split.splitMode === "EQUAL" ? "AI_SUGGESTED" : "NEEDS_CONFIRMATION") : "NEEDS_CONFIRMATION",
  };
  for (const field of draft.incompleteFields) {
    if (field in fieldStates) fieldStates[field as keyof typeof fieldStates] = "MISSING";
  }
  return {
    title: draft.title?.trim() || draft.merchant?.trim() || undefined,
    amountMinor,
    currency,
    occurredAt: draft.occurredAt ?? undefined,
    category: categoryFromSuggestion(draft.categorySuggestion),
    note,
    payerMode: payerIds.length > 1 ? "multiple" : payerIds.length === 1 ? "single" : undefined,
    payerIds: payerIds.length ? payerIds : undefined,
    paymentValues: Object.keys(paymentValues).length ? paymentValues : undefined,
    participantIds: split.participantIds,
    splitMode: split.splitMode,
    splitValues: split.splitValues,
    fieldStates,
    memberSuggestions,
    warnings: [...new Set(warnings)],
    incompleteFields: draft.incompleteFields,
  };
}

type AiExpenseEntryProps = {
  activityId: string;
  members: readonly ActivityMember[];
  baseCurrency: string;
  onDraft: (draft: AiExpenseEditorInitialValues) => void;
  onManual: () => void;
};

type RequestState = "IDLE" | "SUBMITTING" | "SUCCESS" | "ERROR" | "CANCELLED";

function aiErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 429) return error.retryAfterSeconds ? `请求过于频繁，请 ${error.retryAfterSeconds} 秒后重试。` : "请求过于频繁，请稍后重试。";
    if (error.status === 403) return "当前账号没有使用智能录入的权限。";
    if (error.status === 502 || error.status === 503 || error.status === 504) return "智能录入服务暂不可用，请稍后重试。";
    if (error.status === 413) return "账单描述过长，请缩短后重试。";
    return "智能录入失败，请检查输入后重试。";
  }
  if (error instanceof DOMException && error.name === "AbortError") return "请求已取消。";
  return "智能录入失败，请检查网络后重试。";
}

/** 文字识别只在当前组件内保存输入、确认和取消状态，不进入持久化缓存或离线队列。 */
export function AiExpenseEntry({ activityId, members, baseCurrency, onDraft, onManual }: AiExpenseEntryProps) {
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<RequestState>("IDLE");
  const [error, setError] = useState<string>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const requestIdRef = useRef(0);

  useEffect(() => () => {
    controllerRef.current?.abort();
    requestIdRef.current += 1;
  }, [activityId]);

  function cancel() {
    if (state !== "SUBMITTING") return;
    controllerRef.current?.abort();
    requestIdRef.current += 1;
    controllerRef.current = undefined;
    setState("CANCELLED");
  }

  async function submit() {
    if (state === "SUBMITTING") return;
    if (!confirmed) { setError("请先确认账单描述会发送至管理员配置的 AI 服务。 "); setState("ERROR"); return; }
    const value = text.trim();
    if (!value) { setError("请先填写账单描述。"); setState("ERROR"); return; }
    const controller = new AbortController();
    controllerRef.current = controller;
    const requestId = ++requestIdRef.current;
    setError(undefined);
    setState("SUBMITTING");
    try {
      const response = await createAiTextDraft(activityId, value, controller.signal);
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      const normalized = normalizeAiDraftForEditor(response, members, baseCurrency);
      setState("SUCCESS");
      onDraft(normalized);
    } catch (reason) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setError(aiErrorMessage(reason));
      setState(reason instanceof DOMException && reason.name === "AbortError" ? "CANCELLED" : "ERROR");
    } finally {
      if (requestId === requestIdRef.current) controllerRef.current = undefined;
    }
  }

  return (
    <section className="ai-expense-entry" aria-labelledby="ai-expense-entry-title">
      <header className="ai-expense-entry__header">
        <Sparkles aria-hidden="true" size={22} />
        <div><h2 id="ai-expense-entry-title">智能录入</h2><p>描述账单，生成可修改的账单草稿。</p></div>
      </header>
      <p className="ai-expense-entry__privacy">账单描述将发送至管理员配置的 AI 服务进行识别。识别结果仅作为草稿，保存前可修改。</p>
      <label className="field" htmlFor="ai-expense-description">
        <span className="field__label">账单描述</span>
        <Textarea id="ai-expense-description" aria-label="账单描述" value={text} onChange={(event) => setText(event.target.value)} rows={6} maxLength={4000} placeholder="例如：昨晚居酒屋消费 12800 日元，我先付，林樾、小王和小李三个人平均分摊。" aria-describedby="ai-expense-example" disabled={state === "SUBMITTING"} />
        <span id="ai-expense-example" className="field__hint">可以写金额、币种、付款人和参与成员；不确定的信息会留给你确认。</span>
      </label>
      <label className="ai-expense-entry__confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={state === "SUBMITTING"} /><span>我确认将账单描述发送至已配置的 AI 服务。</span></label>
      {error ? <div className="ai-expense-entry__error" role="alert">{error}</div> : null}
      {state === "CANCELLED" ? <div className="ai-expense-entry__status" role="status">请求已取消，输入内容仍保留。</div> : null}
      {state === "SUCCESS" ? <div className="ai-expense-entry__status" role="status">草稿已生成，正在打开编辑器。</div> : null}
      <div className="ai-expense-entry__actions">
        <Button type="button" variant="ghost" onClick={onManual} disabled={state === "SUBMITTING"}>手动填写</Button>
        {state === "SUBMITTING" ? <Button type="button" variant="secondary" onClick={cancel} aria-label="取消智能录入">取消</Button> : <Button type="button" onClick={() => void submit()} busy={false} disabled={!text.trim()} aria-busy={false}>{state === "ERROR" || state === "CANCELLED" ? "重新生成草稿" : "生成账单草稿"}</Button>}
      </div>
    </section>
  );
}

export function aiSuggestionLabel(state: AiFieldState | undefined): string | null {
  switch (state) {
    case "AI_SUGGESTED": return "AI 建议";
    case "NEEDS_CONFIRMATION": return "需要确认";
    case "MISSING": return "未识别";
    case "CONFLICT": return "存在冲突";
    default: return null;
  }
}
