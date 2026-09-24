import { ArrowLeft, Check, ChevronDown, Info, MoreHorizontal, UsersRound } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Popover } from "radix-ui";
import { useActivityView, useActivityPagePosition } from "../activities/activity-view-state";
import { PersonalBalance } from "./personal-balance";
import { ApiRequestError } from "../../api/error";
import { MemberAvatar } from "../../components/member-avatar";
import { Overlay } from "../../components/overlay";
import { Button, ConfirmDialog, EmptyState, ErrorNotice, Field, Input, Money, StateIllustration } from "../../components/ui";
import { amountToMinor, formatMoney, minorToInput } from "../../domain-preview/money";
import { type ActivityMember, useMembersQuery } from "../activities/api";
import { useWorkspace } from "../activities/workspace-context";
import { type ExpenseAggregate, type RecommendationStrategy, type Settlement, useCreateSettlementMutation, useExpensesQuery, useLedgerQuery, useRecommendationsQuery, useSettlementsQuery, useUpdateSettlementMutation, useVoidSettlementMutation } from "./api";
import { memberAvatarImage, memberAvatarPreset, memberName } from "./shared";
import { AccountingSkeleton } from "./skeleton";

type Parties = { payerMemberId: string; receiverMemberId: string };
type Recommendation = Parties & { amountMinor: string };
type AllocationDraft = Record<string, string>;

function directCapacity(expense: ExpenseAggregate, payerMemberId: string, receiverMemberId: string): bigint {
  const members = expense.settlementProgress?.members ?? [];
  const payer = members.find(member => member.memberId === payerMemberId && member.direction === "PAYABLE");
  const receiver = members.find(member => member.memberId === receiverMemberId && member.direction === "RECEIVABLE");
  if (!payer || !receiver) return 0n;
  return BigInt(payer.remainingMinor) < BigInt(receiver.remainingMinor)
    ? BigInt(payer.remainingMinor)
    : BigInt(receiver.remainingMinor);
}

function editableCapacity(expense: ExpenseAggregate, payerMemberId: string, receiverMemberId: string, existing?: Settlement): bigint {
  const current = directCapacity(expense, payerMemberId, receiverMemberId);
  const previous = existing?.allocations?.find(allocation => allocation.expenseId === expense.expense.expenseId);
  return current + (previous ? BigInt(previous.amountMinor) : 0n);
}

function allocationPayload(
  draft: AllocationDraft,
  expenses: readonly ExpenseAggregate[],
  currency: string,
  payerMemberId: string,
  receiverMemberId: string,
  existing?: Settlement,
): { allocations: Array<{ expenseId: string; amountMinor: string }>; totalMinor: bigint; invalid: boolean } {
  let totalMinor = 0n;
  let invalid = false;
  const allocations = Object.entries(draft)
    .filter(([, value]) => value.trim().length > 0)
    .map(([expenseId, value]) => {
      try {
        const amountMinor = amountToMinor(value, currency);
        const amount = BigInt(amountMinor);
        const expense = expenses.find(item => item.expense.expenseId === expenseId);
        const capacity = expense ? editableCapacity(expense, payerMemberId, receiverMemberId, existing) : 0n;
        if (amount <= 0n || amount > capacity) invalid = true;
        totalMinor += amount;
        return { expenseId, amountMinor };
      } catch {
        invalid = true;
        return { expenseId, amountMinor: "0" };
      }
    });
  return { allocations, totalMinor, invalid };
}

