import { ArrowLeft, Check, ChevronRight, ImagePlus, Info, Minus, Plus, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiRequestError } from "../../api/error";
import { MemberAvatar } from "../../components/member-avatar";
import { Overlay } from "../../components/overlay";
import { Button, ConfirmDialog, ErrorNotice, Field, Input, LoadingState, Money, Textarea } from "../../components/ui";
import { amountToMinor, decimalToHundredths, formatMoney, minorToInput, normalizeCurrency } from "../../domain-preview/money";
import type { PendingAttachmentDraft } from "../../pwa/indexed-db/schema";
import { type ActivityMember, useCreateGuestMutation, useMembersQuery } from "../activities/api";
import { useWorkspace } from "../activities/workspace-context";
import {
  type ExpenseAggregate,
  type ExpenseDraft,
  useCreateExpenseMutation,
  useDeleteAttachmentMutation,
  useDeleteExpenseMutation,
  useExchangeRateSuggestionMutation,
  useExpenseQuery,
  useReviseRejectedExpenseMutation,
  useUpdateExpenseMutation
} from "./api";

import { attachmentAccept, ExpenseAttachments, SelectedAttachmentPreviews, validateAttachments } from "./expense-attachments";

import { categories, memberAvatarPreset, memberName, parentQuickExpenseView, type PendingExpenseDraft, quickExpenseBackLabel, quickExpenseMobileSheet, quickExpenseOverlayClass, type QuickExpenseView, quickExpenseViewTitle } from "./shared";
const splitModes = [
  ["EQUAL", "均摊"], ["EXACT", "按金额"], ["PERCENTAGE", "按比例"], ["WEIGHT", "按权重"],
] as const;
const quickSplitModes = [
  ["EQUAL", "均摊"], ["EXACT", "按金额"], ["PERCENTAGE", "按比例"], ["WEIGHT", "按份数"],
] as const;

const commonCurrencyCodes = ["CNY", "USD", "JPY", "SGD"] as const;
const currencyCodes = `
AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XOF XPF YER ZAR ZMW ZWG
`.trim().split(/\s+/);
const currencyNames = new Intl.DisplayNames("zh-CN", { type: "currency", fallback: "code" });
const currencyNameOverrides: Record<string, string> = { AUD: "澳元", CNY: "人民币", EUR: "欧元", GBP: "英镑", JPY: "日元", SGD: "新加坡元", USD: "美元" };

function currencyDisplayName(code: string): string {
  return currencyNameOverrides[code] ?? currencyNames.of(code) ?? code;
}

