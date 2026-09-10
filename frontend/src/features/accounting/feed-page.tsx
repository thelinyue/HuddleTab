import { ApiRequestError } from "../../api/error";
import { Filter, Info, Plus, ReceiptText } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Overlay } from "../../components/overlay";
import { Button, ConfirmDialog, EmptyState, ErrorNotice, Field, Input, Money, Select, StateIllustration } from "../../components/ui";
import { formatMoney } from "../../domain-preview/money";
import { useMembersQuery } from "../activities/api";
import { useWorkspace } from "../activities/workspace-context";
import {
  type ExpenseAggregate,
  useDiscardPendingExpenseMutation,
  useExpensesQuery
} from "./api";
import { usePendingExpenseMutations } from "./expense-queue-sync";

import { retryableLazy } from "../../components/retryable-lazy";
import { categories, memberName, parentQuickExpenseView, type PendingExpenseDraft, quickExpenseBackLabel, quickExpenseMobileSheet, quickExpenseOverlayClass, type QuickExpenseView, quickExpenseViewTitle } from "./shared";
import { AccountingSkeleton } from "./skeleton";
const UnifiedExpenseEditor = retryableLazy(() => import("./expense-editor").then(m => ({ default: m.UnifiedExpenseEditor })));
const ExpenseEditOverlay = retryableLazy(() => import("./expense-editor").then(m => ({ default: m.ExpenseEditOverlay })));
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