function SettlementAllocationPicker({
  expenses,
  parties,
  currency,
  value,
  onChange,
  disabled,
  existing,
}: {
  expenses: readonly ExpenseAggregate[];
  parties: Parties;
  currency: string;
  value: AllocationDraft;
  onChange: (value: AllocationDraft) => void;
  disabled?: boolean;
  existing?: Settlement;
}) {
  const candidates = expenses
    .map(expense => ({ expense, capacity: editableCapacity(expense, parties.payerMemberId, parties.receiverMemberId, existing) }))
    .filter(item => item.capacity > 0n)
    .sort((left, right) => left.expense.expense.occurredAt.localeCompare(right.expense.expense.occurredAt));
  if (!parties.payerMemberId || !parties.receiverMemberId) return null;
  return <section className="settlement-allocation-picker" aria-label="用于结清账单">
    <header><strong>用于结清账单（可选）</strong><small>不选择则记录为活动整体结算</small></header>
    {candidates.length ? <div className="settlement-allocation-list">{candidates.map(({ expense, capacity }) => <label className="settlement-allocation-row" key={expense.expense.expenseId}>
      <span><strong>{expense.expense.title}</strong><small>待结 {formatMoney(currency, capacity.toString())}</small></span>
      <Input aria-label={`分配给${expense.expense.title}`} inputMode="decimal" placeholder="0" value={value[expense.expense.expenseId] ?? ""} onChange={event => onChange({ ...value, [expense.expense.expenseId]: event.target.value })} disabled={disabled} />
    </label>)}</div> : <p className="settlement-empty">当前付款人与收款人没有可直接归属的账单。</p>}
    <p className="settlement-allocation-hint">账单结算进度仅统计明确关联到本账单的结算记录。</p>
  </section>;
}