function localDateTime(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function quickTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "请选择";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? `今天 ${time}`
    : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT";
type SelectedLocalAttachment = PendingAttachmentDraft & { file: File };

type PayerMode = "single" | "multiple";
type ExpenseEditorProps = {
  initial?: ExpenseAggregate;
  rejected?: PendingExpenseDraft;
  onSaved?: () => void;
};

function RoutedExpenseEditor(props: ExpenseEditorProps) {
  const [view, setView] = useState<QuickExpenseView>("entry");
  const rootTitle = props.initial ? "修改账单" : props.rejected ? "修改被拒账单" : "记一笔";
  const title = view === "entry" ? rootTitle : quickExpenseViewTitle(view);
  return (
    <section className="routed-expense-editor" aria-labelledby="routed-expense-editor-title">
      <header className="routed-expense-editor__header">
        {view !== "entry" ? <button className="icon-button" type="button" aria-label={`返回${quickExpenseBackLabel(view, rootTitle)}`} onClick={() => setView(parentQuickExpenseView(view))}><ArrowLeft aria-hidden="true" size={20} /></button> : <span aria-hidden="true" />}
        <h2 id="routed-expense-editor-title">{title}</h2>
        <span aria-hidden="true" />
      </header>
      <div className="routed-expense-editor__body">
        <UnifiedExpenseEditor {...props} view={view} onViewChange={setView} />
      </div>
    </section>
  );
}

/**
 * 流水内编辑保留列表、筛选与滚动上下文；独立深链仍由 ExpenseDetailPage 承担。
 * Sheet 内部只切换编辑器子视图，URL 仅表示整个修改任务是否打开。
 */
export function ExpenseEditOverlay({ expenseId, onClose }: { expenseId: string; onClose: () => void }) {
  const { session, activity } = useWorkspace();
  const expense = useExpenseQuery(session.userId, activity.activityId, expenseId);
  const remove = useDeleteExpenseMutation(session.userId, activity.activityId, expenseId);
  const [view, setView] = useState<QuickExpenseView>("entry");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const title = view === "entry" ? "修改账单" : quickExpenseViewTitle(view);

  useEffect(() => {
    setView("entry");
    setDeleteOpen(false);
  }, [expenseId]);

  async function confirmDelete() {
    if (!expense.data) return;
    try {
      await remove.mutateAsync(expense.data.expense.version);
      setDeleteOpen(false);
      onClose();
    } catch {
      // 删除错误留在当前 Sheet 中展示，避免关闭后丢失可重试入口。
    }
  }

  const deleteAction = view === "entry" && expense.data ? (
    <button className="icon-button expense-editor-delete" type="button" aria-label="删除账单" title="删除账单" onClick={() => setDeleteOpen(true)}>
      <Trash2 aria-hidden="true" size={19} />
    </button>
  ) : undefined;

  return (
    <Overlay
      open
      title={title}
      onBack={view === "entry" ? undefined : { label: quickExpenseBackLabel(view, "修改账单"), onClick: () => setView(parentQuickExpenseView(view)) }}
      leadingAction={deleteAction}
      focusKey={`${expenseId}-${view}`}
      initialFocus="mobile-dialog"
      mobileSheet={quickExpenseMobileSheet(view)}
      onClose={onClose}
      className={quickExpenseOverlayClass(view)}
    >
      {expense.isPending ? <LoadingState label="正在读取账单…" /> : null}
      {expense.error ? <ErrorNotice error={expense.error} /> : null}
      {remove.error ? <ErrorNotice error={remove.error} /> : null}
      {expense.data ? <UnifiedExpenseEditor initial={expense.data} view={view} onViewChange={setView} onSaved={onClose} /> : null}
      <ConfirmDialog open={deleteOpen} title="删除账单" message="删除后账本会立即重新计算，这笔账单无法恢复。确定继续吗？" confirmLabel="确认删除" busy={remove.isPending} onConfirm={() => void confirmDelete()} onCancel={() => setDeleteOpen(false)} />
    </Overlay>
  );
}

type QuickSplitAllocation = { memberId: string; amountMinor: bigint };
type QuickSplitPreview = { allocations: QuickSplitAllocation[]; allocatedMinor: bigint; valid: boolean; error?: string };

function quickAllocate(totalMinor: bigint, weights: readonly { memberId: string; weight: bigint }[]): QuickSplitAllocation[] {
  const sorted = [...weights].sort((left, right) => left.memberId < right.memberId ? -1 : left.memberId > right.memberId ? 1 : 0);
  const totalWeight = sorted.reduce((sum, row) => sum + row.weight, 0n);
  const result = sorted.map((row) => ({ memberId: row.memberId, amountMinor: (totalMinor * row.weight) / totalWeight }));
  let remainder = totalMinor - result.reduce((sum, row) => sum + row.amountMinor, 0n);
  for (const row of result) {
    if (remainder === 0n) break;
    row.amountMinor += 1n;
    remainder -= 1n;
  }
  return result;
}

function formatHundredths(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

/** 快捷记账只在展示层预览分摊，最终金额仍由 Rust 领域层再次校验。 */
function previewQuickSplit(totalMinor: bigint | null, currency: string, memberIds: readonly string[], mode: SplitMode, values: Readonly<Record<string, string>>): QuickSplitPreview {
  if (totalMinor === null) return { allocations: [], allocatedMinor: 0n, valid: false, error: "先填写账单金额" };
  if (memberIds.length === 0) return { allocations: [], allocatedMinor: 0n, valid: false, error: "至少选择一名参与成员" };
  if (new Set(memberIds).size !== memberIds.length) return { allocations: [], allocatedMinor: 0n, valid: false, error: "参与成员不能重复" };
  try {
    if (mode === "EQUAL") {
      const allocations = quickAllocate(totalMinor, memberIds.map((memberId) => ({ memberId, weight: 1n })));
      return { allocations, allocatedMinor: totalMinor, valid: true };
    }
    if (mode === "EXACT") {
      const allocations = memberIds.map((memberId) => ({ memberId, amountMinor: BigInt(amountToMinor(values[memberId] ?? "", currency)) }));
      const allocatedMinor = allocations.reduce((sum, row) => sum + row.amountMinor, 0n);
      return allocatedMinor === totalMinor
        ? { allocations: [...allocations].sort((left, right) => left.memberId < right.memberId ? -1 : 1), allocatedMinor, valid: true }
        : { allocations, allocatedMinor, valid: false, error: "指定金额合计必须等于消费总额" };
    }
    const weights = memberIds.map((memberId) => ({ memberId, weight: BigInt(decimalToHundredths(values[memberId] ?? "", mode === "PERCENTAGE" ? "比例" : "份数")) }));
    if (weights.some((row) => row.weight <= 0n)) return { allocations: [], allocatedMinor: 0n, valid: false, error: "分摊值必须大于零" };
    const weightTotal = weights.reduce((sum, row) => sum + row.weight, 0n);
    if (mode === "PERCENTAGE" && weightTotal !== 10_000n) return { allocations: [], allocatedMinor: 0n, valid: false, error: "比例合计必须等于 100%" };
    const allocations = quickAllocate(totalMinor, weights);
    return { allocations, allocatedMinor: allocations.reduce((sum, row) => sum + row.amountMinor, 0n), valid: true };
  } catch (error) {
    return { allocations: [], allocatedMinor: 0n, valid: false, error: error instanceof Error ? error.message : "分摊信息不完整" };
  }
}

function quickSplitProgress(currency: string, memberIds: readonly string[], mode: Exclude<SplitMode, "EQUAL">, values: Readonly<Record<string, string>>): bigint | null {
  try {
    return memberIds.reduce((sum, memberId) => {
      const value = (values[memberId] ?? "").trim();
      if (!value) return sum;
      const units = mode === "EXACT" ? amountToMinor(value, currency) : decimalToHundredths(value, mode === "PERCENTAGE" ? "比例" : "份数");
      return sum + BigInt(units);
    }, 0n);
  } catch {
    return null;
  }
}

function QuickSplitSummary({ currency, memberIds, mode, values, totalMinor }: {
  currency: string;
  memberIds: readonly string[];
  mode: SplitMode;
  values: Readonly<Record<string, string>>;
  totalMinor: bigint | null;
}) {
  const totalLabel = totalMinor === null ? "待填写金额" : formatMoney(currency, totalMinor.toString());
  if (mode === "EQUAL") {
    const average = totalMinor !== null && memberIds.length ? formatMoney(currency, (totalMinor / BigInt(memberIds.length)).toString()) : "待完成";
    return <><p><span>合计</span><strong>{totalLabel}</strong></p><p><span>人均</span><strong>{average}</strong></p></>;
  }
  const progress = quickSplitProgress(currency, memberIds, mode, values);
  if (mode === "EXACT") {
    return <p><span>已分配{" "}</span><strong>{progress === null ? "待完成" : `${formatMoney(currency, progress.toString())} / ${totalLabel}`}</strong></p>;
  }
  const progressLabel = mode === "PERCENTAGE" ? "已分配" : "总份数";
  const progressText = progress === null ? "待完成" : `${formatHundredths(progress)}${mode === "PERCENTAGE" ? "%" : ""}`;
  return <><p><span>{progressLabel}</span><strong>{progressText}</strong></p><p><span>合计</span><strong>{totalLabel}</strong></p></>;
}

type PayerSelection =
  | { readonly mode: "single"; readonly memberId: string }
  | { readonly mode: "multiple"; readonly memberIds: readonly string[]; readonly amountInputs: Readonly<Record<string, string>> };
type QuickPayerResolution = { payments: Array<{ memberId: string; amountMinor: string }> | null; allocatedMinor: bigint; error?: string };

function resolveQuickPayers(selection: PayerSelection, totalMinor: bigint | null, currency: string): QuickPayerResolution {
  if (selection.mode === "single") {
    if (!selection.memberId) return { payments: null, allocatedMinor: 0n, error: "请选择付款人" };
    if (totalMinor === null) return { payments: null, allocatedMinor: 0n, error: "请先填写账单金额" };
    return { payments: [{ memberId: selection.memberId, amountMinor: totalMinor.toString() }], allocatedMinor: totalMinor };
  }
  if (totalMinor === null) return { payments: null, allocatedMinor: 0n, error: "先填写账单金额，再分配多人付款金额" };
  if (selection.memberIds.length === 0) return { payments: null, allocatedMinor: 0n, error: "至少选择一名付款人" };
  try {
    const payments = selection.memberIds.map((memberId) => ({ memberId, amountMinor: amountToMinor(selection.amountInputs[memberId] ?? "", currency) }));
    const allocatedMinor = payments.reduce((sum, payment) => sum + BigInt(payment.amountMinor), 0n);
    return allocatedMinor === totalMinor
      ? { payments, allocatedMinor }
      : { payments: null, allocatedMinor, error: "付款合计必须等于消费金额" };
  } catch (error) {
    return { payments: null, allocatedMinor: 0n, error: error instanceof Error ? error.message : "付款金额格式不正确" };
  }
}

function QuickFieldButton({ label, value, children, onClick, initialFocus = false }: { label: string; value: string; children?: ReactNode; onClick: () => void; initialFocus?: boolean }) {
  return (
    <button type="button" className="quick-expense-field-button" aria-label={`${label}：${value}`} aria-haspopup="dialog" data-overlay-initial-focus={initialFocus ? "true" : undefined} onClick={onClick}>
      <span className="quick-expense-field-button__label">{label}</span>
      <span className="quick-expense-field-button__value">
        {children}
        <span>{value}</span>
        <ChevronRight aria-hidden="true" size={17} />
      </span>
    </button>
  );
}

function QuickValueButton({ label, value, children, onClick, initialFocus = false }: { label: string; value: string; children?: ReactNode; onClick: () => void; initialFocus?: boolean }) {
  return (
    <button type="button" className="quick-expense-value-button" aria-label={`${label}：${value}`} aria-haspopup="dialog" data-overlay-initial-focus={initialFocus ? "true" : undefined} onClick={onClick}>
      <span className="quick-expense-value-button__content">
        {children}
        <span>{value}</span>
        <ChevronRight aria-hidden="true" size={15} />
      </span>
    </button>
  );
}

/** 保留远程版时间单元格的视觉层级，由覆盖整格的原生输入直接唤起系统选择器。 */
function QuickTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="quick-expense-time-picker">
      <span className="quick-expense-field-button__label" aria-hidden="true">时间</span>
      <span className="quick-expense-field-button__value" aria-hidden="true">
        <span>{quickTimeLabel(value)}</span>
        <ChevronRight size={17} />
      </span>
      <input className="quick-expense-time-picker__input" aria-label="时间" type="datetime-local" value={value} required onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** 账单编辑器各层级共用底部主操作，状态文字始终位于按钮上方。 */
function QuickExpenseActionDock({ children, status }: { children: ReactNode; status?: ReactNode }) {
  return (
    <div className={`quick-expense-action-dock${status ? " quick-expense-action-dock--with-status" : ""}`}>
      {status ? <p aria-live="polite">{status}</p> : null}
      {children}
    </div>
  );
}

function parseQuickWeight(value: string): bigint | null {
  try {
    return BigInt(decimalToHundredths(value.trim() || "0", "份数"));
  } catch {
    return null;
  }
}

function formatQuickWeight(value: bigint): string {
  return value % 100n === 0n ? (value / 100n).toString() : formatHundredths(value);
}

/** 步进按钮使用整数份递增，但保留手动输入两位小数份数的现有能力。 */
function QuickWeightStepper({ name, value, onChange }: { name: string; value: string; onChange: (value: string) => void }) {
  const parsed = parseQuickWeight(value);
  const update = (delta: bigint) => {
    if (parsed === null) return;
    const next = parsed + delta;
    if (next <= 0n) return;
    onChange(formatQuickWeight(next));
  };
  return (
    <div className="quick-weight-stepper" role="group" aria-label={`${name}份数`}>
      <button type="button" aria-label={`减少${name}的份数`} disabled={parsed === null || parsed <= 100n} onClick={() => update(-100n)}><Minus aria-hidden="true" size={17} /></button>
      <Input inputMode="decimal" aria-label={`${name}按份数`} value={value} placeholder="份数" onChange={(event) => onChange(event.target.value)} />
      <button type="button" aria-label={`增加${name}的份数`} disabled={parsed === null} onClick={() => update(100n)}><Plus aria-hidden="true" size={17} /></button>
    </div>
  );
}

function QuickMemberChoiceList({ members, mode, selectedIds, onToggle, paymentValues, onPaymentChange, canAddGuest, online, onAddGuest }: {
  members: readonly ActivityMember[];
  mode: PayerMode;
  selectedIds: readonly string[];
  onToggle: (memberId: string) => void;
  paymentValues?: Readonly<Record<string, string>>;
  onPaymentChange?: (memberId: string, value: string) => void;
  canAddGuest: boolean;
  online: boolean;
  onAddGuest: () => void;
}) {
  return (
    <div className="quick-member-picker">
      <div className="quick-member-list" role={mode === "single" ? "radiogroup" : "group"} aria-label={mode === "single" ? "付款人" : "选择成员"}>
        {members.map((member) => {
          const selected = selectedIds.includes(member.memberId);
          return (
            <div className={`quick-member-row${paymentValues && selected ? " quick-member-row--with-input" : ""}`} key={member.memberId}>
              <button type="button" role={mode === "single" ? "radio" : "checkbox"} aria-checked={selected} aria-label={member.displayName} className="quick-member-row__button" onClick={() => onToggle(member.memberId)}>
                <MemberAvatar memberId={member.memberId} displayName={member.displayName} avatarPreset={member.avatarPreset} size="md" />
                <span>{member.displayName}</span>
                <span aria-hidden="true" className={`quick-member-row__check${selected ? " quick-member-row__check--selected" : ""}`}>{selected ? <Check size={15} /> : null}</span>
              </button>
              {paymentValues && selected ? <Input inputMode="decimal" aria-label={`${member.displayName}付款金额`} value={paymentValues[member.memberId] ?? ""} disabled={!onPaymentChange} onChange={(event) => onPaymentChange?.(member.memberId, event.target.value)} /> : null}
            </div>
          );
        })}
      </div>
      {canAddGuest ? <div className="quick-member-picker__guest"><Button type="button" variant="ghost" className="quick-member-picker__guest-button" disabled={!online} onClick={onAddGuest}><Plus aria-hidden="true" size={18} /> 添加临时成员</Button>{!online ? <small>当前离线，联网后可添加</small> : null}</div> : null}
    </div>
  );
}

/**
 * 所有可写账单入口共用这一套编辑器。外层只决定它展示在 Sheet 还是路由页，
 * 字段顺序、子视图、校验和提交语义保持一致，避免同一笔账在不同入口表现不同。
 */
export function UnifiedExpenseEditor({ initial, rejected, view, onViewChange, onSaved }: ExpenseEditorProps & { view: QuickExpenseView; onViewChange: (view: QuickExpenseView) => void }) {
  const { session, activity, members: cachedMembers, offline } = useWorkspace();
  const members = useMembersQuery(session.userId, activity.activityId, !offline);
  const navigate = useNavigate();
  const create = useCreateExpenseMutation(session.userId, activity.activityId);
  const reviseRejected = useReviseRejectedExpenseMutation(session.userId);
  const update = useUpdateExpenseMutation(session.userId, activity.activityId, initial?.expense.expenseId ?? "");
  const deleteAttachment = useDeleteAttachmentMutation(session.userId, activity.activityId, initial?.expense.expenseId ?? "");
  const createGuest = useCreateGuestMutation(session.userId, activity.activityId);
  const rateSuggestion = useExchangeRateSuggestionMutation(activity.activityId);
  const pendingPayload = rejected?.payload;
  const initialPayload = initial?.expense;
  const initialPayments = initial?.payments ?? [];
  const initialParticipants = initial?.shares.map((share) => share.memberId)
    ?? pendingPayload?.split.members
    ?? pendingPayload?.split.entries?.map((entry) => entry.memberId)
    ?? [];
  const initialPaymentIds = initial
    ? initialPayments.map((payment) => payment.memberId)
    : pendingPayload?.payments.map((payment) => payment.memberId) ?? [];
  const initialPaymentValues = Object.fromEntries(
    initial ? initial.payments.map((payment) => [payment.memberId, minorToInput(payment.originalAmountMinor, initial.expense.originalCurrency)])
      : pendingPayload?.payments.map((payment) => [payment.memberId, minorToInput(payment.amountMinor, pendingPayload.originalCurrency)]) ?? [],
  );
  const [createdMembers, setCreatedMembers] = useState<ActivityMember[]>([]);
  const [initialized, setInitialized] = useState(Boolean(initial || rejected));
  const [amount, setAmount] = useState(() => initialPayload
    ? minorToInput(initialPayload.originalAmountMinor, initialPayload.originalCurrency)
    : pendingPayload ? minorToInput(pendingPayload.originalAmountMinor, pendingPayload.originalCurrency) : "");
  const [title, setTitle] = useState(initialPayload?.title ?? pendingPayload?.title ?? "");
  const [category, setCategory] = useState<(typeof categories)[number][0]>((initialPayload?.category ?? pendingPayload?.category ?? "FOOD") as (typeof categories)[number][0]);
  const [currency, setCurrency] = useState(initialPayload?.originalCurrency ?? pendingPayload?.originalCurrency ?? activity.baseCurrency);
  const [currencySearchDraft, setCurrencySearchDraft] = useState("");
  const [occurredAt, setOccurredAt] = useState(localDateTime(initialPayload?.occurredAt ?? pendingPayload?.occurredAt));
  const [note, setNote] = useState(initialPayload?.note ?? pendingPayload?.note ?? "");
  const [exchangeRate, setExchangeRate] = useState(initialPayload?.exchangeRate ?? pendingPayload?.exchangeRate ?? (activity.baseCurrency ? "1" : ""));
  const [exchangeRateKind, setExchangeRateKind] = useState(initialPayload?.exchangeRateKind ?? pendingPayload?.exchangeRateKind ?? "IDENTITY");
  const [exchangeRateReferenceDate, setExchangeRateReferenceDate] = useState<string | null>(initialPayload?.exchangeRateReferenceDate ?? pendingPayload?.exchangeRateReferenceDate ?? null);
  const [exchangeRateProvider, setExchangeRateProvider] = useState<string | null>(initialPayload?.exchangeRateProvider ?? pendingPayload?.exchangeRateProvider ?? null);
  const initialPayerMode: PayerMode = initialPaymentIds.length > 1 ? "multiple" : "single";
  const [payerMode, setPayerMode] = useState<PayerMode>(initialPayerMode);
  const [payerIds, setPayerIds] = useState<string[]>(initialPaymentIds);
  const [paymentValues, setPaymentValues] = useState<Record<string, string>>(initialPaymentValues);
  const [payerDraftMode, setPayerDraftMode] = useState<PayerMode>(initialPayerMode);
  const [payerDraftIds, setPayerDraftIds] = useState<string[]>(initialPaymentIds);
  const [payerDraftValues, setPayerDraftValues] = useState<Record<string, string>>(initialPaymentValues);
  const [participantIds, setParticipantIds] = useState<string[]>(initialParticipants);
  const [participantDraft, setParticipantDraft] = useState<string[]>(initialParticipants);
  // 服务端事实只保留最终金额，编辑时使用 EXACT 才能无损回填；被拒草稿仍保留原始模式。
  const [splitMode, setSplitMode] = useState<SplitMode>(initial ? "EXACT" : (pendingPayload?.split.mode as SplitMode | undefined) ?? "EQUAL");
  const [splitValues, setSplitValues] = useState<Record<string, string>>(() => Object.fromEntries(
    initial ? initial.shares.map((share) => [share.memberId, minorToInput(share.originalAmountMinor, initial.expense.originalCurrency)])
      : pendingPayload?.split.entries?.map((entry) => [entry.memberId, entry.value]) ?? [],
  ));
  const [selectedAttachments, setSelectedAttachments] = useState<SelectedLocalAttachment[]>(() => rejected?.attachments.map((attachment) => ({
    id: attachment.id,
    clientAttachmentId: attachment.clientAttachmentId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    blob: attachment.blob,
    file: new File([attachment.blob], attachment.fileName, { type: attachment.mimeType }),
  })) ?? []);
  const [attachmentToDelete, setAttachmentToDelete] = useState<string>();
  const [guestName, setGuestName] = useState("");
  const [guestError, setGuestError] = useState<string>();
  const [quickError, setQuickError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [entryFocusTarget, setEntryFocusTarget] = useState<"amount" | "payer" | "participants" | "split" | "category" | "currency" | "note" | null>(() => (
    typeof window !== "undefined" && window.innerWidth >= 640 ? "amount" : null
  ));
  const amountRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const activeMembers = [...(members.data ?? cachedMembers ?? []), ...createdMembers.filter((created) => !(members.data ?? cachedMembers ?? []).some((member) => member.memberId === created.memberId))].filter((member) => member.status === "ACTIVE");
  const canAddGuest = activity.status === "ACTIVE" && activity.currentMemberRole === "OWNER";
  const totalMinor = (() => { try { return amount.trim() ? BigInt(amountToMinor(amount, currency)) : null; } catch { return null; } })();
  const splitPreview = previewQuickSplit(totalMinor, currency, participantIds, splitMode, splitValues);
  const mutation = rejected ? reviseRejected : initial ? update : create;

  useEffect(() => {
    if (initialized || activeMembers.length === 0) return;
    const current = activeMembers.some((member) => member.memberId === activity.currentMemberId) ? activity.currentMemberId : activeMembers[0].memberId;
    setPayerIds([current]);
    setPayerDraftIds([current]);
    setParticipantIds(activeMembers.map((member) => member.memberId));
    setParticipantDraft(activeMembers.map((member) => member.memberId));
    setInitialized(true);
  }, [activeMembers, activity.currentMemberId, initialized]);

  useEffect(() => {
    const field = Object.keys(fieldErrors)[0];
    if (!field) return;
    if (field === "amount") amountRef.current?.focus();
    if (field === "title") titleRef.current?.focus();
  }, [fieldErrors]);

  useEffect(() => {
    if (!initialized || view !== "entry" || !entryFocusTarget) return;
    // 换页点击会先把原控件卸载，再提交浏览器的默认 focus；延后一拍可确保
    // 根表单的新入口已经挂载，同时不会在用户编辑字段时反复抢焦点。
    const timer = window.setTimeout(() => {
      formRef.current?.querySelector<HTMLElement>("[data-overlay-initial-focus]")?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [entryFocusTarget, initialized, view]);

  if (members.isPending && activeMembers.length === 0) return <LoadingState label="正在准备记账…" />;
  if (members.error && activeMembers.length === 0) return <ErrorNotice error={members.error} />;

  function clearFieldError(field: string) {
    setFieldErrors((current) => { if (!current[field]) return current; const next = { ...current }; delete next[field]; return next; });
    setQuickError(undefined);
  }

  function openPayer() {
    setEntryFocusTarget("payer");
    setPayerDraftMode(payerMode);
    setPayerDraftIds([...payerIds]);
    setPayerDraftValues({ ...paymentValues });
    onViewChange("payer");
  }

  function switchPayerMode(mode: PayerMode) {
    if (mode === payerDraftMode) return;
    setQuickError(undefined);
    if (mode === "multiple") {
      const memberId = payerDraftIds[0];
      setPayerDraftValues(memberId && totalMinor !== null ? { [memberId]: minorToInput(totalMinor.toString(), currency) } : {});
    }
    setPayerDraftMode(mode);
    if (mode === "single") setPayerDraftIds((current) => current.slice(0, 1));
  }

  function togglePayer(memberId: string) {
    if (payerDraftMode === "single") {
      setPayerIds([memberId]);
      setPayerMode("single");
      setPaymentValues({});
      setQuickError(undefined);
      onViewChange("entry");
      return;
    }
    setQuickError(undefined);
    setPayerDraftIds((current) => current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId]);
  }

  function commitPayers() {
    const selection: PayerSelection = payerDraftMode === "single"
      ? { mode: "single", memberId: payerDraftIds[0] ?? "" }
      : { mode: "multiple", memberIds: payerDraftIds, amountInputs: payerDraftValues };
    const resolution = resolveQuickPayers(selection, totalMinor, currency);
    if (!resolution.payments) { setQuickError(resolution.error); return; }
    setPayerMode(payerDraftMode);
    setPayerIds([...payerDraftIds]);
    setPaymentValues({ ...payerDraftValues });
    setQuickError(undefined);
    onViewChange("entry");
  }

  function openParticipants() {
    setEntryFocusTarget("participants");
    setParticipantDraft([...participantIds]);
    onViewChange("participants");
  }

  function commitParticipants() {
    if (participantDraft.length === 0) { setQuickError("至少选择一名参与成员"); return; }
    const changed = participantDraft.length !== participantIds.length || participantDraft.some((id) => !participantIds.includes(id));
    setParticipantIds([...participantDraft]);
    if (changed && splitMode !== "EQUAL") setSplitValues({});
    setQuickError(undefined);
    onViewChange("entry");
  }

  async function submitGuest() {
    const displayName = guestName.trim();
    if (!displayName || createGuest.isPending) return;
    setGuestError(undefined);
    try {
      const member = await createGuest.mutateAsync(displayName);
      setCreatedMembers((current) => [...current, member]);
      setGuestName("");
      if (view === "payer-add-guest") {
        if (payerDraftMode === "single") {
          setPayerIds([member.memberId]); setPayerMode("single"); setPaymentValues({}); onViewChange("entry");
        } else {
          setPayerDraftIds((current) => [...new Set([...current, member.memberId])]);
          setPayerDraftValues((current) => ({ ...current, [member.memberId]: "" }));
          onViewChange("payer");
        }
      } else {
        setParticipantDraft((current) => [...new Set([...current, member.memberId])]);
        onViewChange("participants");
      }
    } catch (error) {
      setGuestError(error instanceof Error ? error.message : "添加临时成员失败，请稍后重试");
    }
  }

  function selectCurrency(code: string) {
    const next = code.toUpperCase();
    setQuickError(undefined);
    setCurrency(next);
    setExchangeRate(next === activity.baseCurrency ? "1" : "");
    setExchangeRateKind(next === activity.baseCurrency ? "IDENTITY" : "MANUAL");
    setExchangeRateReferenceDate(null);
    setExchangeRateProvider(null);
    setCurrencySearchDraft("");
    onViewChange(next === activity.baseCurrency ? "entry" : "currency-rate");
  }

  async function requestReferenceRate() {
    setQuickError(undefined);
    if (!navigator.onLine) { setQuickError("当前处于离线状态，请手动输入汇率。"); return; }
    try {
      const suggestion = await rateSuggestion.mutateAsync({ from: normalizeCurrency(currency), date: new Date(occurredAt).toISOString().slice(0, 10) });
      setExchangeRate(suggestion.rate); setExchangeRateKind(suggestion.source); setExchangeRateReferenceDate(suggestion.referenceDate); setExchangeRateProvider(suggestion.provider);
    } catch { setQuickError("暂时无法获取参考汇率，请手动输入。"); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setQuickError(undefined); setFieldErrors({});
    if (!amount.trim()) { setFieldErrors({ amount: "金额不能为空。" }); return; }
    if (!title.trim()) { setFieldErrors({ title: "用途不能为空。" }); return; }
    if (!participantIds.length) { setFieldErrors({ participants: "至少选择一名参与成员。" }); return; }
    try {
      const normalizedCurrency = normalizeCurrency(currency);
      let total: string;
      try {
        total = amountToMinor(amount, normalizedCurrency);
      } catch (error) {
        setFieldErrors({ amount: error instanceof Error ? error.message : "金额格式不正确。" });
        return;
      }
      if (normalizedCurrency !== activity.baseCurrency && !exchangeRate.trim()) {
        setQuickError("汇率不能为空，请先完成外币汇率设置。");
        onViewChange("currency-rate");
        return;
      }
      const payerSelection: PayerSelection = payerMode === "single"
        ? { mode: "single", memberId: payerIds[0] ?? "" }
        : { mode: "multiple", memberIds: payerIds, amountInputs: paymentValues };
      const payments = resolveQuickPayers(payerSelection, BigInt(total), normalizedCurrency);
      if (!payments.payments) {
        setPayerDraftMode(payerMode);
        setPayerDraftIds([...payerIds]);
        setPayerDraftValues({ ...paymentValues });
        setQuickError(payments.error ?? "付款信息不完整。");
        onViewChange("payer");
        return;
      }
      const split = previewQuickSplit(BigInt(total), normalizedCurrency, participantIds, splitMode, splitValues);
      if (!split.valid) {
        setQuickError(split.error ?? "分摊信息不完整。");
        onViewChange("split");
        return;
      }
      const draft: ExpenseDraft = {
        title: title.trim(), category, note: note.trim() || null, occurredAt: new Date(occurredAt).toISOString(), clientMutationId: initialPayload?.clientMutationId ?? pendingPayload?.clientMutationId ?? crypto.randomUUID(),
        originalCurrency: normalizedCurrency, originalAmountMinor: total,
        exchangeRateKind: normalizedCurrency === activity.baseCurrency ? "IDENTITY" : exchangeRateKind,
        exchangeRate: normalizedCurrency === activity.baseCurrency ? "1" : exchangeRate.trim(),
        exchangeRateReferenceDate: normalizedCurrency === activity.baseCurrency ? null : exchangeRateReferenceDate,
        exchangeRateProvider: normalizedCurrency === activity.baseCurrency ? null : exchangeRateProvider,
        payments: payments.payments,
        split: splitMode === "EQUAL" ? { mode: splitMode, members: participantIds } : { mode: splitMode, entries: participantIds.map((memberId) => ({ memberId, value: splitMode === "EXACT" ? amountToMinor(splitValues[memberId] ?? "", normalizedCurrency) : splitMode === "WEIGHT" ? decimalToHundredths(splitValues[memberId] ?? "", "份数") : (splitValues[memberId] ?? "").trim() })) },
      };
      if (initial) {
        await update.mutateAsync({ ...draft, version: initial.expense.version });
      } else if (rejected) {
        await reviseRejected.mutateAsync({
          mutationId: rejected.id,
          payload: draft,
          attachments: selectedAttachments.map(({ file, ...attachment }) => ({ ...attachment, blob: file })),
        });
      } else {
        await create.mutateAsync({ input: draft, files: selectedAttachments.map(({ file }) => file) });
      }
      if (onSaved) onSaved();
      else navigate(`/activities/${activity.activityId}`);
    } catch (error) {
      if (error instanceof ApiRequestError) return;
      setQuickError(error instanceof Error ? error.message : "账单输入不正确。");
    }
  }

  const selectedPayerNames = payerIds.map((id) => memberName(id, activeMembers)).join("、");
  const selectedPayerLabel = payerIds.length > 1 ? `${payerIds.length} 人` : selectedPayerNames;
  const selectedCategory = categories.find(([value]) => value === category) ?? categories[0];
  const selectedSplitLabel = quickSplitModes.find(([value]) => value === splitMode)?.[1] ?? "均摊";
  const attachmentCount = initial?.attachments.length ?? selectedAttachments.length;
  const noteSummary = note.trim() || (attachmentCount ? `已添加 ${attachmentCount} 张附件` : "点击添加备注或附件");
  const payerDraftSelection: PayerSelection = payerDraftMode === "single"
    ? { mode: "single", memberId: payerDraftIds[0] ?? "" }
    : { mode: "multiple", memberIds: payerDraftIds, amountInputs: payerDraftValues };
  const payerDraftResolution = resolveQuickPayers(payerDraftSelection, totalMinor, currency);
  const renderMemberPicker = (mode: PayerMode) => (
    <>
      <div className="quick-expense-segmented" role="group" aria-label="付款模式"><button type="button" aria-pressed={payerDraftMode === "single"} onClick={() => switchPayerMode("single")}>单人付款</button><button type="button" aria-pressed={payerDraftMode === "multiple"} onClick={() => switchPayerMode("multiple")}>多人付款</button></div>
      <QuickMemberChoiceList members={activeMembers} mode={mode} selectedIds={payerDraftIds} onToggle={togglePayer} paymentValues={mode === "multiple" ? payerDraftValues : undefined} onPaymentChange={(id, value) => { setQuickError(undefined); setPayerDraftValues((current) => ({ ...current, [id]: value })); }} canAddGuest={canAddGuest} online={!offline} onAddGuest={() => { setGuestError(undefined); onViewChange("payer-add-guest"); }} />
      {mode === "multiple" ? <QuickExpenseActionDock status={totalMinor === null ? "先填写账单金额，再分配多人付款金额" : <>已分配 {formatMoney(currency, payerDraftResolution.allocatedMinor.toString())} / {formatMoney(currency, totalMinor.toString())}</>}><Button type="button" disabled={!payerDraftResolution.payments} onClick={commitPayers}>完成</Button></QuickExpenseActionDock> : null}
    </>
  );

  return (
    <form ref={formRef} className="quick-expense-form" onSubmit={submit} noValidate>
      {quickError ? <div className="quick-expense-error" role="alert">{quickError}</div> : null}
      {view === "entry" ? (
        <div className="quick-expense-entry" data-quick-expense-view="entry">
          <div className="quick-expense-amount">
            <button type="button" className="quick-expense-currency" aria-label={`币种：${currency}`} aria-haspopup="dialog" data-overlay-initial-focus={entryFocusTarget === "currency" ? "true" : undefined} onClick={() => { setEntryFocusTarget("currency"); onViewChange("currency"); }}><span>{currency}</span><ChevronRight aria-hidden="true" size={14} /></button>
            <label htmlFor="quick-expense-amount" className="sr-only">金额</label>
            <Input ref={amountRef} id="quick-expense-amount" data-overlay-initial-focus={entryFocusTarget === "amount" ? "true" : undefined} className="quick-expense-amount__input" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); clearFieldError("amount"); }} placeholder="0.00" aria-invalid={Boolean(fieldErrors.amount)} aria-describedby={fieldErrors.amount ? "quick-expense-amount-error" : undefined} required />
            <small>金额</small>
            {fieldErrors.amount ? <small id="quick-expense-amount-error" className="quick-expense-field-error" role="alert">{fieldErrors.amount}</small> : null}
          </div>
          <div className="quick-expense-grid">
            <QuickValueButton label="分类" value={selectedCategory[1]} initialFocus={entryFocusTarget === "category"} onClick={() => { setEntryFocusTarget("category"); onViewChange("category"); }}><img className="quick-expense-value-button__image" src={`/expense-categories/${selectedCategory[2]}.webp`} width={34} height={34} alt="" /></QuickValueButton>
            <label className="quick-expense-inline-field"><span>用途</span><Input ref={titleRef} aria-label="用途" value={title} onChange={(event) => { setTitle(event.target.value); clearFieldError("title"); }} placeholder="例如：晚餐" maxLength={120} aria-invalid={Boolean(fieldErrors.title)} aria-describedby={fieldErrors.title ? "quick-expense-title-error" : undefined} required />{fieldErrors.title ? <small id="quick-expense-title-error" className="quick-expense-error" role="alert">{fieldErrors.title}</small> : null}</label>
            <QuickFieldButton label="付款人" value={selectedPayerLabel || "请选择"} initialFocus={entryFocusTarget === "payer"} onClick={openPayer}><span className="quick-expense-avatar-stack" aria-hidden="true">{payerIds.slice(0, 2).map((id) => <MemberAvatar key={id} memberId={id} displayName={memberName(id, activeMembers)} avatarPreset={memberAvatarPreset(id, activeMembers)} size="sm" />)}</span></QuickFieldButton>
            <QuickTimePicker value={occurredAt} onChange={(value) => { setOccurredAt(value); if (exchangeRateKind === "PROVIDER" || exchangeRateKind === "CACHE") { setExchangeRate(""); setExchangeRateKind("MANUAL"); setExchangeRateReferenceDate(null); setExchangeRateProvider(null); } }} />
            <div className="quick-expense-participants"><QuickFieldButton label="参与人" value={participantIds.length ? `${participantIds.length} 人` : "请选择"} initialFocus={entryFocusTarget === "participants"} onClick={openParticipants}><span className="quick-expense-avatar-stack" aria-hidden="true">{participantIds.slice(0, 2).map((id) => <MemberAvatar key={id} memberId={id} displayName={memberName(id, activeMembers)} avatarPreset={memberAvatarPreset(id, activeMembers)} size="sm" />)}</span></QuickFieldButton>{fieldErrors.participants ? <small className="quick-expense-error" role="alert">{fieldErrors.participants}</small> : null}</div>
            <QuickValueButton label="分摊设置" value={selectedSplitLabel} initialFocus={entryFocusTarget === "split"} onClick={() => { setEntryFocusTarget("split"); onViewChange("split"); }} />
          </div>
          <QuickFieldButton label="备注" value={noteSummary} initialFocus={entryFocusTarget === "note"} onClick={() => { setEntryFocusTarget("note"); onViewChange("note"); }} />
          {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
          {mutation.error instanceof ApiRequestError && mutation.error.status === 409 ? <div className="notice">服务器版本已更新。当前表单仍保留，请返回查看最新账单后再决定。</div> : null}
          <QuickExpenseActionDock><Button type="submit" className="quick-expense-submit" busy={mutation.isPending}>{rejected ? "修改后重试" : "保存"}</Button></QuickExpenseActionDock>
        </div>
      ) : view === "payer" ? <div className="quick-expense-subview" data-quick-expense-view="payer">{renderMemberPicker(payerDraftMode)}</div>
        : view === "participants" ? <div className="quick-expense-subview" data-quick-expense-view="participants"><QuickMemberChoiceList members={activeMembers} mode="multiple" selectedIds={participantDraft} onToggle={(id) => { setQuickError(undefined); setParticipantDraft((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }} canAddGuest={canAddGuest} online={!offline} onAddGuest={() => { setGuestError(undefined); onViewChange("participants-add-guest"); }} /><QuickExpenseActionDock><Button type="button" disabled={!participantDraft.length} onClick={commitParticipants}>完成</Button></QuickExpenseActionDock></div>
        : view === "payer-add-guest" || view === "participants-add-guest" ? <div className="quick-expense-subview quick-expense-guest-view" data-quick-expense-view={view}><label className="field"><span className="field__label">临时成员昵称</span><Input data-overlay-initial-focus value={guestName} maxLength={40} autoFocus required onChange={(event) => setGuestName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitGuest(); } }} /></label>{guestError ? <p className="quick-expense-error" role="alert">{guestError}</p> : null}<QuickExpenseActionDock><Button type="button" disabled={!guestName.trim() || createGuest.isPending} busy={createGuest.isPending} onClick={() => void submitGuest()}>确认添加</Button></QuickExpenseActionDock></div>
        : view === "category" ? <div className="quick-expense-subview" data-quick-expense-view="category"><div className="quick-category-grid" role="radiogroup" aria-label="分类">{categories.map(([value, label, image]) => <button key={value} type="button" role="radio" aria-checked={category === value} onClick={() => { setCategory(value); onViewChange("entry"); }}><img src={`/expense-categories/${image}.webp`} width={44} height={44} alt="" /><span>{label}</span>{category === value ? <Check aria-hidden="true" size={15} /> : null}</button>)}</div></div>
        : view === "currency" ? <div className="quick-expense-subview" data-quick-expense-view="currency"><label className="quick-currency-search"><span className="sr-only">搜索币种</span><Input data-overlay-initial-focus placeholder="搜索币种" value={currencySearchDraft} onChange={(event) => setCurrencySearchDraft(event.target.value)} /></label><CurrencyQuickList value={currency} search={currencySearchDraft} onSelect={selectCurrency} /></div>
        : view === "currency-rate" ? <div className="quick-expense-subview" data-quick-expense-view="currency-rate"><Field label={`汇率（1 ${currency} = N ${activity.baseCurrency}）`}><div className="exchange-rate-input"><Input data-overlay-initial-focus inputMode="decimal" value={exchangeRate} onChange={(event) => { setQuickError(undefined); setExchangeRate(event.target.value); setExchangeRateKind("MANUAL"); setExchangeRateReferenceDate(null); setExchangeRateProvider(null); }} placeholder="例如 7.25" required /><Button type="button" variant="secondary" disabled={rateSuggestion.isPending} onClick={() => void requestReferenceRate()}>{rateSuggestion.isPending ? "正在获取…" : "获取参考汇率"}</Button></div>{exchangeRateReferenceDate ? <small>{exchangeRateKind === "CACHE" ? "缓存参考汇率" : exchangeRateProvider === "FRANKFURTER" ? "Frankfurter 参考汇率" : "参考汇率"} · {exchangeRateReferenceDate}</small> : null}</Field><QuickExpenseActionDock><Button type="button" disabled={!exchangeRate.trim()} onClick={() => onViewChange("entry")}>完成</Button></QuickExpenseActionDock></div>
        : view === "note" ? <div className="quick-expense-subview quick-expense-note-view" data-quick-expense-view="note"><Field label="备注"><Textarea data-overlay-initial-focus value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} /></Field>{initial ? <ExpenseAttachments activityId={activity.activityId} expenseId={initial.expense.expenseId} attachments={initial.attachments} deletingAttachmentId={deleteAttachment.variables} onDelete={setAttachmentToDelete} /> : <Field label="附件（最多三张）"><div className="quick-expense-attachment"><input id="quick-expense-attachments" className="quick-expense-attachment__input" aria-label="附件（最多三张）" type="file" accept={attachmentAccept} multiple disabled={selectedAttachments.length >= 3} onChange={(event) => { const files = Array.from(event.target.files ?? []); const error = validateAttachments([...selectedAttachments.map(({ file }) => file), ...files]); if (error) { setQuickError(error); return; } setSelectedAttachments((current) => [...current, ...files.map((file) => ({ id: crypto.randomUUID(), clientAttachmentId: crypto.randomUUID(), fileName: file.name, mimeType: file.type, blob: file, file }))]); event.target.value = ""; }} /><span className="quick-expense-attachment__surface"><ImagePlus aria-hidden="true" size={18} /><strong>选择图片</strong><small>{selectedAttachments.length ? `已选择 ${selectedAttachments.length}/3` : "未选择图片"}</small></span></div><SelectedAttachmentPreviews files={selectedAttachments.map(({ file }) => file)} onRemove={(index) => setSelectedAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))} /></Field>}{deleteAttachment.error ? <ErrorNotice error={deleteAttachment.error} /> : null}<QuickExpenseActionDock><Button type="button" onClick={() => onViewChange("entry")}>完成</Button></QuickExpenseActionDock><ConfirmDialog open={Boolean(attachmentToDelete)} title="删除附件" message="删除后这张图片将从账单中移除，此操作会立即生效。确定继续吗？" confirmLabel="确认删除" busy={deleteAttachment.isPending} onConfirm={() => { if (!attachmentToDelete) return; void deleteAttachment.mutateAsync(attachmentToDelete).then(() => setAttachmentToDelete(undefined)).catch(() => undefined); }} onCancel={() => setAttachmentToDelete(undefined)} /></div>
        : <div className="quick-expense-subview" data-quick-expense-view="split">
          <fieldset className="quick-split-modes" role="radiogroup" aria-label="分摊方式">{quickSplitModes.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={splitMode === value} onClick={() => { setQuickError(undefined); setSplitMode(value); }}>{label}</button>)}</fieldset>
          <div className="quick-split-list" role="list" aria-label="参与成员分摊">
            <div className="quick-split-list__rows">{participantIds.map((memberId) => {
              const name = memberName(memberId, activeMembers);
              const updateSplitValue = (value: string) => {
                setQuickError(undefined);
                setSplitValues((current) => ({ ...current, [memberId]: value }));
              };
              return <div className="quick-split-row" key={memberId}>
                <MemberAvatar memberId={memberId} displayName={name} avatarPreset={memberAvatarPreset(memberId, activeMembers)} size="sm" />
                <span>{name}</span>
                {splitMode === "EQUAL"
                  ? <strong>{splitPreview.valid ? formatMoney(currency, splitPreview.allocations.find((row) => row.memberId === memberId)?.amountMinor.toString() ?? "0") : "待完成"}</strong>
                  : splitMode === "WEIGHT"
                    ? <QuickWeightStepper name={name} value={splitValues[memberId] ?? ""} onChange={updateSplitValue} />
                    : <Input inputMode="decimal" aria-label={`${name}${quickSplitModes.find(([value]) => value === splitMode)?.[1]}`} value={splitValues[memberId] ?? ""} placeholder={splitMode === "PERCENTAGE" ? "%" : "金额"} onChange={(event) => updateSplitValue(event.target.value)} />}
              </div>;
            })}</div>
            <div className="quick-expense-subview__summary" aria-live="polite"><QuickSplitSummary currency={currency} memberIds={participantIds} mode={splitMode} values={splitValues} totalMinor={totalMinor} /></div>
          </div>
          <QuickExpenseActionDock><Button type="button" disabled={!splitPreview.valid} onClick={() => { setQuickError(undefined); onViewChange("entry"); }}>完成</Button></QuickExpenseActionDock>
        </div>}
    </form>
  );
}

