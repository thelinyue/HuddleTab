import { ArrowLeft, Check, ChevronRight, ImagePlus, Info, Minus, Plus, Trash2 } from "lucide-react";
import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../../api/error";
import { usePwaUpdateBlock } from "../../app/pwa-update-safety";
import { MemberAvatar } from "../../components/member-avatar";
import { Overlay } from "../../components/overlay";
import { Button, ConfirmDialog, ErrorNotice, Field, Input, LoadingState, Money, Textarea } from "../../components/ui";
import { amountToMinor, formatMoney, minorToInput, normalizeCurrency } from "../../domain-preview/money";
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
  useUploadAttachmentMutation,
  useUpdateExpenseMutation
} from "./api";
import { aiSuggestionLabel, type AiExpenseEditorInitialValues, type AiExpenseField } from "./ai-expense-entry";

import { attachmentAccept, ExpenseAttachments, SelectedAttachmentPreviews, validateAttachments } from "./expense-attachments";

import { categories, memberAvatarImage, memberAvatarPreset, memberName, parentQuickExpenseView, type PendingExpenseDraft, quickExpenseBackLabel, quickExpenseMobileSheet, quickExpenseOverlayClass, type QuickExpenseView, quickExpenseViewTitle } from "./shared";
const splitModes = [
  ["EQUAL", "均摊"], ["EXACT", "按金额"], ["PERCENTAGE", "按比例"], ["WEIGHT", "按份数"],
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
  initialDraft?: AiExpenseEditorInitialValues;
  onSaved?: () => void;
};

function RoutedExpenseEditor(props: ExpenseEditorProps) {
  const [view, setView] = useState<QuickExpenseView>("entry");
  // 独立路由编辑器卸载前都可能保留用户输入，离开路由后再允许新版接管页面。
  usePwaUpdateBlock(true);
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

function ExpenseSettlementProgressSection({
  progress,
  members,
}: {
  progress?: ExpenseAggregate["settlementProgress"];
  members: readonly ActivityMember[];
}) {
  if (!progress) return null;
  const statusLabel = progress.status === "NO_SETTLEMENT_REQUIRED"
    ? "无需结算"
    : progress.status === "SETTLED"
      ? "已结清 ✓"
      : progress.status === "PARTIALLY_SETTLED"
        ? "部分结算"
        : "待结算";
  const statusClass = progress.status.toLowerCase().replaceAll("_", "-");
  return <section className="expense-settlement-progress" aria-labelledby="expense-settlement-progress-heading">
    <header className="expense-settlement-progress__header">
      <div><h2 id="expense-settlement-progress-heading">结算进度</h2><p>账单结算进度仅统计明确关联到本账单的结算记录。</p></div>
      <strong className={`expense-settlement-progress__status expense-settlement-progress__status--${statusClass}`}>{statusLabel}</strong>
    </header>
    {progress.status === "NO_SETTLEMENT_REQUIRED"
      ? <p className="expense-settlement-progress__empty">这笔账从一开始无需成员间结算。</p>
      : <div className="expense-settlement-progress__table" role="table" aria-label="账单成员结算进度">
        <div className="expense-settlement-progress__row expense-settlement-progress__row--heading" role="row">
          <span role="columnheader">成员</span><span role="columnheader">应结算</span><span role="columnheader">已结算</span><span role="columnheader">待结算</span>
        </div>
        {progress.members.map((member) => {
          const received = member.direction === "RECEIVABLE";
          const settled = member.status === "SETTLED";
          return <div className="expense-settlement-progress__row" role="row" key={member.memberId}>
            <span role="cell" className="expense-settlement-progress__member"><MemberAvatar memberId={member.memberId} {...memberAvatarImage(member.memberId, members)} displayName={memberName(member.memberId, members)} avatarPreset={memberAvatarPreset(member.memberId, members)} size="sm" /><span>{memberName(member.memberId, members)}</span></span>
            <span role="cell"><small>{received ? "应收" : "应结"}</small>{formatMoney(progress.currency, member.expectedMinor)}</span>
            <span role="cell"><small>{received ? "已收" : "已结"}</small>{formatMoney(progress.currency, member.settledMinor)}</span>
            <span role="cell" className={settled ? "expense-settlement-progress__remaining expense-settlement-progress__remaining--settled" : "expense-settlement-progress__remaining"}><small>{received ? "待收" : "待结"}</small>{formatMoney(progress.currency, member.remainingMinor)}{settled ? <Check aria-label="已结清" size={15} /> : null}</span>
          </div>;
        })}
      </div>}
  </section>;
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

function parseQuickInteger(value: string, label: string): bigint {
  const normalized = value.trim();
  if (!/^(0|[1-9]\d*)$/.test(normalized)) throw new Error(`${label}必须是整数。`);
  return BigInt(normalized);
}

function formatQuickInteger(value: bigint): string {
  return value.toString();
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
    const weights = memberIds.map((memberId) => ({ memberId, weight: parseQuickInteger(values[memberId] ?? "", mode === "PERCENTAGE" ? "比例" : "份数") }));
    if (weights.some((row) => row.weight <= 0n)) return { allocations: [], allocatedMinor: 0n, valid: false, error: "分摊值必须大于零" };
    const weightTotal = weights.reduce((sum, row) => sum + row.weight, 0n);
    if (mode === "PERCENTAGE" && weightTotal !== 100n) return { allocations: [], allocatedMinor: 0n, valid: false, error: "比例合计必须等于 100%" };
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
      const units = mode === "EXACT" ? amountToMinor(value, currency) : parseQuickInteger(value, mode === "PERCENTAGE" ? "比例" : "份数").toString();
      return sum + BigInt(units);
    }, 0n);
  } catch {
    return null;
  }
}