/** 两个字段共享展开状态；更换成员不重建表单，因此金额和另一方选择不会丢失。 */
function SettlementParties({ members, value, onChange }: { members: readonly ActivityMember[]; value: Parties; onChange: (next: Parties) => void }) {
  const [opened, setOpened] = useState<keyof Parties>();
  const [search, setSearch] = useState("");
  const triggers = useRef<Partial<Record<keyof Parties, HTMLButtonElement | null>>>({});
  function close() { const field = opened; setOpened(undefined); setSearch(""); if (field) triggers.current[field]?.focus(); }
  return <div className="settlement-parties">
    {([['payerMemberId', '付款人'], ['receiverMemberId', '收款人']] as const).map(([field, label]) => {
      const other = field === 'payerMemberId' ? value.receiverMemberId : value.payerMemberId;
      const selected = members.find(member => member.memberId === value[field]);
      return <div key={field} className="settlement-party-field">
        <button ref={node => { triggers.current[field] = node; }} type="button" className="settlement-party-trigger" aria-label={`${label}：${selected?.displayName ?? '请选择'}`} aria-expanded={opened === field} onClick={() => { setOpened(opened === field ? undefined : field); setSearch(""); }}>
          <span><small>{label}</small><strong>{selected ? <><MemberAvatar memberId={selected.memberId} userId={selected.userId} displayName={selected.displayName} avatarPreset={selected.avatarPreset} avatarImageId={selected.avatarImageId} size="sm" />{selected.displayName}</> : '请选择'}</strong></span><ChevronDown size={18} aria-hidden="true" />
        </button>
        {opened === field ? <div className="settlement-member-options" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
          <Input aria-label={`搜索${label}`} placeholder="搜索成员姓名" value={search} onChange={event => setSearch(event.target.value)} autoFocus />
          <div className="quick-member-list" role="group" aria-label={`选择${label}`}>
            {members.filter(member => member.status === 'ACTIVE' && member.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(member => <button type="button" className="quick-member-row__button" key={member.memberId} disabled={member.memberId === other} aria-label={`${member.displayName}${member.memberId === other ? `，已选为${field === "payerMemberId" ? "收款人" : "付款人"}` : ""}`} aria-pressed={member.memberId === value[field]} onClick={() => { onChange({ ...value, [field]: member.memberId }); close(); }}>
              <MemberAvatar memberId={member.memberId} userId={member.userId} displayName={member.displayName} avatarPreset={member.avatarPreset} avatarImageId={member.avatarImageId} size="sm" /><span>{member.displayName}{member.memberId === other ? <small>已选为{field === 'payerMemberId' ? '收款人' : '付款人'}</small> : null}</span>{member.memberId === value[field] ? <Check size={18} aria-hidden="true" /> : <span />}
            </button>)}
            {!members.some(member => member.status === 'ACTIVE' && member.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ? <p className="settlement-empty">没有找到成员</p> : null}
          </div><Button variant="ghost" onClick={close}>取消选择</Button>
        </div> : null}
      </div>;
    })}
  </div>;
}

/** 推荐与补记只有初值不同，校验、成员选择、提交和取消使用同一实现。 */
function SettlementForm({ initial, existing, members, expenses, onClose }: { initial?: Recommendation; existing?: Settlement; members: readonly ActivityMember[]; expenses: readonly ExpenseAggregate[]; onClose: () => void }) {
  const { session, activity } = useWorkspace();
  const create = useCreateSettlementMutation(session.userId, activity.activityId);
  const update = useUpdateSettlementMutation(session.userId, activity.activityId);
  const [parties, setParties] = useState<Parties>({ payerMemberId: existing?.payerMemberId ?? initial?.payerMemberId ?? '', receiverMemberId: existing?.receiverMemberId ?? initial?.receiverMemberId ?? '' });
  const [amount, setAmount] = useState(existing ? minorToInput(existing.amountMinor, existing.currency) : initial ? minorToInput(initial.amountMinor, activity.baseCurrency) : '');
  const [allocations, setAllocations] = useState<AllocationDraft>(() => Object.fromEntries(existing?.allocations?.map(allocation => [allocation.expenseId, minorToInput(allocation.amountMinor, activity.baseCurrency)]) ?? []));
  const [error, setError] = useState<string>();
  const busy = create.isPending || update.isPending;
  const submitting = useRef(false);
  const title = existing ? "修改结算" : initial ? "记录推荐转账" : "补记结算";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || busy) return;
    setError(undefined);
    if (!parties.payerMemberId || !parties.receiverMemberId) { setError('请选择付款人和收款人。'); return; }
    if (parties.payerMemberId === parties.receiverMemberId) { setError('付款人与收款人不能相同。'); return; }
    if (![parties.payerMemberId, parties.receiverMemberId].every(id => members.some(member => member.memberId === id && member.status === 'ACTIVE'))) { setError('所选成员已不可参与结算，请重新选择。'); return; }
    try {
      const amountMinor = amountToMinor(amount, activity.baseCurrency);
      if (BigInt(amountMinor) <= 0n) { setError('结算金额必须大于零。'); return; }
      const parsed = allocationPayload(allocations, expenses, activity.baseCurrency, parties.payerMemberId, parties.receiverMemberId, existing);
      if (parsed.invalid) { setError('账单归属金额不能超过该付款人与收款人的直接待结余额。'); return; }
      if (parsed.allocations.length > 0 && parsed.totalMinor !== BigInt(amountMinor)) { setError('已分配金额必须等于本次付款金额。'); return; }
      submitting.current = true;
      if (existing) {
        await update.mutateAsync({ settlementId: existing.settlementId, input: { ...parties, amountMinor, version: existing.version, allocations: parsed.allocations } });
      } else {
        await create.mutateAsync({ ...parties, amountMinor, currency: activity.baseCurrency, clientMutationId: crypto.randomUUID(), allocations: parsed.allocations });
      }
      onClose();
    } catch (reason) { if (!(reason instanceof ApiRequestError)) setError(reason instanceof Error ? reason.message : '结算输入不正确。'); }
    finally { submitting.current = false; }
  }
  return <Overlay open title={title} onClose={onClose} onBeforeClose={() => !submitting.current && !busy} initialFocus="mobile-dialog" mobileSheet={{ maxHeight: 0.92 }} className="settlement-editor-overlay"><form className="settlement-inline-form form-stack" aria-label={existing ? '修改结算' : initial ? '记录推荐转账' : '补记结算'} onSubmit={event => void submit(event)}>
    <fieldset disabled={busy}>{existing ? <TransferParties payer={parties.payerMemberId} receiver={parties.receiverMemberId} members={members} /> : <SettlementParties members={members} value={parties} onChange={next => { setParties(next); setAllocations({}); }} />}
      <Field label={`金额（${activity.baseCurrency}）`}><Input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
      <SettlementAllocationPicker expenses={expenses} parties={parties} currency={activity.baseCurrency} value={allocations} onChange={setAllocations} disabled={busy} existing={existing} />
    </fieldset>
    {error ? <p role="alert" className="notice notice--error">{error}</p> : null}{create.error ? <ErrorNotice error={create.error} /> : null}{update.error ? <ErrorNotice error={update.error} /> : null}
    <div className="settlement-form-actions"><Button type="submit" busy={busy}>{existing ? '保存' : '记录结算'}</Button><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button></div>
  </form></Overlay>;
}