function CurrencyQuickList({ value, search, onSelect }: { value: string; search: string; onSelect: (code: string) => void }) {
  const query = search.trim().toUpperCase();
  const common = commonCurrencyCodes.filter((code) => !query || `${code} ${currencyDisplayName(code)}`.toUpperCase().includes(query));
  const all = currencyCodes.filter((code) => !commonCurrencyCodes.includes(code as (typeof commonCurrencyCodes)[number]) && (!query || `${code} ${currencyDisplayName(code)}`.toUpperCase().includes(query)));
  const renderGroup = (label: string, codes: readonly string[]) => codes.length ? <section className="quick-currency-group"><h3>{label}</h3>{codes.map((code) => <button type="button" key={code} aria-pressed={value === code} onClick={() => onSelect(code)}><span className="quick-currency-check">{value === code ? <Check aria-hidden="true" size={15} /> : null}</span><strong>{code}</strong><span>{currencyDisplayName(code)}</span></button>)}</section> : null;
  return <div className="quick-currency-list">{renderGroup("常用", common)}{renderGroup("全部币种", all)}{!common.length && !all.length ? <p className="quick-expense-muted">未找到匹配的币种</p> : null}</div>;
}

export function NewExpensePage() {
  const { activity } = useWorkspace();
  if (activity.status !== "ACTIVE") {
    return <div className="workspace-page"><Link className="inline-back" to=".."><ArrowLeft aria-hidden="true" size={18} /> 返回流水</Link><div className="notice"><Info aria-hidden="true" size={18} /><span>活动已结束或归档，当前不能新增账单；已有账单仍可只读查看。</span></div></div>;
  }
  return <div className="workspace-page"><Link className="inline-back" to=".."><ArrowLeft aria-hidden="true" size={18} /> 返回流水</Link><RoutedExpenseEditor /></div>;
}