function QuickSplitSummary({ currency, memberIds, mode, values, totalMinor, onFillRemainder }: {
  currency: string;
  memberIds: readonly string[];
  mode: SplitMode;
  values: Readonly<Record<string, string>>;
  totalMinor: bigint | null;
  onFillRemainder?: () => void;
}) {
  const totalLabel = totalMinor === null ? "待填写金额" : formatMoney(currency, totalMinor.toString());
  if (mode === "EQUAL") {
    return <><p><span>消费总额</span><strong>{totalLabel}</strong></p><p><span>已分配</span><strong>{totalMinor === null ? "待完成" : `${totalLabel} · 差额 ${formatMoney(currency, "0")}`}</strong></p></>;
  }
  const progress = quickSplitProgress(currency, memberIds, mode, values);
  if (mode === "EXACT") {
    const emptyMembers = memberIds.filter((memberId) => !(values[memberId] ?? "").trim());
    const remaining = totalMinor !== null && progress !== null ? totalMinor - progress : null;
    return <>
      <p><span>消费总额</span><strong>{totalLabel}</strong></p>
      <p><span>已分配</span><strong>{progress === null ? "待完成" : `${formatMoney(currency, progress.toString())} · 差额 ${formatMoney(currency, remaining?.toString() ?? "0")}`}</strong></p>
      {onFillRemainder && emptyMembers.length > 0 && remaining !== null && remaining >= 0n ? <button type="button" className="quick-split-remainder" onClick={onFillRemainder}>填入剩余金额</button> : null}
    </>;
  }
  if (mode === "PERCENTAGE") {
    const progressText = progress === null ? "待完成" : `${progress}%`;
    const remaining = progress === null ? "待完成" : `${100n - progress}%`;
    const emptyMembers = memberIds.filter((memberId) => !(values[memberId] ?? "").trim());
    const remainingValue = progress === null ? null : 100n - progress;
    return <>
      <p><span>消费总额</span><strong>{totalLabel}</strong></p>
      <p><span>已分配</span><strong>{progressText} · 剩余 {remaining}</strong></p>
      {onFillRemainder && emptyMembers.length > 0 && remainingValue !== null && remainingValue > 0n ? <button type="button" className="quick-split-remainder" onClick={onFillRemainder}>分配剩余比例</button> : null}
    </>;
  }
  const progressText = progress === null ? "待完成" : progress.toString();
  const perUnit = totalMinor !== null && progress !== null && progress > 0n ? formatMoney(currency, (totalMinor / progress).toString()) : "待完成";
  return <><p><span>消费总额</span><strong>{totalLabel}</strong></p><p><span>总份数</span><strong>{progressText} · 每份 {perUnit}</strong></p></>;
}

/** 为自定义模式生成一个可立即提交的平均起点，避免用户先面对一组无效的零值。 */
function initialSplitValues(totalMinor: bigint | null, currency: string, memberIds: readonly string[], mode: Exclude<SplitMode, "EQUAL">): Record<string, string> {
  if (mode === "WEIGHT") return Object.fromEntries(memberIds.map((memberId) => [memberId, "1"]));
  if (mode === "PERCENTAGE") {
    const count = BigInt(memberIds.length);
    const base = count ? 100n / count : 0n;
    const remainder = count ? 100n % count : 0n;
    return Object.fromEntries(memberIds.map((memberId, index) => [memberId, (base + (BigInt(index) < remainder ? 1n : 0n)).toString()]));
  }
  if (totalMinor === null || memberIds.length === 0) return {};
  const allocations = quickAllocate(totalMinor, memberIds.map((memberId) => ({ memberId, weight: 1n })));
  return Object.fromEntries(allocations.map((allocation) => [allocation.memberId, minorToInput(allocation.amountMinor.toString(), currency)]));
}

