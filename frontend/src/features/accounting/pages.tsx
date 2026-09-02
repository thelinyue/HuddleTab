import { ArrowLeft, ArrowRight, Check, ChevronRight, Filter, ImageDown, Info, Plus, ReceiptText, Trash2, UsersRound, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiRequestError } from "../../api/error";
import { MemberAvatar } from "../../components/member-avatar";
import { Button, EmptyState, ErrorNotice, Field, Input, LoadingState, Money, Select, Textarea } from "../../components/ui";
import { amountToMinor, formatMoney, minorToInput, normalizeCurrency } from "../../domain-preview/money";
import { useMembersQuery } from "../activities/api";
import { useWorkspace } from "../activities/pages";
import {
  type ExpenseAggregate,
  type ExpenseDraft,
  type Settlement,
  useCreateExpenseMutation,
  useCreateSettlementMutation,
  useDeleteAttachmentMutation,
  useDeleteExpenseMutation,
  useExpenseQuery,
  useExpensesQuery,
  useLedgerQuery,
  useRecommendationsQuery,
  useSettlementsQuery,
  useUpdateExpenseMutation,
  useUpdateSettlementMutation,
  useVoidSettlementMutation,
} from "./api";
import { usePendingExpenseMutations } from "./expense-queue-sync";

const categories = [
  ["FOOD", "餐饮", "food"], ["TRANSPORT", "交通", "transport"], ["LODGING", "住宿", "lodging"],
  ["TICKET", "门票", "ticket"], ["SHOPPING", "购物", "shopping"], ["ENTERTAINMENT", "娱乐", "entertainment"], ["OTHER", "其他", "other"],
] as const;

const splitModes = [
  ["EQUAL", "均摊"], ["EXACT", "按金额"], ["PERCENTAGE", "按比例"], ["WEIGHT", "按权重"],
] as const;

const attachmentAccept =
  ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const attachmentMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxAttachmentBytes = 10 * 1024 * 1024;