export function ExpenseDetailPage() {
  const { expenseId = "" } = useParams();
  const { session, activity, members: cachedMembers, offline, snapshot } = useWorkspace();
  const expense = useExpenseQuery(session.userId, activity.activityId, expenseId, !offline);
  const members = useMembersQuery(session.userId, activity.activityId, !offline);
  const remove = useDeleteExpenseMutation(session.userId, activity.activityId, expenseId);
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const aggregate = expense.data ?? snapshot?.snapshot.expenses.find((item) => item.expense.expenseId === expenseId);
  const memberData = members.data ?? cachedMembers ?? [];
  if ((!offline && expense.isPending) || members.isPending && memberData.length === 0) return <LoadingState label="正在读取账单…" />;
  if ((!offline && expense.error && !snapshot) || members.error && memberData.length === 0) return <ErrorNotice error={expense.error ?? members.error} />;
  if (!aggregate) return null;
  if (activity.status !== "ACTIVE" || offline) {
    const categoryLabel = categories.find(([value]) => value === aggregate.expense.category)?.[1] ?? "其他";
    const splitModeLabel = splitModes.find(([value]) => value === aggregate.expense.splitMode)?.[1] ?? aggregate.expense.splitMode;
    return (
      <div className="workspace-page">
        <Link className="inline-back" to={`/activities/${activity.activityId}`}><ArrowLeft aria-hidden="true" size={18} /> 返回流水</Link>
           <div className="notice"><Info aria-hidden="true" size={18} /><span>{offline ? "当前离线，账单使用最近一次同步的只读快照。" : "活动已结束或归档，账单仅供查看。"}</span></div>
        <section className="expense-readonly" aria-label="账单详情">
          <header><h2>{aggregate.expense.title}</h2><small>{new Date(aggregate.expense.occurredAt).toLocaleString("zh-CN")}</small></header>
          <dl className="expense-readonly__facts">
            <div><dt>分类</dt><dd>{categoryLabel}</dd></div>
            <div><dt>原始金额</dt><dd><Money value={formatMoney(aggregate.expense.originalCurrency, aggregate.expense.originalAmountMinor)} /></dd></div>
            <div><dt>折算金额</dt><dd><Money value={formatMoney(aggregate.expense.baseCurrency, aggregate.expense.baseAmountMinor)} /></dd></div>
            <div><dt>汇率</dt><dd>{aggregate.expense.exchangeRate}{aggregate.expense.exchangeRateReferenceDate ? <small>{aggregate.expense.exchangeRateKind === "CACHE" ? "缓存参考汇率" : "Frankfurter 参考汇率"} · {aggregate.expense.exchangeRateReferenceDate}</small> : null}</dd></div>
             <div><dt>付款事实</dt><dd>{aggregate.payments.map((payment) => <span key={payment.factId}>{memberName(payment.memberId, memberData)}<Money value={formatMoney(aggregate.expense.originalCurrency, payment.originalAmountMinor)} /></span>)}</dd></div>
            <div><dt>分摊方式</dt><dd>{splitModeLabel}</dd></div>
             <div><dt>成员分摊</dt><dd>{aggregate.shares.map((share) => <span key={share.factId}>{memberName(share.memberId, memberData)}<Money value={formatMoney(aggregate.expense.originalCurrency, share.originalAmountMinor)} /></span>)}</dd></div>
          </dl>
          {aggregate.expense.note ? <p>{aggregate.expense.note}</p> : null}
          <ExpenseAttachments activityId={activity.activityId} expenseId={aggregate.expense.expenseId} attachments={aggregate.attachments} />
        </section>
      </div>
    );
  }
  return (
    <div className="workspace-page">
      <div className="detail-toolbar"><Link className="inline-back" to={`/activities/${activity.activityId}`}><ArrowLeft aria-hidden="true" size={18} /> 返回流水</Link><Button variant="danger" busy={remove.isPending} onClick={() => setDeleteOpen(true)}><Trash2 aria-hidden="true" size={17} /> 删除</Button></div>
      {remove.error ? <ErrorNotice error={remove.error} /> : null}
      <ConfirmDialog open={deleteOpen} title="删除账单" message="删除后账本会立即重新计算，这笔账单无法恢复。确定继续吗？" confirmLabel="确认删除" busy={remove.isPending} onConfirm={() => { void remove.mutateAsync(expense.data!.expense.version).then(() => { setDeleteOpen(false); navigate(`/activities/${activity.activityId}`); }).catch(() => undefined); }} onCancel={() => setDeleteOpen(false)} />
      <RoutedExpenseEditor initial={aggregate} />
    </div>
  );
}