function TransferParties({ payer, receiver, members }: { payer: string; receiver: string; members: readonly ActivityMember[] }) {
  const { activity } = useWorkspace();
  const name = (id: string) => `${memberName(id, members)}${id === activity.currentMemberId ? "（我）" : ""}`;
  return <span className="settlement-transfer"><span><MemberAvatar memberId={payer} {...memberAvatarImage(payer, members)} displayName={memberName(payer, members)} avatarPreset={memberAvatarPreset(payer, members)} size="sm" /><strong>{name(payer)}</strong></span><small>付给</small><span><MemberAvatar memberId={receiver} {...memberAvatarImage(receiver, members)} displayName={memberName(receiver, members)} avatarPreset={memberAvatarPreset(receiver, members)} size="sm" /><strong>{name(receiver)}</strong></span></span>;
}

function SettlementRow({ settlement, members, writable, onEdit, beforeChange, afterChange }: { settlement: Settlement; members: readonly ActivityMember[]; writable: boolean; onEdit: () => void; beforeChange: () => void; afterChange: () => void }) {
  const { session, activity } = useWorkspace();
  const voidMutation = useVoidSettlementMutation(session.userId, activity.activityId);
  const [voidOpen, setVoidOpen] = useState(false);
  const allocationCount = settlement.allocations?.length ?? 0;
  return <article data-reading-key={`record-${settlement.settlementId}`} className={`settlement-record${settlement.status === 'VOID' ? ' settlement-record--void' : ''}`}>
    <div className="settlement-record__main"><TransferParties payer={settlement.payerMemberId} receiver={settlement.receiverMemberId} members={members} /><span className="settlement-record__amount"><Money value={formatMoney(settlement.currency, settlement.amountMinor)} /><small>{settlement.currency}</small></span></div>
    <div className="settlement-record__meta"><time dateTime={settlement.createdAt}>记录于 {new Date(settlement.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><span className="settlement-record__status">{settlement.status === 'VOID' ? '已作废' : allocationCount ? `已关联 ${allocationCount} 笔账单` : '活动整体结算 · 未指定具体账单'}</span></div>
    {writable && settlement.status === 'ACTIVE' ? <div className="settlement-record__actions"><Button variant="ghost" data-focus-key={`edit-${settlement.settlementId}`} onClick={onEdit}>修改</Button><Button variant="ghost" data-focus-key={`void-${settlement.settlementId}`} onClick={() => { beforeChange(); setVoidOpen(true); }}>作废</Button></div> : null}
    <ConfirmDialog open={voidOpen && writable} title="作废结算" message="作废后这笔结算将不再计入余额，确定继续吗？" confirmLabel="确认作废" busy={voidMutation.isPending} error={voidMutation.error ? <ErrorNotice error={voidMutation.error} /> : undefined} onConfirm={() => void voidMutation.mutateAsync({ settlementId: settlement.settlementId, version: settlement.version }).then(() => { setVoidOpen(false); afterChange(); }).catch(() => undefined)} onCancel={() => setVoidOpen(false)} />
  </article>;
}

function RefreshError({ error, retry }: { error: unknown; retry: () => void }) {
  return error ? <div className="settlement-load-error"><ErrorNotice error={error} /><Button variant="ghost" onClick={retry}>重试</Button></div> : null;
}

/** 结算方案只影响 Recommendation；Sheet 关闭后保留当前页面会话选择，不写入活动。 */
function RecommendationStrategyOverlay({
  open,
  selected,
  recommended,
  onSelect,
  onClose,
}: {
  open: boolean;
  selected: RecommendationStrategy;
  recommended: boolean;
  onSelect: (strategy: RecommendationStrategy) => void;
  onClose: () => void;
}) {
  return <Overlay open={open} title="选择结算方案" onClose={onClose} focusKey={selected} initialFocus="mobile-dialog" mobileSheet={{ maxHeight: 0.58 }} className="settlement-strategy-overlay">
    <div className="settlement-strategy-options" role="radiogroup" aria-label="结算方案">
      <button type="button" role="radio" aria-checked={selected === "min_transfers"} className="settlement-strategy-option" onClick={() => onSelect("min_transfers")}>
        <span className="settlement-strategy-option__radio" aria-hidden="true">{selected === "min_transfers" ? "●" : "○"}</span>
        <span><strong>最少转账</strong><small>尽量减少成员之间的转账次数</small></span>
        {selected === "min_transfers" ? <Check size={18} aria-hidden="true" /> : <span className="settlement-strategy-option__spacer" />}
      </button>
      <button type="button" role="radio" aria-checked={selected === "centralized"} className="settlement-strategy-option" onClick={() => onSelect("centralized")}>
        <span className="settlement-strategy-option__radio" aria-hidden="true">{selected === "centralized" ? "●" : "○"}</span>
        <span><strong>由我统一收付 {recommended ? <em>推荐</em> : null}</strong><small>其他成员只与你结算，由你统一收款和付款。<br />原账单分摊结果不会改变。</small></span>
        {selected === "centralized" ? <Check size={18} aria-hidden="true" /> : <span className="settlement-strategy-option__spacer" />}
      </button>
    </div>
  </Overlay>;
}

/** 全员共用连续页面；服务端推荐仅作表单初值，记录真实付款后再刷新权威结果。 */
export function SettlementsPage() {
  const { session, activity, members: cachedMembers, offline, snapshot } = useWorkspace();
  const { strategySelection, setStrategySelection, balanceOpen, setBalanceOpen } = useActivityView();
  const location = useLocation();
  const navigate = useNavigate();
  const members = useMembersQuery(session.userId, activity.activityId, !offline);
  const ledger = useLedgerQuery(session.userId, activity.activityId, !offline);
  const recommendations = useRecommendationsQuery(session.userId, activity.activityId, strategySelection, !offline);
  const settlements = useSettlementsQuery(session.userId, activity.activityId, !offline);
  const expenses = useExpensesQuery(session.userId, activity.activityId, !offline);
  const [strategySheetOpen, setStrategySheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState<{ key: string; initial?: Recommendation; existing?: Settlement }>();
  const memberData = members.data ?? cachedMembers ?? [];
  const ledgerData = ledger.data ?? snapshot?.snapshot.ledger;
  const recommendationData = recommendations.data ?? snapshot?.snapshot.recommendations;
  const records = settlements.data ?? snapshot?.snapshot.settlements;
  const expenseRecords = expenses.data ?? snapshot?.snapshot.expenses ?? [];
  const balances = ledgerData?.balances;
  const current = balances?.find(balance => balance.memberId === activity.currentMemberId);
  const fullySettled = Boolean(!ledger.error && balances?.length && balances.every(balance => BigInt(balance.netMinor) === 0n));
  const memberReady = memberData.length > 0;
  const writable = activity.status !== "ARCHIVED" && !offline && memberReady && Boolean(ledgerData) && !members.error && !ledger.error;
  const rows = recommendationData?.recommendations;
  const { containerRef, capturePosition, restorePosition } = useActivityPagePosition("settlement", Boolean(ledgerData || ledger.error) && Boolean(rows || recommendations.error) && Boolean(records || settlements.error) && memberReady);
  const effectiveStrategy = recommendations.data?.effectiveStrategy === "CENTRALIZED" ? "centralized" : "min_transfers";
  const selectedStrategy = strategySelection.strategy ?? effectiveStrategy;
  const effectiveHubMemberId = recommendations.data?.hubMemberId ?? (effectiveStrategy === "centralized" ? activity.currentMemberId : null);
  const shareStrategy = strategySelection.strategy ?? (recommendations.data?.effectiveStrategy ? effectiveStrategy : undefined);
  const shareHubMemberId = strategySelection.hubMemberId ?? effectiveHubMemberId;
  const shareQuery = shareStrategy ? new URLSearchParams({ strategy: shareStrategy, ...(shareStrategy === "centralized" && shareHubMemberId ? { hubMemberId: shareHubMemberId } : {}) }).toString() : "";
  const activeMembers = memberData.filter(member => member.status === "ACTIVE");
  const recommendedCentralized = activeMembers.filter(member => member.userId != null).length === 1 && activeMembers.some(member => member.userId == null);
  const closeForm = () => { setForm(undefined); restorePosition(); };
  const openForm = (next: NonNullable<typeof form>) => { capturePosition(); setForm(next); };
  const goBack = () => {
    if ((location.state as { settlementFromFeed?: boolean } | null)?.settlementFromFeed) navigate(-1);
    else navigate(`/activities/${encodeURIComponent(activity.activityId)}`);
  };
  const blockingError = [members.error, ledger.error, recommendations.error, settlements.error].find(error => error instanceof ApiRequestError && [401, 403, 404].includes(error.status));
  if (blockingError) return <ErrorNotice error={blockingError} />;
  return <div ref={containerRef} className="settlement-screen">
    <header className="workspace-header workspace-header--compact settlement-header"><div className="workspace-header__actions">
      <button className="back-link" type="button" aria-label="返回流水" onClick={goBack}><ArrowLeft size={20} aria-hidden="true" /></button>
      <div className="workspace-header__identity"><h1>结算</h1></div>
      <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Popover.Trigger asChild><button type="button" className="icon-button" aria-label="更多操作" data-focus-key="settlement-menu"><MoreHorizontal size={21} aria-hidden="true" /></button></Popover.Trigger>
        <Popover.Portal><Popover.Content className="activity-actions-popover" align="end" sideOffset={8} onCloseAutoFocus={event => { if (strategySheetOpen) event.preventDefault(); }}>
          <nav className="activity-actions-popover__list" aria-label="结算操作">
            <button type="button" className="activity-actions-popover__item" disabled={offline || !memberReady} onClick={() => { setMenuOpen(false); setStrategySheetOpen(true); }}>切换结算方案</button>
            <Link className="activity-actions-popover__item" to={`/share-summary/${encodeURIComponent(activity.activityId)}${shareQuery ? `?${shareQuery}` : ""}`} onClick={() => setMenuOpen(false)}>生成分享摘要</Link>
          </nav>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    </div></header>
    <main className="workspace-content"><div className="workspace-page settlement-page">
      {offline ? <div className="notice" role="status"><Info size={18} /><span>当前离线，以下结算使用最近一次同步的只读快照。</span></div> : null}
      <RefreshError error={members.error} retry={() => void members.refetch()} />
      <section className="settlement-summary" aria-label="我的结算"><PersonalBalance currency={activity.baseCurrency} netMinor={current?.netMinor} error={ledger.error} onRetry={() => void ledger.refetch()} /></section>
      <section className="settlement-members"><button className="balance-entry" type="button" aria-label="成员余额" aria-expanded={balanceOpen} data-focus-key="member-balances" onClick={() => setBalanceOpen(value => !value)}><strong>成员余额</strong><span>{ledger.error ? "读取失败" : balances ? `${balances.filter(balance => BigInt(balance.netMinor) !== 0n).length} 人未结清` : "正在读取"}</span><ChevronDown className={balanceOpen ? "is-expanded" : ""} size={18} aria-hidden="true" /></button>
        {balanceOpen ? balances && memberReady && !ledger.error ? <div className="settlement-balance-list">{balances.map(balance => {
          const net = BigInt(balance.netMinor);
          return <div className="balance-row" key={balance.memberId} data-reading-key={`member-${balance.memberId}`}><MemberAvatar memberId={balance.memberId} {...memberAvatarImage(balance.memberId, memberData)} displayName={memberName(balance.memberId, memberData)} avatarPreset={memberAvatarPreset(balance.memberId, memberData)} /><strong>{memberName(balance.memberId, memberData)}{balance.memberId === activity.currentMemberId ? "（我）" : ""}</strong><span>{net > 0n ? "应收" : net < 0n ? "应付" : "余额已平"}{net !== 0n ? <Money value={formatMoney(activity.baseCurrency, (net < 0n ? -net : net).toString())} tone={net > 0n ? "positive" : "negative"} /> : null}</span></div>;
        })}</div> : !ledger.error && !members.error ? <AccountingSkeleton kind="settlement" section /> : null : null}
      </section>
      {fullySettled ? <div className="settlement-complete"><Check size={19} />全员余额已结清</div> : null}
      <section className="settlement-section" aria-labelledby="recommendations-heading">
        <header className="settlement-section__heading"><h2 id="recommendations-heading">推荐转账</h2>{writable && !fullySettled ? <Button variant="ghost" aria-label="补记结算" data-focus-key="manual-settlement" onClick={() => openForm({ key: "manual" })}>＋补记结算</Button> : null}</header>
        <p className="settlement-strategy-current">当前方案：{offline ? "最近同步结果" : selectedStrategy === "centralized" ? "由我统一收付" : "最少转账"}</p>
        <RefreshError error={recommendations.error} retry={() => void recommendations.refetch()} />
        {rows && memberReady ? rows.length ? <div className="settlement-recommendations">{rows.map(recommendation => {
          const key = `${recommendation.payerMemberId}-${recommendation.receiverMemberId}`;
          return <div className="settlement-recommendation-item" key={key} data-reading-key={`transfer-${key}`}>
            <div className="settlement-recommendation-content"><TransferParties payer={recommendation.payerMemberId} receiver={recommendation.receiverMemberId} members={memberData} /><Money value={formatMoney(activity.baseCurrency, recommendation.amountMinor)} /></div>
            {writable ? <Button className="settlement-recommendation-trigger" variant="secondary" data-focus-key={`transfer-${key}`} aria-label={`记录 ${memberName(recommendation.payerMemberId, memberData)}付给${memberName(recommendation.receiverMemberId, memberData)}`} onClick={() => openForm({ key, initial: recommendation })}>记录</Button> : null}
          </div>;
        })}</div> : <p className="settlement-empty">{fullySettled ? "当前无需转账" : "当前暂无推荐转账"}</p> : !recommendations.error && !members.error ? <AccountingSkeleton kind="settlement" section /> : null}
      </section>
      <section className="settlement-section" aria-labelledby="settlement-history-heading"><header><h2 id="settlement-history-heading">实际结算记录</h2></header>
        <RefreshError error={settlements.error} retry={() => void settlements.refetch()} />
        {records && memberReady ? records.length ? <div className="settlement-list">{[...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(record => <SettlementRow key={record.settlementId} settlement={record} members={memberData} writable={writable} onEdit={() => openForm({ key: record.settlementId, existing: record })} beforeChange={capturePosition} afterChange={restorePosition} />)}</div> : <EmptyState icon={<UsersRound size={24} />} visual={<StateIllustration src="/illustrations/settlement-history-empty.webp" size="compact" />} title="还没有结算记录" description="完成转账后，在这里补记结算。" /> : !settlements.error && !members.error ? <AccountingSkeleton kind="settlement" section /> : null}
      </section>
    </div></main>
    <RecommendationStrategyOverlay open={strategySheetOpen} selected={selectedStrategy} recommended={recommendedCentralized} onClose={() => setStrategySheetOpen(false)} onSelect={strategy => { capturePosition(); setStrategySelection(strategy === "centralized" ? { strategy, hubMemberId: activity.currentMemberId } : { strategy }); setStrategySheetOpen(false); }} />
    {form && writable ? <SettlementForm key={form.key} initial={form.initial} existing={form.existing} members={memberData} expenses={expenseRecords} onClose={closeForm} /> : null}
  </div>;
}