function attachmentUrl(
  activityId: string,
  expenseId: string,
  attachmentId: string,
) {
  return `/api/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function validateAttachments(files: readonly File[]) {
  if (files.length > 3) return "每笔账单最多添加三张附件。";
  if (files.some((file) => !attachmentMimeTypes.has(file.type))) {
    return "仅支持 JPEG、PNG 或 WebP 图片。";
  }
  if (files.some((file) => file.size > maxAttachmentBytes)) {
    return "单张附件不能超过 10 MiB。";
  }
}

/** 缩略图始终请求受权下载路由，不接触本地 Blob URL 或服务端存储路径。 */
function ExpenseAttachments({
  activityId,
  expenseId,
  attachments,
  deletingAttachmentId,
  onDelete,
}: {
  activityId: string;
  expenseId: string;
  attachments: ExpenseAggregate["attachments"];
  deletingAttachmentId?: string;
  onDelete?: (attachmentId: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <section className="expense-attachments" aria-labelledby="expense-attachments-heading">
      <h2 id="expense-attachments-heading">附件</h2>
      <div className="expense-attachments__grid">
        {attachments.map((attachment, index) => {
          const href = attachmentUrl(activityId, expenseId, attachment.id);
          return (
            <div className="expense-attachments__item" key={attachment.id}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={`查看附件 ${index + 1}`}
              >
                <img
                  src={href}
                  alt={`附件 ${index + 1}`}
                  loading="lazy"
                  width={attachment.width}
                  height={attachment.height}
                />
              </a>
              {onDelete ? <button
                type="button"
                className="expense-attachments__delete"
                aria-label={`删除附件 ${index + 1}`}
                title={`删除附件 ${index + 1}`}
                disabled={deletingAttachmentId === attachment.id}
                onClick={() => onDelete(attachment.id)}
              ><Trash2 aria-hidden="true" size={16} /></button> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function localDateTime(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function memberName(memberId: string, members: ReturnType<typeof useMembersQuery>["data"]): string {
  return members?.find((member) => member.memberId === memberId)?.displayName ?? "未知成员";
}

function calendarDate(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

/** 接口顺序不是页面契约；流水在展示边界按发生时间倒序并稳定合并同一公历日。 */
export function groupExpensesByDate(expenses: readonly ExpenseAggregate[], timeZone: string) {
  const sorted = [...expenses].sort((left, right) =>
    right.expense.occurredAt.localeCompare(left.expense.occurredAt),
  );
  const groups = new Map<string, ExpenseAggregate[]>();
  for (const expense of sorted) {
    const date = calendarDate(expense.expense.occurredAt, timeZone);
    groups.set(date, [...(groups.get(date) ?? []), expense]);
  }
  return [...groups].map(([date, groupedExpenses]) => ({ date, expenses: groupedExpenses }));
}

function AccountingOverlay({ open, title, onClose, children, className = "" }: { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string }) {
  if (!open) return null;
  return (
    <div className={`form-overlay ${className}`} role="presentation">
      <button type="button" className="form-overlay__scrim" aria-label={`关闭${title}`} onClick={onClose} />
      <section className="form-overlay__sheet" role="dialog" aria-modal="true" aria-labelledby="accounting-overlay-title">
        <header className="form-overlay__header"><h2 id="accounting-overlay-title">{title}</h2><button className="icon-button" type="button" aria-label={`关闭${title}`} onClick={onClose}><X aria-hidden="true" size={20} /></button></header>
        <div className="form-overlay__body">{children}</div>
      </section>
    </div>
  );
}

function dateHeading(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

export function ExpenseFeedPage() {
  const { session, activity } = useWorkspace();
  const expenses = useExpensesQuery(session.userId, activity.activityId);
  const pendingExpenses = usePendingExpenseMutations(
    session.userId,
    activity.activityId,
  );
  const members = useMembersQuery(session.userId, activity.activityId);
  const [entryOpen, setEntryOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");

  if (expenses.isPending || members.isPending) return <LoadingState label="正在读取流水…" />;
  if (expenses.error || members.error) return <ErrorNotice error={expenses.error ?? members.error} />;

  const allExpenses = expenses.data ?? [];
  const filteredExpenses = allExpenses.filter(({ expense }) =>
    (!query.trim() || `${expense.title} ${expense.note ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) &&
    (!category || expense.category === category),
  );
  const localRecords = pendingExpenses.data ?? [];
  const filteredPending = localRecords.filter(({ status, payload }) =>
    status !== "SYNCED" &&
    (!query.trim() || `${payload.title} ${payload.note ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) &&
    (!category || payload.category === category),
  );
  const groups = groupExpensesByDate(filteredExpenses, Intl.DateTimeFormat().resolvedOptions().timeZone);
  const total = allExpenses.reduce((sum, item) => sum + BigInt(item.expense.baseAmountMinor), 0n);
  const activeMemberCount = members.data?.filter((member) => member.status === "ACTIVE").length ?? 0;
  const average = activeMemberCount ? (total + BigInt(activeMemberCount) / 2n) / BigInt(activeMemberCount) : 0n;
  const foreignTotals = new Map<string, bigint>();
  // 生命周期只约束本领域写面：结束后账单只读，但不会反推活动管理权限。
  const expenseWritable = activity.status === "ACTIVE";
  for (const item of allExpenses) {
    if (item.expense.originalCurrency === activity.baseCurrency) continue;
    foreignTotals.set(item.expense.originalCurrency, (foreignTotals.get(item.expense.originalCurrency) ?? 0n) + BigInt(item.expense.originalAmountMinor));
  }

  return (
    <div className="workspace-page expense-feed-page">
      <section className="expense-summary" aria-label="消费摘要">
        <p>总消费</p>
        <Money value={formatMoney(activity.baseCurrency, total.toString())} />
        {[...foreignTotals].length ? <p className="expense-summary__foreign">其中外币消费 {[...foreignTotals].map(([currencyCode, amount]) => formatMoney(currencyCode, amount.toString())).join(" · ")} · 已折算</p> : null}
        <p className="expense-summary__meta">{allExpenses.length} 笔消费 · 人均消费 <strong>{formatMoney(activity.baseCurrency, average.toString())}</strong> <Info aria-label="人均消费仅为统计平均值" size={14} /></p>
      </section>

      <section className="expense-feed-section" aria-labelledby="expense-feed-heading">
        <header><h2 id="expense-feed-heading">全部流水</h2><Button variant="ghost" onClick={() => setFilterOpen(true)}><Filter aria-hidden="true" size={16} /> 筛选{query || category ? " · 已启用" : ""}</Button></header>
        {pendingExpenses.error ? <ErrorNotice error={pendingExpenses.error} /> : null}
        {filteredPending.length ? (
          <section className="expense-date-group" aria-labelledby="pending-expenses-heading">
            <h3 id="pending-expenses-heading">待同步</h3>
            <div className="expense-list">
              {filteredPending.map((record) => {
                const categoryInfo = categories.find(([value]) => value === record.payload.category) ?? categories.at(-1)!;
                const payerNames = record.payload.payments.map((payment) => memberName(payment.memberId, members.data)).join("、");
                const shareCount = record.payload.split.members?.length ?? record.payload.split.entries?.length ?? 0;
                const statusLabel = record.status === "SYNCING"
                  ? "正在同步"
                  : record.status === "RETRYABLE"
                    ? "同步失败，将稍后重试"
                    : record.status === "REJECTED"
                      ? "需要修改"
                      : "等待同步";
                return (
                  <div key={record.id} className="expense-row expense-row--pending">
                    <span className="category-illustration"><img src={`/expense-categories/${categoryInfo[2]}.webp`} width={44} height={44} alt="" /></span>
                    <span className="expense-row__content"><strong>{record.payload.title}</strong><small>{payerNames || "未知付款人"} 付款 · {shareCount}人 · {statusLabel}</small>{record.lastError ? <small>{record.lastError.message}</small> : null}</span>
                    <span className="expense-row__amount"><Money value={formatMoney(record.payload.originalCurrency, record.payload.originalAmountMinor)} /><small>{new Date(record.payload.occurredAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        {groups.length ? groups.map((group) => (
          <section className="expense-date-group" key={group.date} aria-labelledby={`date-${group.date}`}>
            <h3 id={`date-${group.date}`}>{dateHeading(group.date)}</h3>
            <div className="expense-list">
              {group.expenses.map(({ expense, payments, shares }) => {
                const categoryInfo = categories.find(([value]) => value === expense.category) ?? categories.at(-1)!;
                const payerNames = payments.map((payment) => memberName(payment.memberId, members.data)).join("、");
                const local = localRecords.find((record) =>
                  record.status === "SYNCED" &&
                  record.serverExpenseId === expense.expenseId,
                );
                const attachmentMessage = local?.attachments.find(
                  (attachment) => attachment.status === "REJECTED",
                )?.lastError?.message ?? (local?.attachments.some((attachment) =>
                  ["PENDING", "SYNCING", "RETRYABLE"].includes(attachment.status)
                ) ? "附件等待同步" : undefined);
                return (
                  <Link key={expense.expenseId} to={`/activities/${activity.activityId}/expenses/${expense.expenseId}`} className="expense-row">
                    <span className="category-illustration"><img src={`/expense-categories/${categoryInfo[2]}.webp`} width={44} height={44} alt="" /></span>
                    <span className="expense-row__content"><strong>{expense.title}</strong><small>{payerNames || "未知付款人"} 付款 · {shares.length}人</small>{attachmentMessage ? <small>{attachmentMessage}</small> : null}</span>
                    <span className="expense-row__amount"><Money value={formatMoney(expense.originalCurrency, expense.originalAmountMinor)} /><small>{new Date(expense.occurredAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></span>
                  </Link>
                );
              })}
            </div>
          </section>
        )) : <EmptyState icon={<ReceiptText size={28} />} title={allExpenses.length ? "没有符合条件的流水" : "还没有流水"} description={allExpenses.length ? "调整筛选条件后再试。" : "记录第一笔共同支出，账本会自动计算成员余额。"} />}
      </section>

      {expenseWritable ? <button className="quick-expense-trigger" type="button" aria-label="快速记账" onClick={() => setEntryOpen(true)}><Plus aria-hidden="true" size={24} /></button> : null}
      <AccountingOverlay open={expenseWritable && entryOpen} title="记一笔消费" onClose={() => setEntryOpen(false)} className="quick-expense-overlay"><ExpenseEditor onSaved={() => setEntryOpen(false)} onCancel={() => setEntryOpen(false)} compact /></AccountingOverlay>
      <AccountingOverlay open={filterOpen} title="筛选流水" onClose={() => setFilterOpen(false)}>
        <div className="form-stack"><Field label="搜索"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题或备注" autoFocus /></Field><Field label="分类"><Select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field><Button onClick={() => setFilterOpen(false)}>应用筛选</Button></div>
      </AccountingOverlay>
    </div>
  );
}

type SplitMode = "EQUAL" | "EXACT" | "PERCENTAGE" | "WEIGHT";

export function ExpenseEditor({ initial, onSaved, onCancel, compact = false }: { initial?: ExpenseAggregate; onSaved?: () => void; onCancel?: () => void; compact?: boolean }) {
  const { session, activity } = useWorkspace();
  const members = useMembersQuery(session.userId, activity.activityId);
  const navigate = useNavigate();
  const expenseId = initial?.expense.expenseId;
  const create = useCreateExpenseMutation(session.userId, activity.activityId);
  const update = useUpdateExpenseMutation(session.userId, activity.activityId, expenseId ?? "");
  const deleteAttachment = useDeleteAttachmentMutation(session.userId, activity.activityId, expenseId ?? "");
  const [title, setTitle] = useState(initial?.expense.title ?? "");
  const [category, setCategory] = useState(initial?.expense.category ?? "FOOD");
  const [note, setNote] = useState(initial?.expense.note ?? "");
  const [occurredAt, setOccurredAt] = useState(localDateTime(initial?.expense.occurredAt));
  const [currency, setCurrency] = useState(initial?.expense.originalCurrency ?? activity.baseCurrency);
  const [amount, setAmount] = useState(initial ? minorToInput(initial.expense.originalAmountMinor, initial.expense.originalCurrency) : "");
  const [exchangeRate, setExchangeRate] = useState(initial?.expense.exchangeRate ?? "");
  const [splitMode, setSplitMode] = useState<SplitMode>(initial ? "EXACT" : "EQUAL");
  const [selectedMembers, setSelectedMembers] = useState<Record<string, boolean>>(() => Object.fromEntries((initial?.shares ?? []).map((share) => [share.memberId, true])));
  const [splitValues, setSplitValues] = useState<Record<string, string>>(() => Object.fromEntries((initial?.shares ?? []).map((share) => [share.memberId, minorToInput(share.originalAmountMinor, initial!.expense.originalCurrency)])));
  const [paymentValues, setPaymentValues] = useState<Record<string, string>>(() => Object.fromEntries((initial?.payments ?? []).map((payment) => [payment.memberId, minorToInput(payment.originalAmountMinor, initial!.expense.originalCurrency)])));
  const [files, setFiles] = useState<readonly File[]>([]);
  const [localError, setLocalError] = useState<string>();
  const mutation = expenseId ? update : create;

  const activeMembers = members.data?.filter((member) => member.status === "ACTIVE") ?? [];
  const selectedIds = activeMembers.filter((member) => selectedMembers[member.memberId] ?? !initial).map((member) => member.memberId);

  function updateRecord(setter: React.Dispatch<React.SetStateAction<Record<string, string>>>, id: string, value: string) {
    setter((current) => ({ ...current, [id]: value }));
  }

  function selectAttachments(nextFiles: FileList | null) {
    const selected = Array.from(nextFiles ?? []);
    const error = validateAttachments(selected);
    if (error) {
      setLocalError(error);
      return;
    }
    setLocalError(undefined);
    setFiles(selected);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(undefined);
    try {
      const normalizedCurrency = normalizeCurrency(currency);
      const totalMinor = amountToMinor(amount, normalizedCurrency);
      const paymentEntries = activeMembers.flatMap((member) => {
        const value = paymentValues[member.memberId]?.trim();
        return value ? [{ memberId: member.memberId, amountMinor: amountToMinor(value, normalizedCurrency) }] : [];
      });
      const payments = paymentEntries.length ? paymentEntries : [{ memberId: activity.currentMemberId, amountMinor: totalMinor }];
      const split = splitMode === "EQUAL"
        ? { mode: splitMode, members: selectedIds }
        : {
            mode: splitMode,
            entries: selectedIds.map((memberId) => ({
              memberId,
              value: splitMode === "EXACT" ? amountToMinor(splitValues[memberId] ?? "", normalizedCurrency) : (splitValues[memberId] ?? "").trim(),
            })),
          };
      const draft: ExpenseDraft = {
        title,
        category,
        note: note.trim() || null,
        occurredAt: new Date(occurredAt).toISOString(),
        clientMutationId: initial?.expense.clientMutationId ?? crypto.randomUUID(),
        originalCurrency: normalizedCurrency,
        originalAmountMinor: totalMinor,
        exchangeRateKind: normalizedCurrency === activity.baseCurrency ? "IDENTITY" : "MANUAL",
        exchangeRate: normalizedCurrency === activity.baseCurrency ? "1" : exchangeRate.trim(),
        payments,
        split,
      };
      if (initial) await update.mutateAsync({ ...draft, version: initial.expense.version });
      else await create.mutateAsync({ input: draft, files });
      if (onSaved) onSaved();
      else navigate(`/activities/${activity.activityId}`);
    } catch (error) {
      if (error instanceof ApiRequestError) return;
      setLocalError(error instanceof Error ? error.message : "账单输入不正确。");
    }
  }

  if (members.isPending) return <LoadingState label="正在准备账单…" />;
  if (members.error) return <ErrorNotice error={members.error} />;

  return (
    <form className={`expense-editor${compact ? " expense-editor--compact" : ""}`} onSubmit={submit}>
      <section className={`${compact ? "" : "panel "}form-section`}>
        <header className="panel__header"><div><p className="eyebrow">基本信息</p><h2>{initial ? "修改账单" : "记一笔支出"}</h2></div></header>
        <div className="form-grid form-grid--two">
          <Field label="金额"><div className="amount-input"><span>{currency}</span><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required autoFocus /></div></Field>
          <Field label="币种"><Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} required /></Field>
          {currency.trim().toUpperCase() !== activity.baseCurrency ? <Field label={`汇率（1 ${currency || "原币"} = N ${activity.baseCurrency}）`}><Input inputMode="decimal" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} required placeholder="例如 7.25" /></Field> : null}
          <Field label="标题"><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></Field>
          <Field label="分类"><Select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>
          <Field label="发生时间"><Input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required /></Field>
        </div>
        <Field label="备注"><Textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={3} /></Field>
        {!initial ? <Field label="附件（最多三张）"><input className="input attachment-input" type="file" accept={attachmentAccept} multiple onChange={(event) => selectAttachments(event.target.files)} />{files.length ? <small className="attachment-selection">已选择 {files.length} 张：{files.map((file) => file.name).join("、")}</small> : null}</Field> : null}
      </section>

      {initial ? <ExpenseAttachments activityId={activity.activityId} expenseId={initial.expense.expenseId} attachments={initial.attachments} deletingAttachmentId={deleteAttachment.variables} onDelete={(attachmentId) => { if (window.confirm("确定删除这张附件吗？此操作会立即生效。")) void deleteAttachment.mutateAsync(attachmentId).catch(() => undefined); }} /> : null}
      {deleteAttachment.error ? <ErrorNotice error={deleteAttachment.error} /> : null}

      <section className={`${compact ? "" : "panel "}form-section`}>
        <header className="panel__header"><div><p className="eyebrow">付款事实</p><h2>谁先付了钱</h2><p>留空时默认由你支付全部金额；多人付款可分别填写。</p></div></header>
        <div className="member-input-list">
          {activeMembers.map((member) => <label key={member.memberId}><MemberAvatar memberId={member.memberId} displayName={member.displayName} size="sm" /><span>{member.displayName}</span><Input inputMode="decimal" value={paymentValues[member.memberId] ?? ""} onChange={(event) => updateRecord(setPaymentValues, member.memberId, event.target.value)} placeholder="0" aria-label={`${member.displayName}支付金额`} /></label>)}
        </div>
      </section>

      <section className={`${compact ? "" : "panel "}form-section`}>
        <header className="panel__header"><div><p className="eyebrow">分摊方式</p><h2>这笔钱该怎么分</h2></div></header>
        <div className="segmented segmented--four" role="group" aria-label="分摊方式">{splitModes.map(([value, label]) => <button type="button" key={value} aria-pressed={splitMode === value} onClick={() => setSplitMode(value)}>{label}</button>)}</div>
        <div className="member-input-list">
          {activeMembers.map((member) => {
            const selected = selectedMembers[member.memberId] ?? !initial;
            return (
              <div className="split-row" key={member.memberId}>
                <label className="member-check"><input type="checkbox" checked={selected} onChange={(event) => setSelectedMembers((current) => ({ ...current, [member.memberId]: event.target.checked }))} /><MemberAvatar memberId={member.memberId} displayName={member.displayName} size="sm" /><span>{member.displayName}</span></label>
                {splitMode !== "EQUAL" && selected ? <Input inputMode="decimal" value={splitValues[member.memberId] ?? ""} onChange={(event) => updateRecord(setSplitValues, member.memberId, event.target.value)} placeholder={splitMode === "EXACT" ? "金额" : splitMode === "PERCENTAGE" ? "百分比" : "权重"} aria-label={`${member.displayName}${splitModes.find(([value]) => value === splitMode)?.[1]}`} /> : null}
              </div>
            );
          })}
        </div>
      </section>

      {localError ? <div className="notice notice--error" role="alert">{localError}</div> : null}
      {mutation.error ? <ErrorNotice error={mutation.error} /> : null}
      {mutation.error instanceof ApiRequestError && mutation.error.status === 409 ? <div className="notice">服务器版本已更新。当前表单仍保留，请返回查看最新账单后再决定。</div> : null}
      <div className="sticky-actions">{onCancel ? <Button variant="secondary" type="button" onClick={onCancel}>取消</Button> : <Link className="button button--secondary" to={`/activities/${activity.activityId}`}>取消</Link>}<Button type="submit" busy={mutation.isPending}><Check aria-hidden="true" size={18} /> 保存账单</Button></div>
    </form>
  );
}

export function NewExpensePage() {
  const { activity } = useWorkspace();
  if (activity.status !== "ACTIVE") {
    return <div className="workspace-page"><Link className="inline-back" to=".."><ArrowLeft aria-hidden="true" size={18} /> 返回流水</Link><div className="notice"><Info aria-hidden="true" size={18} /><span>活动已结束或归档，当前不能新增账单；已有账单仍可只读查看。</span></div></div>;
  }
  return <div className="workspace-page"><Link className="inline-back" to=".."><ArrowLeft aria-hidden="true" size={18} /> 返回流水</Link><ExpenseEditor /></div>;
}

export function ExpenseDetailPage() {
  const { expenseId = "" } = useParams();
  const { session, activity } = useWorkspace();
  const expense = useExpenseQuery(session.userId, activity.activityId, expenseId);
  const members = useMembersQuery(session.userId, activity.activityId);
  const remove = useDeleteExpenseMutation(session.userId, activity.activityId, expenseId);
  const navigate = useNavigate();
  if (expense.isPending || members.isPending) return <LoadingState label="正在读取账单…" />;
  if (expense.error || members.error) return <ErrorNotice error={expense.error ?? members.error} />;
  if (!expense.data) return null;
  if (activity.status !== "ACTIVE") {
    const aggregate = expense.data;
    const categoryLabel = categories.find(([value]) => value === aggregate.expense.category)?.[1] ?? "其他";
    const splitModeLabel = splitModes.find(([value]) => value === aggregate.expense.splitMode)?.[1] ?? aggregate.expense.splitMode;
    return (
      <div className="workspace-page">
        <Link className="inline-back" to={`/activities/${activity.activityId}`}><ArrowLeft aria-hidden="true" size={18} /> 返回流水</Link>
        <div className="notice"><Info aria-hidden="true" size={18} /><span>活动已结束或归档，账单仅供查看。</span></div>
        <section className="expense-readonly" aria-label="账单详情">
          <header><h2>{aggregate.expense.title}</h2><small>{new Date(aggregate.expense.occurredAt).toLocaleString("zh-CN")}</small></header>
          <dl className="expense-readonly__facts">
            <div><dt>分类</dt><dd>{categoryLabel}</dd></div>
            <div><dt>原始金额</dt><dd><Money value={formatMoney(aggregate.expense.originalCurrency, aggregate.expense.originalAmountMinor)} /></dd></div>
            <div><dt>折算金额</dt><dd><Money value={formatMoney(aggregate.expense.baseCurrency, aggregate.expense.baseAmountMinor)} /></dd></div>
            <div><dt>汇率</dt><dd>{aggregate.expense.exchangeRate}</dd></div>
            <div><dt>付款事实</dt><dd>{aggregate.payments.map((payment) => <span key={payment.factId}>{memberName(payment.memberId, members.data)}<Money value={formatMoney(aggregate.expense.originalCurrency, payment.originalAmountMinor)} /></span>)}</dd></div>
            <div><dt>分摊方式</dt><dd>{splitModeLabel}</dd></div>
            <div><dt>成员分摊</dt><dd>{aggregate.shares.map((share) => <span key={share.factId}>{memberName(share.memberId, members.data)}<Money value={formatMoney(aggregate.expense.originalCurrency, share.originalAmountMinor)} /></span>)}</dd></div>
          </dl>
          {aggregate.expense.note ? <p>{aggregate.expense.note}</p> : null}
          <ExpenseAttachments activityId={activity.activityId} expenseId={aggregate.expense.expenseId} attachments={aggregate.attachments} />
        </section>
      </div>
    );
  }
  return (
    <div className="workspace-page">
      <div className="detail-toolbar"><Link className="inline-back" to={`/activities/${activity.activityId}`}><ArrowLeft aria-hidden="true" size={18} /> 返回流水</Link><Button variant="danger" busy={remove.isPending} onClick={() => { if (window.confirm("确定删除这笔账单吗？账本会立即重新计算。")) void remove.mutateAsync(expense.data!.expense.version).then(() => navigate(`/activities/${activity.activityId}`)); }}><Trash2 aria-hidden="true" size={17} /> 删除</Button></div>
      {remove.error ? <ErrorNotice error={remove.error} /> : null}
      <ExpenseEditor initial={expense.data} />
    </div>
  );
}

function SettlementRow({ settlement, members, writable }: { settlement: Settlement; members: ReturnType<typeof useMembersQuery>["data"]; writable: boolean }) {
  const { session, activity } = useWorkspace();
  const update = useUpdateSettlementMutation(session.userId, activity.activityId);
  const voidMutation = useVoidSettlementMutation(session.userId, activity.activityId);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(minorToInput(settlement.amountMinor, settlement.currency));
  async function save() {
    await update.mutateAsync({ settlementId: settlement.settlementId, input: { amountMinor: amountToMinor(amount, settlement.currency), payerMemberId: settlement.payerMemberId, receiverMemberId: settlement.receiverMemberId, version: settlement.version } });
    setEditing(false);
  }
  return (
    <div className={`settlement-row${settlement.status === "VOID" ? " settlement-row--void" : ""}`}>
      <span className="settlement-row__route"><strong>{memberName(settlement.payerMemberId, members)}</strong><span>付给</span><strong>{memberName(settlement.receiverMemberId, members)}</strong><small>{new Date(settlement.createdAt).toLocaleDateString("zh-CN")}{settlement.status === "VOID" ? " · 已作废" : ""}</small></span>
      {editing ? <div className="inline-edit"><Input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" aria-label="结算金额" /><Button busy={update.isPending} onClick={() => void save()}>保存</Button><Button variant="ghost" onClick={() => setEditing(false)}>取消</Button></div> : <Money value={formatMoney(settlement.currency, settlement.amountMinor)} />}
      {writable && settlement.status === "ACTIVE" && !editing ? <div className="row-actions"><Button variant="ghost" onClick={() => setEditing(true)}>修改</Button><Button variant="ghost" busy={voidMutation.isPending} onClick={() => { if (window.confirm("确定作废这笔结算吗？")) voidMutation.mutate({ settlementId: settlement.settlementId, version: settlement.version }); }}>作废</Button></div> : null}
      {update.error || voidMutation.error ? <ErrorNotice error={update.error ?? voidMutation.error} /> : null}
    </div>
  );
}

export function SettlementsPage() {
  const { session, activity } = useWorkspace();
  const members = useMembersQuery(session.userId, activity.activityId);
  const ledger = useLedgerQuery(session.userId, activity.activityId);
  const recommendations = useRecommendationsQuery(session.userId, activity.activityId);
  const settlements = useSettlementsQuery(session.userId, activity.activityId);
  const create = useCreateSettlementMutation(session.userId, activity.activityId);
  const [formOpen, setFormOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [payerMemberId, setPayer] = useState("");
  const [receiverMemberId, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState<string>();

  function openForm(recommendation?: { payerMemberId: string; receiverMemberId: string; amountMinor: string }) {
    setPayer(recommendation?.payerMemberId ?? "");
    setReceiver(recommendation?.receiverMemberId ?? "");
    setAmount(recommendation ? minorToInput(recommendation.amountMinor, activity.baseCurrency) : "");
    setFormOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError(undefined);
    try {
      await create.mutateAsync({ payerMemberId, receiverMemberId, amountMinor: amountToMinor(amount, activity.baseCurrency), currency: activity.baseCurrency, clientMutationId: crypto.randomUUID() });
      setAmount(""); setPayer(""); setReceiver(""); setFormOpen(false);
    } catch (error) {
      if (!(error instanceof ApiRequestError)) setLocalError(error instanceof Error ? error.message : "结算输入不正确。");
    }
  }

  if (members.isPending || ledger.isPending || recommendations.isPending || settlements.isPending) return <LoadingState label="正在读取结算…" />;
  if (members.error || ledger.error || recommendations.error || settlements.error) return <ErrorNotice error={members.error ?? ledger.error ?? recommendations.error ?? settlements.error} />;
  const balances = ledger.data?.balances ?? [];
  const currentBalance = balances.find((balance) => balance.memberId === activity.currentMemberId);
  const currentAmount = BigInt(currentBalance?.netMinor ?? "0");
  const otherBalances = balances.filter((balance) => balance.memberId !== activity.currentMemberId);
  const unsettledCount = otherBalances.filter((balance) => BigInt(balance.netMinor) !== 0n).length;
  const settledCount = otherBalances.length - unsettledCount;
  const recommendationsList = recommendations.data?.recommendations ?? [];
  const fullySettled = balances.every((balance) => BigInt(balance.netMinor) === 0n);
  // ENDED 仍允许成员结清余额；只有 ARCHIVED 才关闭全部结算写入口。
  const settlementWritable = activity.status !== "ARCHIVED";
  return (
    <div className="workspace-page settlement-page">
      <section className="settlement-summary" aria-label="我的结算">
        <p>我的结算</p>
        <div><strong>{currentAmount > 0n ? "应收" : currentAmount < 0n ? "应付" : "已结清"}</strong>{currentAmount !== 0n ? <Money value={formatMoney(activity.baseCurrency, (currentAmount < 0n ? -currentAmount : currentAmount).toString())} tone={currentAmount > 0n ? "positive" : "negative"} /> : null}</div>
        <small>{unsettledCount} 人未结清 · {settledCount} 人已结清</small>
      </section>

      <section className="settlement-section" aria-labelledby="recommendations-heading">
        <h2 id="recommendations-heading">推荐转账</h2>
        {recommendationsList.length ? <div className="settlement-recommendations">{recommendationsList.map((recommendation) => settlementWritable ? <button key={`${recommendation.payerMemberId}-${recommendation.receiverMemberId}`} type="button" onClick={() => openForm(recommendation)}><span className="settlement-recommendation__party"><MemberAvatar memberId={recommendation.payerMemberId} displayName={memberName(recommendation.payerMemberId, members.data)} size="sm" /><strong>{memberName(recommendation.payerMemberId, members.data)}</strong><ArrowRight aria-hidden="true" size={16} /><MemberAvatar memberId={recommendation.receiverMemberId} displayName={memberName(recommendation.receiverMemberId, members.data)} size="sm" /><strong>{memberName(recommendation.receiverMemberId, members.data)}</strong></span><Money value={formatMoney(activity.baseCurrency, recommendation.amountMinor)} /><ChevronRight aria-hidden="true" size={16} /></button> : <div key={`${recommendation.payerMemberId}-${recommendation.receiverMemberId}`} className="settlement-recommendation-readonly"><span className="settlement-recommendation__party"><MemberAvatar memberId={recommendation.payerMemberId} displayName={memberName(recommendation.payerMemberId, members.data)} size="sm" /><strong>{memberName(recommendation.payerMemberId, members.data)}</strong><ArrowRight aria-hidden="true" size={16} /><MemberAvatar memberId={recommendation.receiverMemberId} displayName={memberName(recommendation.receiverMemberId, members.data)} size="sm" /><strong>{memberName(recommendation.receiverMemberId, members.data)}</strong></span><Money value={formatMoney(activity.baseCurrency, recommendation.amountMinor)} /></div>)}</div> : <p className="settlement-empty">{fullySettled ? "所有成员余额均已结清" : "当前暂无推荐转账"}</p>}
      </section>

      <Link className="button button--secondary settlement-share-entry" to={`/share-summary/${encodeURIComponent(activity.activityId)}`}><ImageDown aria-hidden="true" size={18} />生成分享摘要</Link>

      <button className="balance-entry" type="button" aria-expanded={balanceOpen} onClick={() => setBalanceOpen(true)}><span><strong>成员余额</strong><small>查看 Rust 账本计算的全员余额</small></span><ChevronRight aria-hidden="true" size={18} /></button>

      {settlementWritable && !fullySettled ? <Button className="settlement-primary-action" onClick={() => openForm()}>记录结算</Button> : fullySettled ? <div className="settlement-complete"><Check aria-hidden="true" size={19} /> 全部已结清</div> : null}

      <section className="settlement-section" aria-labelledby="settlement-history-heading"><header><h2 id="settlement-history-heading">实际结算记录</h2>{settlementWritable && !fullySettled ? <Button variant="ghost" onClick={() => openForm()}>补记结算</Button> : null}</header>{settlements.data?.length ? <div className="settlement-list">{settlements.data.map((settlement) => <SettlementRow key={settlement.settlementId} settlement={settlement} members={members.data} writable={settlementWritable} />)}</div> : <EmptyState icon={<UsersRound size={26} />} title="还没有结算记录" description="账本产生应收应付后，可按建议记录成员间付款。" />}</section>

      <AccountingOverlay open={balanceOpen} title="成员余额" onClose={() => setBalanceOpen(false)}>
        <div className="settlement-balance-list">{balances.map((balance) => { const balanceMember = members.data?.find((member) => member.memberId === balance.memberId); const net = BigInt(balance.netMinor); return <div className="balance-row" key={balance.memberId}><MemberAvatar memberId={balance.memberId} displayName={balanceMember?.displayName ?? "未知成员"} /><span><strong>{balanceMember?.displayName ?? "未知成员"}</strong></span><span>{net > 0n ? "应收" : net < 0n ? "应付" : "已结清"}{net !== 0n ? <Money value={formatMoney(activity.baseCurrency, (net < 0n ? -net : net).toString())} tone={net > 0n ? "positive" : "negative"} /> : null}</span></div>; })}</div>
      </AccountingOverlay>

      <AccountingOverlay open={settlementWritable && formOpen} title="记录结算" onClose={() => setFormOpen(false)} className="settlement-form-overlay">
        <form className="form-stack" onSubmit={submit}>
          <Field label="付款人"><Select value={payerMemberId} onChange={(event) => setPayer(event.target.value)} required><option value="">请选择</option>{members.data?.filter((member) => member.status === "ACTIVE").map((member) => <option value={member.memberId} key={member.memberId}>{member.displayName}</option>)}</Select></Field>
          <Field label="收款人"><Select value={receiverMemberId} onChange={(event) => setReceiver(event.target.value)} required><option value="">请选择</option>{members.data?.filter((member) => member.status === "ACTIVE").map((member) => <option value={member.memberId} key={member.memberId}>{member.displayName}</option>)}</Select></Field>
          <Field label={`金额（${activity.baseCurrency}）`}><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required autoFocus /></Field>
          {localError ? <div className="notice notice--error" role="alert">{localError}</div> : null}{create.error ? <ErrorNotice error={create.error} /> : null}
          <Button type="submit" busy={create.isPending}>记录结算</Button>
        </form>
      </AccountingOverlay>
    </div>
  );
}