/** 只给空白成员填入当前模式的剩余值，已填写的成员不会被悄悄改动。 */
function fillSplitRemainder(totalMinor: bigint | null, currency: string, memberIds: readonly string[], mode: "EXACT" | "PERCENTAGE", values: Readonly<Record<string, string>>): Record<string, string> {
  const emptyIds = memberIds.filter((memberId) => !(values[memberId] ?? "").trim());
  if (!emptyIds.length) return { ...values };
  const progress = quickSplitProgress(currency, memberIds, mode, values);
  const remaining = mode === "EXACT" ? (totalMinor !== null && progress !== null ? totalMinor - progress : null) : (progress !== null ? 100n - progress : null);
  if (remaining === null || remaining < 0n) return { ...values };
  const allocations = quickAllocate(remaining, emptyIds.map((memberId) => ({ memberId, weight: 1n })));
  return Object.fromEntries(memberIds.map((memberId) => {
    const allocation = allocations.find((row) => row.memberId === memberId);
    if (!allocation) return [memberId, values[memberId] ?? ""];
    return [memberId, mode === "EXACT" ? minorToInput(allocation.amountMinor.toString(), currency) : allocation.amountMinor.toString()];
  }));
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

/** 金额以外的两种离散分配都使用相同的整数步进控件，保证触控和键盘路径一致。 */
function QuickIntegerStepper({ name, unit, value, max, onChange }: { name: string; unit: "比例" | "份数"; value: string; max?: bigint; onChange: (value: string) => void }) {
  let parsed: bigint | null = null;
  try { parsed = parseQuickInteger(value.trim() || "0", unit); } catch { /* 输入中的临时非法文本交给预览校验展示。 */ }
  const update = (delta: bigint) => {
    if (parsed === null) return;
    const next = parsed + delta;
    if (next < 0n || (max !== undefined && next > max)) return;
    onChange(formatQuickInteger(next));
  };
  return (
    <div className="quick-weight-stepper" role="group" aria-label={`${name}${unit}`}>
      <button type="button" aria-label={`减少${name}的${unit}`} disabled={parsed === null || parsed <= 0n} onClick={() => update(-1n)}><Minus aria-hidden="true" size={17} /></button>
      <span className="quick-weight-stepper__value"><Input inputMode="numeric" aria-label={`${name}按${unit}`} value={value} placeholder="0" onChange={(event) => onChange(event.target.value)} />{unit === "比例" ? <span className="quick-weight-stepper__unit" aria-hidden="true">%</span> : null}</span>
      <button type="button" aria-label={`增加${name}的${unit}`} disabled={parsed === null || (max !== undefined && parsed >= max)} onClick={() => update(1n)}><Plus aria-hidden="true" size={17} /></button>
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
                <MemberAvatar memberId={member.memberId} userId={member.userId} displayName={member.displayName} avatarPreset={member.avatarPreset} avatarImageId={member.avatarImageId} size="md" />
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
export function UnifiedExpenseEditor({ initial, rejected, initialDraft, view, onViewChange, onSaved }: ExpenseEditorProps & { view: QuickExpenseView; onViewChange: (view: QuickExpenseView) => void }) {
  const { session, activity, members: cachedMembers, offline } = useWorkspace();
  const members = useMembersQuery(session.userId, activity.activityId, !offline);
  const navigate = useNavigate();
  const create = useCreateExpenseMutation(session.userId, activity.activityId);
  const reviseRejected = useReviseRejectedExpenseMutation(session.userId);
  const update = useUpdateExpenseMutation(session.userId, activity.activityId, initial?.expense.expenseId ?? "");
  const deleteAttachment = useDeleteAttachmentMutation(session.userId, activity.activityId, initial?.expense.expenseId ?? "");
  const uploadAttachment = useUploadAttachmentMutation(session.userId, activity.activityId, initial?.expense.expenseId ?? "");
  const createGuest = useCreateGuestMutation(session.userId, activity.activityId);
  const rateSuggestion = useExchangeRateSuggestionMutation(activity.activityId);
  const pendingPayload = rejected?.payload;
  const initialPayload = initial?.expense;
  const initialPayments = initial?.payments ?? [];
  const initialParticipants = initial
    ? initial.shares.map((share) => share.memberId)
    : pendingPayload
      ? pendingPayload.split.members ?? pendingPayload.split.entries?.map((entry) => entry.memberId) ?? []
      : initialDraft?.participantIds ?? [];
  const initialPaymentIds = initial
    ? initialPayments.map((payment) => payment.memberId)
    : pendingPayload
      ? pendingPayload.payments.map((payment) => payment.memberId)
      : initialDraft?.payerIds ?? [];
  const initialPaymentValues = Object.fromEntries(
    initial ? initial.payments.map((payment) => [payment.memberId, minorToInput(payment.originalAmountMinor, initial.expense.originalCurrency)])
      : pendingPayload ? pendingPayload.payments.map((payment) => [payment.memberId, minorToInput(payment.amountMinor, pendingPayload.originalCurrency)]) : Object.entries(initialDraft?.paymentValues ?? {}),
  );
  const [createdMembers, setCreatedMembers] = useState<ActivityMember[]>([]);
  const [initialized, setInitialized] = useState(Boolean(initial || rejected));
  const [amount, setAmount] = useState(() => initialPayload
    ? minorToInput(initialPayload.originalAmountMinor, initialPayload.originalCurrency)
    : pendingPayload ? minorToInput(pendingPayload.originalAmountMinor, pendingPayload.originalCurrency) : initialDraft?.amountMinor && initialDraft.currency ? minorToInput(initialDraft.amountMinor, initialDraft.currency) : "");
  const [title, setTitle] = useState(initialPayload?.title ?? pendingPayload?.title ?? initialDraft?.title ?? "");
  const [category, setCategory] = useState<(typeof categories)[number][0]>((initialPayload?.category ?? pendingPayload?.category ?? initialDraft?.category ?? "FOOD") as (typeof categories)[number][0]);
  const [currency, setCurrency] = useState(initialPayload?.originalCurrency ?? pendingPayload?.originalCurrency ?? initialDraft?.currency ?? activity.baseCurrency);
  const [currencySearchDraft, setCurrencySearchDraft] = useState("");
  const [occurredAt, setOccurredAt] = useState(localDateTime(initialPayload?.occurredAt ?? pendingPayload?.occurredAt ?? initialDraft?.occurredAt));
  const [note, setNote] = useState(initialPayload?.note ?? pendingPayload?.note ?? initialDraft?.note ?? "");
  const [exchangeRate, setExchangeRate] = useState(initialPayload?.exchangeRate ?? pendingPayload?.exchangeRate ?? (activity.baseCurrency ? "1" : ""));
  const [exchangeRateKind, setExchangeRateKind] = useState(initialPayload?.exchangeRateKind ?? pendingPayload?.exchangeRateKind ?? "IDENTITY");
  const [exchangeRateReferenceDate, setExchangeRateReferenceDate] = useState<string | null>(initialPayload?.exchangeRateReferenceDate ?? pendingPayload?.exchangeRateReferenceDate ?? null);
  const [exchangeRateProvider, setExchangeRateProvider] = useState<string | null>(initialPayload?.exchangeRateProvider ?? pendingPayload?.exchangeRateProvider ?? null);
  const initialPayerMode: PayerMode = initial
    ? (initialPaymentIds.length > 1 ? "multiple" : "single")
    : pendingPayload
      ? (initialPaymentIds.length > 1 ? "multiple" : "single")
      : initialDraft?.payerMode ?? (initialPaymentIds.length > 1 ? "multiple" : "single");
  const [payerMode, setPayerMode] = useState<PayerMode>(initialPayerMode);
  const [payerIds, setPayerIds] = useState<string[]>(initialPaymentIds);
  const [paymentValues, setPaymentValues] = useState<Record<string, string>>(initialPaymentValues);
  const [payerDraftMode, setPayerDraftMode] = useState<PayerMode>(initialPayerMode);
  const [payerDraftIds, setPayerDraftIds] = useState<string[]>(initialPaymentIds);
  const [payerDraftValues, setPayerDraftValues] = useState<Record<string, string>>(initialPaymentValues);
  const [participantIds, setParticipantIds] = useState<string[]>(initialParticipants);
  const [participantDraft, setParticipantDraft] = useState<string[]>(initialParticipants);
  // 服务端事实只保留最终金额；已有均摊可安全回显，其余模式使用金额事实无损回填。
  const [splitMode, setSplitMode] = useState<SplitMode>(initial ? (initial.expense.splitMode === "EQUAL" ? "EQUAL" : "EXACT") : pendingPayload?.split.mode as SplitMode | undefined ?? initialDraft?.splitMode ?? "EQUAL");
  const [splitValues, setSplitValues] = useState<Record<string, string>>(() => Object.fromEntries(
    initial ? initial.shares.map((share) => [share.memberId, minorToInput(share.originalAmountMinor, initial.expense.originalCurrency)])
      : pendingPayload ? pendingPayload.split.entries?.map((entry) => [entry.memberId, entry.value]) ?? [] : Object.entries(initialDraft?.splitValues ?? {}),
  ));
  const [selectedAttachments, setSelectedAttachments] = useState<SelectedLocalAttachment[]>(() => rejected?.attachments.map((attachment) => ({
    id: attachment.id,
    clientAttachmentId: attachment.clientAttachmentId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    blob: attachment.blob,
    file: new File([attachment.blob], attachment.fileName, { type: attachment.mimeType }),
  })) ?? initialDraft?.attachments?.map((file) => ({
    id: `ai-${crypto.randomUUID()}`,
    clientAttachmentId: crypto.randomUUID(),
    fileName: file.name,
    mimeType: file.type,
    blob: file,
    file,
  })) ?? []);
  const [uploadingAttachmentId, setUploadingAttachmentId] = useState<string>();
  const [attachmentToDelete, setAttachmentToDelete] = useState<string>();
  const [guestName, setGuestName] = useState("");
  const [guestError, setGuestError] = useState<string>();
  const [quickError, setQuickError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dismissedAiFields, setDismissedAiFields] = useState<Set<string>>(() => new Set());
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

  function aiState(field: AiExpenseField) {
    if (!initialDraft || dismissedAiFields.has(field)) return undefined;
    return initialDraft.fieldStates[field];
  }

  function markAiFieldEdited(field: AiExpenseField) {
    if (!initialDraft) return;
    setDismissedAiFields((current) => {
      if (current.has(field)) return current;
      const next = new Set(current);
      next.add(field);
      return next;
    });
  }

  function addRecognitionDetailsToNote() {
    const details = initialDraft?.recognitionDetails ?? [];
    if (!details.length) return;
    const next = [note.trim(), ...details].filter(Boolean).join("\n");
    if (next.length > 2000) {
      setQuickError("识别详情超过备注长度，请先编辑后再添加。");
      return;
    }
    markAiFieldEdited("note");
    setNote(next);
    setQuickError(undefined);
  }

  function aiBadge(field: keyof NonNullable<AiExpenseEditorInitialValues["fieldStates"]>) {
    const label = aiSuggestionLabel(aiState(field));
    return label ? <em className="ai-expense-field-badge">{label}</em> : null;
  }

  useEffect(() => {
    if (initialized || activeMembers.length === 0) return;
    const current = activeMembers.some((member) => member.memberId === activity.currentMemberId) ? activity.currentMemberId : activeMembers[0].memberId;
    if (payerIds.length === 0) {
      setPayerIds([current]);
      setPayerDraftIds([current]);
    }
    if (participantIds.length === 0) {
      const allIds = activeMembers.map((member) => member.memberId);
      setParticipantIds(allIds);
      setParticipantDraft(allIds);
    }
    setInitialized(true);
  }, [activeMembers, activity.currentMemberId, initialized, participantIds.length, payerIds.length]);

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
    markAiFieldEdited("payer");
    setQuickError(undefined);
    if (mode === "multiple") {
      const memberId = payerDraftIds[0];
      setPayerDraftValues(memberId && totalMinor !== null ? { [memberId]: minorToInput(totalMinor.toString(), currency) } : {});
    }
    setPayerDraftMode(mode);
    if (mode === "single") setPayerDraftIds((current) => current.slice(0, 1));
  }

  function togglePayer(memberId: string) {
    markAiFieldEdited("payer");
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
    markAiFieldEdited("payer");
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
    if (changed) {
      markAiFieldEdited("participants");
      markAiFieldEdited("split");
    }
    setParticipantIds([...participantDraft]);
    if (changed && splitMode !== "EQUAL") setSplitValues(initialSplitValues(totalMinor, currency, participantDraft, splitMode));
    setQuickError(undefined);
    onViewChange("entry");
  }

  function switchSplitMode(next: SplitMode) {
    if (next !== splitMode) markAiFieldEdited("split");
    setQuickError(undefined);
    setSplitMode(next);
    if (next === "EQUAL") setSplitValues({});
    else setSplitValues(initialSplitValues(totalMinor, currency, participantIds, next));
  }

  function fillRemainder() {
    if (splitMode !== "EXACT" && splitMode !== "PERCENTAGE") return;
    setQuickError(undefined);
    markAiFieldEdited("split");
    setSplitValues((current) => fillSplitRemainder(totalMinor, currency, participantIds, splitMode, current));
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
        markAiFieldEdited("payer");
        if (payerDraftMode === "single") {
          setPayerIds([member.memberId]); setPayerMode("single"); setPaymentValues({}); onViewChange("entry");
        } else {
          setPayerDraftIds((current) => [...new Set([...current, member.memberId])]);
          setPayerDraftValues((current) => ({ ...current, [member.memberId]: "" }));
          onViewChange("payer");
        }
      } else {
        markAiFieldEdited("participants");
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
    markAiFieldEdited("currency");
    markAiFieldEdited("payer");
    markAiFieldEdited("split");
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

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;
    if (initial && offline) {
      setQuickError("当前离线，联网后才能添加图片。");
      return;
    }
    const existingCount = initial?.attachments.length ?? 0;
    if (existingCount + selectedAttachments.length + files.length > 3) {
      setQuickError("每笔账单最多添加三张图片。");
      return;
    }
    const error = validateAttachments([...selectedAttachments.map(({ file }) => file), ...files]);
    if (error) {
      setQuickError(error);
      return;
    }
    const nextAttachments = files.map((file) => ({
      id: crypto.randomUUID(),
      clientAttachmentId: crypto.randomUUID(),
      fileName: file.name,
      mimeType: file.type,
      blob: file,
      file,
    }));
    setQuickError(undefined);
    setSelectedAttachments((current) => [...current, ...nextAttachments]);
    if (!initial) return;

    void (async () => {
      for (const attachment of nextAttachments) {
        setUploadingAttachmentId(attachment.id);
        try {
          await uploadAttachment.mutateAsync({
            file: attachment.file,
            clientAttachmentId: attachment.clientAttachmentId,
          });
          setSelectedAttachments((current) => current.filter((item) => item.id !== attachment.id));
        } catch (error) {
          setQuickError(error instanceof Error ? `图片上传失败：${error.message}` : "图片上传失败，请移除后重新选择。");
        }
      }
      setUploadingAttachmentId(undefined);
    })();
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
        split: splitMode === "EQUAL" ? { mode: splitMode, members: participantIds } : { mode: splitMode, entries: participantIds.map((memberId) => ({ memberId, value: splitMode === "EXACT" ? amountToMinor(splitValues[memberId] ?? "", normalizedCurrency) : parseQuickInteger(splitValues[memberId] ?? "", splitMode === "PERCENTAGE" ? "比例" : "份数").toString() })) },
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
  const attachmentCount = (initial?.attachments.length ?? 0) + selectedAttachments.length;
  const noteSummary = note.trim() || (attachmentCount ? `已添加 ${attachmentCount} 张图片` : "点击添加备注或图片");
  const payerDraftSelection: PayerSelection = payerDraftMode === "single"
    ? { mode: "single", memberId: payerDraftIds[0] ?? "" }
    : { mode: "multiple", memberIds: payerDraftIds, amountInputs: payerDraftValues };
  const payerDraftResolution = resolveQuickPayers(payerDraftSelection, totalMinor, currency);
  const attachmentPicker = (
    <Field label="图片（最多三张）">
      <div className="quick-expense-attachment">
        <input
          id="quick-expense-attachments"
          className="quick-expense-attachment__input"
          aria-label="图片（最多三张）"
          type="file"
          accept={attachmentAccept}
          multiple
          disabled={attachmentCount >= 3 || Boolean(uploadingAttachmentId) || (Boolean(initial) && offline)}
          onChange={handleAttachmentChange}
        />
        <span className="quick-expense-attachment__surface">
          <ImagePlus aria-hidden="true" size={18} />
          <strong>添加图片</strong>
          <small>{uploadingAttachmentId ? "正在上传…" : attachmentCount ? `已添加 ${attachmentCount}/3` : "未添加图片"}</small>
        </span>
      </div>
      {initial && offline ? <small className="quick-expense-field-hint">当前离线，联网后才能添加或删除图片。</small> : null}
      <SelectedAttachmentPreviews
        files={selectedAttachments.map(({ file }) => file)}
        disabled={Boolean(uploadingAttachmentId)}
        onRemove={(index) => setSelectedAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))}
      />
    </Field>
  );
  const renderMemberPicker = (mode: PayerMode) => (
    <>
      <div className="quick-expense-segmented" role="group" aria-label="付款模式"><button type="button" aria-pressed={payerDraftMode === "single"} onClick={() => switchPayerMode("single")}>单人付款</button><button type="button" aria-pressed={payerDraftMode === "multiple"} onClick={() => switchPayerMode("multiple")}>多人付款</button></div>
      <QuickMemberChoiceList members={activeMembers} mode={mode} selectedIds={payerDraftIds} onToggle={togglePayer} paymentValues={mode === "multiple" ? payerDraftValues : undefined} onPaymentChange={(id, value) => { setQuickError(undefined); markAiFieldEdited("payer"); setPayerDraftValues((current) => ({ ...current, [id]: value })); }} canAddGuest={canAddGuest} online={!offline} onAddGuest={() => { setGuestError(undefined); onViewChange("payer-add-guest"); }} />
      {mode === "multiple" ? <QuickExpenseActionDock status={totalMinor === null ? "先填写账单金额，再分配多人付款金额" : <>已分配 {formatMoney(currency, payerDraftResolution.allocatedMinor.toString())} / {formatMoney(currency, totalMinor.toString())}</>}><Button type="button" disabled={!payerDraftResolution.payments} onClick={commitPayers}>完成</Button></QuickExpenseActionDock> : null}
    </>
  );

  return (
    <form ref={formRef} className="quick-expense-form" onSubmit={submit} noValidate>
      {quickError ? <div className="quick-expense-error" role="alert">{quickError}</div> : null}
      {initialDraft ? <section className="ai-expense-guidance" aria-label="智能录入提示">
        <div className="ai-expense-guidance__heading"><span>智能录入草稿</span><small>请检查并修改后再保存</small></div>
        {initialDraft.warnings.length ? <ul>{initialDraft.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul> : null}
        {initialDraft.memberSuggestions.filter((suggestion) => suggestion.matchStatus !== "MATCHED").map((suggestion) => <p key={`${suggestion.mention}-${suggestion.matchStatus}`}><strong>{suggestion.mention}</strong>{suggestion.candidateNames.length ? `：候选成员 ${suggestion.candidateNames.join("、")}。` : "：请在成员选择器中手动选择。"}</p>)}
        {initialDraft.recognitionDetails?.length ? <div className="ai-expense-guidance__details"><p>以下识别详情仅供参考，不会自动写入备注。</p><ul>{initialDraft.recognitionDetails.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul><Button type="button" variant="ghost" onClick={addRecognitionDetailsToNote}>添加到备注</Button></div> : null}
      </section> : null}
      {view === "entry" ? (
        <div className="quick-expense-entry" data-quick-expense-view="entry">
          <div className="quick-expense-amount">
            <button type="button" className="quick-expense-currency" aria-label={`币种：${currency}`} aria-haspopup="dialog" data-overlay-initial-focus={entryFocusTarget === "currency" ? "true" : undefined} onClick={() => { setEntryFocusTarget("currency"); onViewChange("currency"); }}><span>{currency}</span><ChevronRight aria-hidden="true" size={14} /></button>
            <label htmlFor="quick-expense-amount" className="sr-only">金额</label>
            <Input ref={amountRef} id="quick-expense-amount" data-overlay-initial-focus={entryFocusTarget === "amount" ? "true" : undefined} className="quick-expense-amount__input" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); markAiFieldEdited("amount"); markAiFieldEdited("payer"); markAiFieldEdited("split"); clearFieldError("amount"); }} placeholder="0.00" aria-invalid={Boolean(fieldErrors.amount)} aria-describedby={fieldErrors.amount ? "quick-expense-amount-error" : undefined} required />
            <small>金额 {aiBadge("amount")}</small>
            {fieldErrors.amount ? <small id="quick-expense-amount-error" className="quick-expense-field-error" role="alert">{fieldErrors.amount}</small> : null}
          </div>
          <div className="quick-expense-grid">
            <QuickValueButton label="分类" value={selectedCategory[1]} initialFocus={entryFocusTarget === "category"} onClick={() => { setEntryFocusTarget("category"); onViewChange("category"); }}><img className="quick-expense-value-button__image" src={`/expense-categories/${selectedCategory[2]}.webp`} width={34} height={34} alt="" /></QuickValueButton>
            <label className="quick-expense-inline-field"><span>用途 {aiBadge("title")}</span><Input ref={titleRef} aria-label="用途" value={title} onChange={(event) => { setTitle(event.target.value); markAiFieldEdited("title"); clearFieldError("title"); }} placeholder="例如：晚餐" maxLength={120} aria-invalid={Boolean(fieldErrors.title)} aria-describedby={fieldErrors.title ? "quick-expense-title-error" : undefined} required />{fieldErrors.title ? <small id="quick-expense-title-error" className="quick-expense-error" role="alert">{fieldErrors.title}</small> : null}</label>
            <QuickFieldButton label="付款人" value={selectedPayerLabel || "请选择"} initialFocus={entryFocusTarget === "payer"} onClick={openPayer}><span className="quick-expense-avatar-stack" aria-hidden="true">{payerIds.slice(0, 2).map((id) => <MemberAvatar key={id} memberId={id} {...memberAvatarImage(id, activeMembers)} displayName={memberName(id, activeMembers)} avatarPreset={memberAvatarPreset(id, activeMembers)} size="sm" />)}</span></QuickFieldButton>
            <QuickTimePicker value={occurredAt} onChange={(value) => { setOccurredAt(value); markAiFieldEdited("occurredAt"); if (exchangeRateKind === "PROVIDER" || exchangeRateKind === "CACHE") { setExchangeRate(""); setExchangeRateKind("MANUAL"); setExchangeRateReferenceDate(null); setExchangeRateProvider(null); } }} />
            <div className="quick-expense-participants"><QuickFieldButton label="参与人" value={participantIds.length ? `${participantIds.length} 人` : "请选择"} initialFocus={entryFocusTarget === "participants"} onClick={openParticipants}><span className="quick-expense-avatar-stack" aria-hidden="true">{participantIds.slice(0, 2).map((id) => <MemberAvatar key={id} memberId={id} {...memberAvatarImage(id, activeMembers)} displayName={memberName(id, activeMembers)} avatarPreset={memberAvatarPreset(id, activeMembers)} size="sm" />)}</span></QuickFieldButton>{fieldErrors.participants ? <small className="quick-expense-error" role="alert">{fieldErrors.participants}</small> : null}</div>
            <QuickValueButton label="分摊设置" value={selectedSplitLabel} initialFocus={entryFocusTarget === "split"} onClick={() => { setEntryFocusTarget("split"); onViewChange("split"); }} />
          </div>
            <QuickFieldButton label="备注" value={noteSummary} initialFocus={entryFocusTarget === "note"} onClick={() => { setEntryFocusTarget("note"); onViewChange("note"); }} />
          {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
          {mutation.error instanceof ApiRequestError && mutation.error.status === 409 ? <div className="notice">服务器版本已更新。当前表单仍保留，请返回查看最新账单后再决定。</div> : null}
          <QuickExpenseActionDock><Button type="submit" className="quick-expense-submit" busy={mutation.isPending}>{rejected ? "修改后重试" : "保存"}</Button></QuickExpenseActionDock>
        </div>
      ) : view === "payer" ? <div className="quick-expense-subview" data-quick-expense-view="payer">{renderMemberPicker(payerDraftMode)}</div>
        : view === "participants" ? <div className="quick-expense-subview" data-quick-expense-view="participants"><QuickMemberChoiceList members={activeMembers} mode="multiple" selectedIds={participantDraft} onToggle={(id) => { setQuickError(undefined); markAiFieldEdited("participants"); setParticipantDraft((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }} canAddGuest={canAddGuest} online={!offline} onAddGuest={() => { setGuestError(undefined); onViewChange("participants-add-guest"); }} /><QuickExpenseActionDock><Button type="button" disabled={!participantDraft.length} onClick={commitParticipants}>完成</Button></QuickExpenseActionDock></div>
        : view === "payer-add-guest" || view === "participants-add-guest" ? <div className="quick-expense-subview quick-expense-guest-view" data-quick-expense-view={view}><label className="field"><span className="field__label">临时成员昵称</span><Input data-overlay-initial-focus value={guestName} maxLength={40} autoFocus required onChange={(event) => setGuestName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitGuest(); } }} /></label>{guestError ? <p className="quick-expense-error" role="alert">{guestError}</p> : null}<QuickExpenseActionDock><Button type="button" disabled={!guestName.trim() || createGuest.isPending} busy={createGuest.isPending} onClick={() => void submitGuest()}>确认添加</Button></QuickExpenseActionDock></div>
        : view === "category" ? <div className="quick-expense-subview" data-quick-expense-view="category"><div className="quick-category-grid" role="radiogroup" aria-label="分类">{categories.map(([value, label, image]) => <button key={value} type="button" role="radio" aria-checked={category === value} onClick={() => { setCategory(value); markAiFieldEdited("category"); onViewChange("entry"); }}><img src={`/expense-categories/${image}.webp`} width={44} height={44} alt="" /><span>{label}</span>{category === value ? <Check aria-hidden="true" size={15} /> : null}</button>)}</div></div>
        : view === "currency" ? <div className="quick-expense-subview" data-quick-expense-view="currency"><label className="quick-currency-search"><span className="sr-only">搜索币种</span><Input data-overlay-initial-focus placeholder="搜索币种" value={currencySearchDraft} onChange={(event) => setCurrencySearchDraft(event.target.value)} /></label><CurrencyQuickList value={currency} search={currencySearchDraft} onSelect={selectCurrency} /></div>
        : view === "currency-rate" ? <div className="quick-expense-subview" data-quick-expense-view="currency-rate"><Field label={`汇率（1 ${currency} = N ${activity.baseCurrency}）`}><div className="exchange-rate-input"><Input data-overlay-initial-focus inputMode="decimal" value={exchangeRate} onChange={(event) => { setQuickError(undefined); setExchangeRate(event.target.value); setExchangeRateKind("MANUAL"); setExchangeRateReferenceDate(null); setExchangeRateProvider(null); }} placeholder="例如 7.25" required /><Button type="button" variant="secondary" disabled={rateSuggestion.isPending} onClick={() => void requestReferenceRate()}>{rateSuggestion.isPending ? "正在获取…" : "获取参考汇率"}</Button></div>{exchangeRateReferenceDate ? <small>{exchangeRateKind === "CACHE" ? "缓存参考汇率" : exchangeRateProvider === "FRANKFURTER" ? "Frankfurter 参考汇率" : "参考汇率"} · {exchangeRateReferenceDate}</small> : null}</Field><QuickExpenseActionDock><Button type="button" disabled={!exchangeRate.trim()} onClick={() => onViewChange("entry")}>完成</Button></QuickExpenseActionDock></div>
        : view === "note" ? <div className="quick-expense-subview quick-expense-note-view" data-quick-expense-view="note"><Field label="备注"><Textarea data-overlay-initial-focus value={note} onChange={(event) => { markAiFieldEdited("note"); setNote(event.target.value); }} maxLength={2000} rows={4} /></Field>{initial ? <ExpenseAttachments compact activityId={activity.activityId} expenseId={initial.expense.expenseId} attachments={initial.attachments} deletingAttachmentId={deleteAttachment.variables} onDelete={offline ? undefined : setAttachmentToDelete} /> : null}{attachmentPicker}{deleteAttachment.error ? <ErrorNotice error={deleteAttachment.error} /> : null}<QuickExpenseActionDock><Button type="button" onClick={() => onViewChange("entry")}>完成</Button></QuickExpenseActionDock><ConfirmDialog open={Boolean(attachmentToDelete)} title="删除图片" message="删除后这张图片将从账单中移除，此操作会立即生效。确定继续吗？" confirmLabel="确认删除" busy={deleteAttachment.isPending} onConfirm={() => { if (!attachmentToDelete) return; void deleteAttachment.mutateAsync(attachmentToDelete).then(() => setAttachmentToDelete(undefined)).catch(() => undefined); }} onCancel={() => setAttachmentToDelete(undefined)} /></div>
        : <div className="quick-expense-subview" data-quick-expense-view="split">
          <fieldset className="quick-split-modes" role="radiogroup" aria-label="分摊方式">{quickSplitModes.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={splitMode === value} onClick={() => switchSplitMode(value)}>{label}</button>)}</fieldset>
          <div className="quick-split-summary" aria-live="polite"><QuickSplitSummary currency={currency} memberIds={participantIds} mode={splitMode} values={splitValues} totalMinor={totalMinor} onFillRemainder={fillRemainder} /></div>
          <div className="quick-split-list" role="list" aria-label="参与成员分摊">
            <div className="quick-split-list__rows">{participantIds.map((memberId) => {
              const name = memberName(memberId, activeMembers);
              const allocation = splitPreview.allocations.find((row) => row.memberId === memberId);
              const updateSplitValue = (value: string) => {
                setQuickError(undefined);
                markAiFieldEdited("split");
                setSplitValues((current) => ({ ...current, [memberId]: value }));
              };
              return <div className={`quick-split-row${splitMode === "EQUAL" ? " quick-split-row--equal" : ""}`} key={memberId}>
                <MemberAvatar memberId={memberId} {...memberAvatarImage(memberId, activeMembers)} displayName={name} avatarPreset={memberAvatarPreset(memberId, activeMembers)} size="sm" />
                <span className="quick-split-row__name">{name}</span>
                {splitMode === "WEIGHT"
                  ? <div className="quick-split-row__control"><QuickIntegerStepper name={name} unit="份数" value={splitValues[memberId] ?? "1"} onChange={updateSplitValue} /></div>
                  : splitMode === "PERCENTAGE"
                    ? <div className="quick-split-row__control"><QuickIntegerStepper name={name} unit="比例" value={splitValues[memberId] ?? "0"} max={100n} onChange={updateSplitValue} /></div>
                    : splitMode === "EXACT"
                      ? <div className="quick-split-row__control"><Input inputMode="decimal" aria-label={`${name}${quickSplitModes.find(([value]) => value === splitMode)?.[1]}`} value={splitValues[memberId] ?? ""} placeholder="金额" onChange={(event) => updateSplitValue(event.target.value)} /></div>
                      : null}
                <strong className="quick-split-row__result">{allocation ? formatMoney(currency, allocation.amountMinor.toString()) : "待完成"}</strong>
              </div>;
            })}</div>
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

/** 只读账单沿用“记一笔 / 修改账单”的字段名称和顺序，只把输入控件替换为事实展示。 */
function ReadonlyExpenseDetail({ aggregate, memberData, activity, offline }: { aggregate: ExpenseAggregate; memberData: readonly ActivityMember[]; activity: ReturnType<typeof useWorkspace>["activity"]; offline: boolean }) {
  const category = categories.find(([value]) => value === aggregate.expense.category);
  const splitModeLabel = splitModes.find(([value]) => value === aggregate.expense.splitMode)?.[1] ?? aggregate.expense.splitMode;
  const isForeignCurrency = aggregate.expense.originalCurrency !== aggregate.expense.baseCurrency;
  const memberDisplayName = (memberId: string) => memberName(memberId, memberData);
  const memberAvatar = (memberId: string) => memberAvatarPreset(memberId, memberData);
  const memberRows = (items: readonly { factId: string; memberId: string; originalAmountMinor: string }[], showAmount: boolean) => items.length
    ? <div className="expense-detail-member-list">{items.map((item) => <div className="expense-detail-member-row" key={item.factId}><MemberAvatar memberId={item.memberId} {...memberAvatarImage(item.memberId, memberData)} displayName={memberDisplayName(item.memberId)} avatarPreset={memberAvatar(item.memberId)} size="sm" /><span>{memberDisplayName(item.memberId)}</span>{showAmount ? <Money value={formatMoney(aggregate.expense.originalCurrency, item.originalAmountMinor)} /> : null}</div>)}</div>
    : <span className="expense-detail-empty">无</span>;
  return <section className="standalone-detail-page" aria-label="账单详情">
    {offline ? <div className="notice" role="status"><Info aria-hidden="true" size={18} /><span>当前离线，账单使用最近一次同步的只读快照。</span></div> : null}
    <section className="expense-detail-summary" aria-label="金额">
      <small>金额</small>
      <div className="expense-detail-summary__amount"><span>{aggregate.expense.originalCurrency}</span><Money value={formatMoney(aggregate.expense.originalCurrency, aggregate.expense.originalAmountMinor)} /></div>
      {isForeignCurrency ? <div className="expense-detail-summary__conversion"><span>折算后 {formatMoney(aggregate.expense.baseCurrency, aggregate.expense.baseAmountMinor)}</span><small>汇率 {aggregate.expense.exchangeRate}（1 {aggregate.expense.originalCurrency} = N {aggregate.expense.baseCurrency}）</small>{aggregate.expense.exchangeRateReferenceDate ? <small>{aggregate.expense.exchangeRateKind === "CACHE" ? "缓存参考汇率" : aggregate.expense.exchangeRateProvider === "FRANKFURTER" ? "Frankfurter 参考汇率" : "参考汇率"} · {aggregate.expense.exchangeRateReferenceDate}</small> : null}</div> : null}
    </section>
    <ExpenseSettlementProgressSection progress={aggregate.settlementProgress} members={memberData} />
    <div className="expense-detail-fields">
      <dl>
        <div><dt>分类</dt><dd><span className="expense-detail-category">{category ? <img src={`/expense-categories/${category[2]}.webp`} width="34" height="34" alt="" /> : null}<span>{category?.[1] ?? "其他"}</span></span></dd></div>
        <div><dt>用途</dt><dd>{aggregate.expense.title}</dd></div>
        <div><dt>付款人</dt><dd>{memberRows(aggregate.payments, true)}</dd></div>
        <div><dt>时间</dt><dd><time dateTime={aggregate.expense.occurredAt}>{new Date(aggregate.expense.occurredAt).toLocaleString("zh-CN")}</time></dd></div>
        <div><dt>参与人</dt><dd>{memberRows(aggregate.shares, false)}</dd></div>
        <div><dt>分摊设置</dt><dd><strong className="expense-detail-split-mode">{splitModeLabel}</strong>{memberRows(aggregate.shares, true)}</dd></div>
        <div><dt>备注</dt><dd>{aggregate.expense.note || <span className="expense-detail-empty">无</span>}</dd></div>
      </dl>
    </div>
    <ExpenseAttachments activityId={activity.activityId} expenseId={aggregate.expense.expenseId} attachments={aggregate.attachments} />
  </section>;
}

export function ExpenseDetailPage() {
  const { expenseId = "" } = useParams();
  const [searchParams] = useSearchParams();
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
  // 统计中的账单下钻只查看既有事实，保持分析与编辑两条入口的语义独立。
  if (activity.status !== "ACTIVE" || offline || searchParams.get("view") === "readonly") {
    return <ReadonlyExpenseDetail aggregate={aggregate} memberData={memberData} activity={activity} offline={offline} />;
  }
  return (
    <div className="workspace-page">
      <div className="detail-toolbar"><Link className="inline-back" to={`/activities/${activity.activityId}`}><ArrowLeft aria-hidden="true" size={18} /> 返回流水</Link><Button variant="danger" busy={remove.isPending} onClick={() => setDeleteOpen(true)}><Trash2 aria-hidden="true" size={17} /> 删除</Button></div>
      {remove.error ? <ErrorNotice error={remove.error} /> : null}
      <ConfirmDialog open={deleteOpen} title="删除账单" message="删除后账本会立即重新计算，这笔账单无法恢复。确定继续吗？" confirmLabel="确认删除" busy={remove.isPending} onConfirm={() => { void remove.mutateAsync(expense.data!.expense.version).then(() => { setDeleteOpen(false); navigate(`/activities/${activity.activityId}`); }).catch(() => undefined); }} onCancel={() => setDeleteOpen(false)} />
      <ExpenseSettlementProgressSection progress={aggregate.settlementProgress} members={memberData} />
      <RoutedExpenseEditor initial={aggregate} />
    </div>
  );
}