function dateHeading(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

export function ExpenseFeedPage() {
  const { session, activity, members: cachedMembers, offline, snapshot } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const expenses = useExpensesQuery(session.userId, activity.activityId, !offline);
  const pendingExpenses = usePendingExpenseMutations(
    session.userId,
    activity.activityId,
  );
  const discardPending = useDiscardPendingExpenseMutation(session.userId);
  const members = useMembersQuery(session.userId, activity.activityId, !offline);
  const [entryOpen, setEntryOpen] = useState(false);
  const [quickView, setQuickView] = useState<QuickExpenseView>("entry");
  const [rejectedView, setRejectedView] = useState<QuickExpenseView>("entry");
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [rejectedDraft, setRejectedDraft] = useState<PendingExpenseDraft>();
  const [discardTarget, setDiscardTarget] = useState<{ mutationId: string; activityId: string }>();

  async function confirmDiscard() {
    if (!discardTarget) return;
    try {
      await discardPending.mutateAsync(discardTarget);
      setDiscardTarget(undefined);
    } catch {
      // 错误由流水页已有的 ErrorNotice 展示，保留确认弹层让用户可以重试或取消。
    }
  }

  const blockingError = [expenses.error, members.error].find(error => error instanceof ApiRequestError && [401, 403, 404].includes(error.status));
  if (blockingError) return <ErrorNotice error={blockingError} />;
  if ((!expenses.data && !snapshot && expenses.isPending) || members.isPending && (cachedMembers?.length ?? 0) === 0) return <AccountingSkeleton />;
  if ((!offline && expenses.error && !expenses.data && !snapshot) || members.error && (cachedMembers?.length ?? 0) === 0) return <div className="workspace-page"><ErrorNotice error={expenses.error ?? members.error} /><Button variant="secondary" onClick={() => { void expenses.refetch(); void members.refetch(); }}>重试</Button></div>;

  const allExpenses = expenses.data ?? snapshot?.snapshot.expenses ?? [];
  const memberData = members.data ?? cachedMembers ?? [];
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
  const activeMemberCount = memberData.filter((member) => member.status === "ACTIVE").length;
  const average = activeMemberCount ? (total + BigInt(activeMemberCount) / 2n) / BigInt(activeMemberCount) : 0n;
  const foreignTotals = new Map<string, bigint>();
  // 生命周期只约束本领域写面：结束后账单只读，但不会反推活动管理权限。
  const expenseWritable = activity.status === "ACTIVE";
  const existingExpenseWritable = expenseWritable && !offline;
  const editExpenseId = existingExpenseWritable ? searchParams.get("editExpense") ?? "" : "";
  const closeEditExpense = () => {
    if ((location.state as { expenseOverlay?: boolean } | null)?.expenseOverlay) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("editExpense");
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next.toString()}` : "" }, { replace: true });
  };
  for (const item of allExpenses) {
    if (item.expense.originalCurrency === activity.baseCurrency) continue;
    foreignTotals.set(item.expense.originalCurrency, (foreignTotals.get(item.expense.originalCurrency) ?? 0n) + BigInt(item.expense.originalAmountMinor));
  }

  return (
    <div className="workspace-page expense-feed-page">
      {expenses.error && (expenses.data !== undefined || snapshot !== undefined) ? <div role="alert" className="notice">流水更新失败，当前显示已加载内容。<Button variant="ghost" onClick={() => void expenses.refetch()}>重试</Button></div> : null}
      {offline ? <div className="notice" role="status"><Info aria-hidden="true" size={18} /><span>当前离线，以下流水使用最近一次同步的只读快照；新账单仍可先保存在本机。</span></div> : null}
      <section className="expense-summary" aria-label="消费摘要">
        {/* 与结算摘要共用标题行，保证两个工作台页面的卡片视觉基准一致。 */}
        <header className="accounting-summary__header"><p>总消费</p></header>
        <div className="accounting-summary__value"><Money value={formatMoney(activity.baseCurrency, total.toString())} /></div>
        {[...foreignTotals].length ? <p className="expense-summary__foreign">其中外币消费 {[...foreignTotals].map(([currencyCode, amount]) => formatMoney(currencyCode, amount.toString())).join(" · ")} · 已折算</p> : null}
        <p className="expense-summary__meta accounting-summary__meta">
          <span>{allExpenses.length} 笔消费 · 人均消费 <strong>{formatMoney(activity.baseCurrency, average.toString())}</strong></span>
          <Popover.Root>
            <Popover.Trigger asChild>
              <button className="expense-summary__info-trigger" type="button" aria-label="人均消费说明">
                <Info aria-hidden="true" size={14} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="expense-summary__info-popover" side="top" align="end" sideOffset={8}>
                <p>人均消费仅为统计平均值，不代表任何成员实际应承担金额。</p>
                <Popover.Arrow className="expense-summary__info-arrow" />
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </p>
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
                 const payerNames = record.payload.payments.map((payment) => memberName(payment.memberId, memberData)).join("、");
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
                    <span className="expense-row__content"><strong>{record.payload.title}</strong>{record.payload.note ? <span className="expense-row__note">{record.payload.note}</span> : null}<small>{payerNames || "未知付款人"} 付款 · {shareCount}人 · {statusLabel}</small>{record.lastError ? <small>{record.lastError.message}</small> : null}{record.status === "REJECTED" ? <span className="pending-expense-actions"><Button type="button" variant="secondary" onClick={() => { setRejectedView("entry"); setRejectedDraft(record); }}>修改后重试</Button><Button type="button" variant="ghost" onClick={() => setDiscardTarget({ mutationId: record.id, activityId: record.activityId })}>丢弃本地记录</Button></span> : null}</span>
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
                const payerNames = payments.map((payment) => memberName(payment.memberId, memberData)).join("、");
                const local = localRecords.find((record) =>
                  record.status === "SYNCED" &&
                  record.serverExpenseId === expense.expenseId,
                );
                const attachmentMessage = local?.attachments.find(
                  (attachment) => attachment.status === "REJECTED",
                )?.lastError?.message ?? (local?.attachments.some((attachment) =>
                  ["PENDING", "SYNCING", "RETRYABLE"].includes(attachment.status)
                ) ? "附件等待同步" : undefined);
                const detailUrl = `/activities/${activity.activityId}/expenses/${expense.expenseId}`;
                const editQuery = new URLSearchParams(searchParams);
                editQuery.set("editExpense", expense.expenseId);
                const rowUrl = existingExpenseWritable
                  ? { pathname: `/activities/${activity.activityId}`, search: `?${editQuery.toString()}` }
                  : detailUrl;
                return (
                  <Link key={expense.expenseId} to={rowUrl} state={existingExpenseWritable ? { expenseOverlay: true } : undefined} className="expense-row">
                    <span className="category-illustration"><img src={`/expense-categories/${categoryInfo[2]}.webp`} width={44} height={44} alt="" /></span>
                    <span className="expense-row__content"><strong>{expense.title}</strong>{expense.note ? <span className="expense-row__note">{expense.note}</span> : null}<small>{payerNames || "未知付款人"} 付款 · {shares.length}人</small>{attachmentMessage ? <small>{attachmentMessage}</small> : null}</span>
                    <span className="expense-row__amount"><Money value={formatMoney(expense.originalCurrency, expense.originalAmountMinor)} /><small>{new Date(expense.occurredAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></span>
                  </Link>
                );
              })}
            </div>
          </section>
        )) : <EmptyState icon={<ReceiptText size={28} />} visual={allExpenses.length ? undefined : <StateIllustration src="/illustrations/expense-feed-empty.webp" />} title={allExpenses.length ? "没有符合条件的流水" : "还没有流水"} description={allExpenses.length ? "调整筛选条件后再试。" : "记录第一笔共同支出，账本会自动计算成员余额。"} />}
      </section>

      {expenseWritable ? <button className="activity-add-fab quick-expense-trigger" type="button" aria-label="记一笔" title="记一笔" onClick={() => { setQuickView("entry"); setEntryOpen(true); }}><Plus aria-hidden="true" size={24} /></button> : null}
      {expenseWritable && entryOpen ? <Overlay
        open={true}
        title={quickExpenseViewTitle(quickView)}
        onBack={quickView === "entry" ? undefined : { label: quickExpenseBackLabel(quickView), onClick: () => setQuickView(parentQuickExpenseView(quickView)) }}
        focusKey={quickView}
        initialFocus="mobile-dialog"
        mobileSheet={quickExpenseMobileSheet(quickView)}
        onClose={() => { setQuickView("entry"); setEntryOpen(false); }}
        className={quickExpenseOverlayClass(quickView)}
      >
        <UnifiedExpenseEditor view={quickView} onViewChange={setQuickView} onSaved={() => { setQuickView("entry"); setEntryOpen(false); }} />
      </Overlay> : null}
      {rejectedDraft ? <Overlay open={true} title={rejectedView === "entry" ? "修改被拒账单" : quickExpenseViewTitle(rejectedView)} onBack={rejectedView === "entry" ? undefined : { label: quickExpenseBackLabel(rejectedView, "修改被拒账单"), onClick: () => setRejectedView(parentQuickExpenseView(rejectedView)) }} focusKey={rejectedView} initialFocus="mobile-dialog" mobileSheet={quickExpenseMobileSheet(rejectedView)} onClose={() => { setRejectedView("entry"); setRejectedDraft(undefined); }} className={quickExpenseOverlayClass(rejectedView)}><UnifiedExpenseEditor rejected={rejectedDraft} view={rejectedView} onViewChange={setRejectedView} onSaved={() => { setRejectedView("entry"); setRejectedDraft(undefined); }} /></Overlay> : null}
      {editExpenseId ? <ExpenseEditOverlay expenseId={editExpenseId} onClose={closeEditExpense} /> : null}
      <Overlay open={filterOpen} title="筛选流水" onClose={() => setFilterOpen(false)}>
        <div className="form-stack"><Field label="搜索"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题或备注" autoFocus /></Field><Field label="分类"><Select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field><Button onClick={() => setFilterOpen(false)}>应用筛选</Button></div>
      </Overlay>
      <ConfirmDialog open={Boolean(discardTarget)} title="丢弃本地记录" message="丢弃后无法恢复这条本地离线消费，也不会影响服务器上的账单。确定继续吗？" confirmLabel="确认丢弃" busy={discardPending.isPending} onConfirm={() => void confirmDiscard()} onCancel={() => setDiscardTarget(undefined)} />
    </div>
  );
}

