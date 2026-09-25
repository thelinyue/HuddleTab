import { ArrowLeft, Check, ChevronDown, ChevronRight, Info, MoreHorizontal, UsersRound } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Popover } from "radix-ui";
import { useActivityView, useActivityPagePosition } from "../activities/activity-view-state";
import { PersonalBalance } from "./personal-balance";
import { ApiRequestError } from "../../api/error";
import { MemberAvatar } from "../../components/member-avatar";
import { Overlay } from "../../components/overlay";
import { Button, ConfirmDialog, ErrorNotice, Field, Input, Money } from "../../components/ui";
import { amountToMinor, formatMoney, minorToInput } from "../../domain-preview/money";
import { type ActivityMember, useMembersQuery } from "../activities/api";
import { useWorkspace } from "../activities/workspace-context";
import { type RecommendationStrategy, type Settlement, type SettlementScope, useCreateSettlementMutation, useSettlementPreviewQuery, useConfirmBillOffsetsMutation, useSettlementsQuery, useUpdateSettlementMutation, useVoidSettlementMutation } from "./api";
import { SettlementDates, settlementDateLabel, settlementRecordDates } from "./settlement-dates";
import { memberAvatarImage, memberAvatarPreset, memberName } from "./shared";
import { AccountingSkeleton } from "./skeleton";
import "./settlement-cards.css";

type Parties = { payerMemberId: string; receiverMemberId: string };
type Recommendation = Parties & { amountMinor: string };
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

/** 打开表单时保留预览范围与版本；后台刷新不得悄悄替换用户正在确认的金额。 */
function SettlementForm({ initial, existing, scope, members, onClose, onRefresh }: { initial?: Recommendation; existing?: Settlement; scope?: SettlementScope; members: readonly ActivityMember[]; onClose: () => void; onRefresh: () => Promise<unknown> }) {
  const { session, activity } = useWorkspace();
  const create = useCreateSettlementMutation(session.userId, activity.activityId);
  const update = useUpdateSettlementMutation(session.userId, activity.activityId);
  const [parties, setParties] = useState<Parties>({ payerMemberId: existing?.payerMemberId ?? initial?.payerMemberId ?? '', receiverMemberId: existing?.receiverMemberId ?? initial?.receiverMemberId ?? '' });
  const [amount, setAmount] = useState(existing ? minorToInput(existing.amountMinor, existing.currency) : initial ? minorToInput(initial.amountMinor, activity.baseCurrency) : '');
  const [error, setError] = useState<string>();
  const busy = create.isPending || update.isPending;
  const submitting = useRef(false);
  const submission = useRef<{ payload: string; id: string } | undefined>(undefined);
  const expired = create.error instanceof ApiRequestError && create.error.code === "SETTLEMENT_PREVIEW_EXPIRED";
  const title = existing ? "修改结算" : initial ? "记录推荐转账" : "记录其他转账";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || busy || expired) return;
    setError(undefined);
    if (!parties.payerMemberId || !parties.receiverMemberId) { setError('请选择付款人和收款人。'); return; }
    if (parties.payerMemberId === parties.receiverMemberId) { setError('付款人与收款人不能相同。'); return; }
    if (![parties.payerMemberId, parties.receiverMemberId].every(id => members.some(member => member.memberId === id && member.status === 'ACTIVE'))) { setError('所选成员已不可参与结算，请重新选择。'); return; }
    try {
      const amountMinor = amountToMinor(amount, activity.baseCurrency);
      if (BigInt(amountMinor) <= 0n) { setError('结算金额必须大于零。'); return; }
      submitting.current = true;
      if (existing) {
        await update.mutateAsync({ settlementId: existing.settlementId, input: { ...parties, amountMinor, version: existing.version } });
      } else {
        const payload = JSON.stringify({ ...parties, amountMinor, scope });
        if (submission.current?.payload !== payload) submission.current = { payload, id: crypto.randomUUID() };
        await create.mutateAsync({ ...parties, amountMinor, scope, currency: activity.baseCurrency, clientMutationId: submission.current.id });
      }
      onClose();
    } catch (reason) { if (!(reason instanceof ApiRequestError)) setError(reason instanceof Error ? reason.message : '结算输入不正确。'); }
    finally { submitting.current = false; }
  }
  return <Overlay open title={title} onClose={onClose} onBeforeClose={() => !submitting.current && !busy} initialFocus="mobile-dialog" mobileSheet={{ maxHeight: 0.92 }} className="settlement-editor-overlay"><form className="settlement-inline-form form-stack" aria-label={title} onSubmit={event => void submit(event)}>
    <p className="settlement-scope-label">结算日期：{settlementDateLabel(existing?.scope ?? scope)}</p>
    <fieldset disabled={busy}>{existing ? <TransferParties payer={parties.payerMemberId} receiver={parties.receiverMemberId} members={members} /> : <SettlementParties members={members} value={parties} onChange={setParties} />}
      <Field label={`金额（${activity.baseCurrency}）`}><Input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
    </fieldset>
    {error ? <p role="alert" className="notice notice--error">{error}</p> : null}{create.error ? <ErrorNotice error={create.error} /> : null}{update.error ? <ErrorNotice error={update.error} /> : null}
    <div className="settlement-form-actions">{expired ? <Button onClick={() => { onClose(); void onRefresh(); }}>刷新结算预览</Button> : <Button type="submit" busy={busy}>{existing ? '保存' : '记录结算'}</Button>}<Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button></div>
  </form></Overlay>;
}

function TransferParties({ payer, receiver, members }: { payer: string; receiver: string; members: readonly ActivityMember[] }) {
  const { activity } = useWorkspace();
  const name = (id: string) => `${memberName(id, members)}${id === activity.currentMemberId ? "（我）" : ""}`;
  return <span className="settlement-transfer"><span><MemberAvatar memberId={payer} {...memberAvatarImage(payer, members)} displayName={memberName(payer, members)} avatarPreset={memberAvatarPreset(payer, members)} size="sm" /><strong>{name(payer)}</strong></span><small>付给</small><span><MemberAvatar memberId={receiver} {...memberAvatarImage(receiver, members)} displayName={memberName(receiver, members)} avatarPreset={memberAvatarPreset(receiver, members)} size="sm" /><strong>{name(receiver)}</strong></span></span>;
}

/** 常态只展示收付与日期摘要，完整范围按需展开；菜单关闭后焦点回到持久存在的行内入口。 */
function SettlementRow({ settlement, members, writable, onEdit, beforeChange, afterChange }: { settlement: Settlement; members: readonly ActivityMember[]; writable: boolean; onEdit: () => void; beforeChange: () => void; afterChange: () => void }) {
  const { session, activity } = useWorkspace();
  const voidMutation = useVoidSettlementMutation(session.userId, activity.activityId);
  const [voidOpen, setVoidOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const openingDialog = useRef(false);
  const detailsId = useId();
  const { dates, summary } = settlementRecordDates(settlement);
  const recordedAt = new Date(settlement.createdAt);
  const recordedDate = recordedAt.toLocaleDateString('zh-CN', { ...(recordedAt.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}), month: 'numeric', day: 'numeric' });
  const applicationCount = new Set(settlement.applications?.map(application => application.expenseId) ?? []).size;
  return <article data-reading-key={`record-${settlement.settlementId}`} className={`settlement-record${settlement.status === 'VOID' ? ' settlement-record--void' : ''}`}>
    <div className="settlement-record__main">
      <TransferParties payer={settlement.payerMemberId} receiver={settlement.receiverMemberId} members={members} />
      <div className="settlement-record__trailing"><span className="settlement-record__amount"><Money value={formatMoney(settlement.currency, settlement.amountMinor)} /></span>
        {writable && settlement.status === 'ACTIVE' ? <Popover.Root open={menuOpen} onOpenChange={open => { openingDialog.current = false; setMenuOpen(open); }}>
          <Popover.Trigger asChild><button type="button" className="icon-button settlement-record__menu" aria-label="结算记录操作" data-focus-key={`record-menu-${settlement.settlementId}`} onClick={() => beforeChange()}><MoreHorizontal size={19} aria-hidden="true" /></button></Popover.Trigger>
          <Popover.Portal><Popover.Content className="activity-actions-popover settlement-record-menu" align="end" sideOffset={4} collisionPadding={12} onCloseAutoFocus={event => { if (openingDialog.current) event.preventDefault(); }}>
            <div className="activity-actions-popover__list" aria-label="结算记录操作">
              <button type="button" className="activity-actions-popover__item" onClick={() => { openingDialog.current = true; setMenuOpen(false); onEdit(); }}>修改</button>
              <button type="button" className="activity-actions-popover__item settlement-record-menu__void" onClick={() => { beforeChange(); openingDialog.current = true; setMenuOpen(false); setVoidOpen(true); }}>作废</button>
            </div>
          </Popover.Content></Popover.Portal>
        </Popover.Root> : <span className="settlement-record__menu-space" aria-hidden="true" />}
      </div>
    </div>
    <div className="settlement-record__meta">
      {settlement.status === 'VOID' ? <small className="settlement-record__status">已作废</small> : null}
      {/* 作废后菜单消失，由详情入口接续菜单的焦点身份，保持键盘阅读位置。 */}
      <button type="button" className="settlement-record__summary" aria-expanded={expanded} aria-controls={detailsId} data-focus-key={`${writable && settlement.status === 'ACTIVE' ? 'record-details' : 'record-menu'}-${settlement.settlementId}`} onClick={() => setExpanded(value => !value)}><span>{summary}</span><ChevronDown size={14} aria-hidden="true" /></button>
      <time dateTime={settlement.createdAt}>{recordedDate} 录入</time>
    </div>
    <div id={detailsId} hidden={!expanded} className="settlement-record__details">
      <p>结算日期：{dates.length ? dates.map(date => date.replaceAll('-', '/')).join('、') : '未记录日期范围'}{dates.length ? ` · ${settlement.scopeExpenseIds?.length ?? 0} 笔账单` : ''}</p>
      <p>记录于 {recordedAt.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
      <p>{settlement.status === 'VOID' ? '已作废，不计入余额' : applicationCount ? `自动清偿 ${applicationCount} 笔账单` : '已记录转账'}</p>
    </div>
    <ConfirmDialog open={voidOpen && writable} title="作废结算" message="作废后这笔结算将不再计入余额，确定继续吗？" confirmLabel="确认作废" busy={voidMutation.isPending} error={voidMutation.error ? <ErrorNotice error={voidMutation.error} /> : undefined} onConfirm={() => void voidMutation.mutateAsync({ settlementId: settlement.settlementId, version: settlement.version }).then(() => { setVoidOpen(false); afterChange(); }).catch(() => undefined)} onCancel={() => { setVoidOpen(false); afterChange(); }} />
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
  const { strategySelection, setStrategySelection, balanceOpen, setBalanceOpen, settlementDates, setSettlementDates } = useActivityView();
  const location = useLocation();
  const navigate = useNavigate();
  const members = useMembersQuery(session.userId, activity.activityId, !offline);
  const preview = useSettlementPreviewQuery(session.userId, activity.activityId, settlementDates, Intl.DateTimeFormat().resolvedOptions().timeZone, strategySelection, !offline);
  const ledger = preview;
  const recommendations = preview;
  const confirmOffsets = useConfirmBillOffsetsMutation(session.userId, activity.activityId);
  const offsetSubmission = useRef<{ payload: string; id: string } | undefined>(undefined);
  const offsetBusy = useRef(false);
  const settlements = useSettlementsQuery(session.userId, activity.activityId, !offline);
  const [strategySheetOpen, setStrategySheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);
  const [form, setForm] = useState<{ key: string; initial?: Recommendation; existing?: Settlement; scope?: SettlementScope }>();
  const memberData = members.data ?? cachedMembers ?? [];
  const ledgerData = offline ? snapshot?.snapshot.ledger : ledger.data;
  const recommendationData = offline ? snapshot?.snapshot.recommendations : recommendations.data;
  const records = settlements.data ?? snapshot?.snapshot.settlements;
  const balances = ledgerData?.balances;
  const current = balances?.find(balance => balance.memberId === activity.currentMemberId);
  const fullySettled = offline ? Boolean(balances?.length && balances.every(balance => BigInt(balance.netMinor) === 0n)) : Boolean(!preview.error && preview.data?.settled);
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
  const openForm = (next: NonNullable<typeof form>) => { capturePosition(undefined, next.key === 'manual' ? 'manual-settlement' : undefined); setForm({ ...next, scope: preview.data?.scope }); };
  const dateSummary = settlementDates ? `已选 ${settlementDates.length} 天${preview.data ? ` · ${preview.data.expenseIds.length} 笔账单` : ""}` : "全部日期";
  async function confirmSelectedOffsets() {
    if (!preview.data || offsetBusy.current) return;
    const scope = preview.data.scope;
    const payload = JSON.stringify(scope);
    if (offsetSubmission.current?.payload !== payload) offsetSubmission.current = { payload, id: crypto.randomUUID() };
    offsetBusy.current = true;
    try { await confirmOffsets.mutateAsync({ scope, clientMutationId: offsetSubmission.current.id }); }
    catch { /* 错误由界面呈现；版本冲突必须手动刷新后重新确认。 */ }
    finally { offsetBusy.current = false; }
  }
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
            <Link className="activity-actions-popover__item" to={`/share-summary/${encodeURIComponent(activity.activityId)}${shareQuery ? `?${shareQuery}` : ""}`} onClick={() => setMenuOpen(false)}>生成活动分享摘要</Link>
          </nav>
        </Popover.Content></Popover.Portal>
      </Popover.Root>
    </div></header>
    <main className="workspace-content"><div className="workspace-page settlement-page">
      {offline ? <div className="notice" role="status"><Info size={18} /><span>当前离线，以下结算使用最近一次同步的只读快照。</span></div> : null}
      <button type="button" className="settlement-date-entry" aria-label="结算日期" disabled={offline || !preview.data || preview.isFetching || confirmOffsets.isPending} onClick={() => setDatesOpen(true)}><strong>结算日期</strong><span>{offline ? "全部日期 · 离线快照" : dateSummary}<ChevronDown size={18} aria-hidden="true" /></span></button>
      <section className="settlement-summary" aria-label="我的结算"><PersonalBalance currency={activity.baseCurrency} netMinor={current?.netMinor} error={ledger.error} onRetry={() => void ledger.refetch()} /></section>
      <section className="settlement-members"><button className="balance-entry" type="button" aria-label="成员余额" aria-expanded={balanceOpen} data-focus-key="member-balances" onClick={() => setBalanceOpen(value => !value)}><strong>成员余额</strong><span>{ledger.error ? "读取失败" : balances ? `${balances.filter(balance => BigInt(balance.netMinor) !== 0n).length} 人未结清` : "正在读取"}</span><ChevronDown className={balanceOpen ? "is-expanded" : ""} size={18} aria-hidden="true" /></button>
        {balanceOpen ? balances && memberReady && !ledger.error ? <div className="settlement-balance-list">{balances.map(balance => {
          const net = BigInt(balance.netMinor);
          return <div className="balance-row" key={balance.memberId} data-reading-key={`member-${balance.memberId}`}><MemberAvatar memberId={balance.memberId} {...memberAvatarImage(balance.memberId, memberData)} displayName={memberName(balance.memberId, memberData)} avatarPreset={memberAvatarPreset(balance.memberId, memberData)} /><strong>{memberName(balance.memberId, memberData)}{balance.memberId === activity.currentMemberId ? "（我）" : ""}</strong><span>{net > 0n ? "应收" : net < 0n ? "应付" : "余额已平"}{net !== 0n ? <Money value={formatMoney(activity.baseCurrency, (net < 0n ? -net : net).toString())} tone={net > 0n ? "positive" : "negative"} /> : null}</span></div>;
        })}</div> : !ledger.error && !members.error ? <AccountingSkeleton kind="settlement" section /> : null : null}
      </section>
      <section className="settlement-section" aria-labelledby="recommendations-heading">
        <header className="settlement-section__heading"><div className="settlement-section__title"><h2 id="recommendations-heading">推荐转账</h2>{rows && !preview.error ? <span>· {rows.length} 笔</span> : null}<small>{activity.baseCurrency}</small></div>
          {!fullySettled ? <button type="button" className="settlement-strategy-trigger" aria-label="切换结算方案" disabled={offline || !memberReady} onClick={() => { capturePosition(); setStrategySheetOpen(true); }}>{offline ? '最近同步结果' : selectedStrategy === 'centralized' ? '由我统一收付' : '最少转账'}<ChevronDown size={14} aria-hidden="true" /></button> : null}
        </header>
        <div className="settlement-card settlement-card--recommendations">
        {!offline && (preview.error || members.error) ? <div className="settlement-card__state"><RefreshError error={preview.error ?? members.error} retry={() => { void preview.refetch(); void members.refetch(); }} />{settlementDates && preview.error ? <Button variant="ghost" onClick={() => setSettlementDates(null)}>恢复全部日期</Button> : null}</div>
        : fullySettled ? <div className="settlement-card__state settlement-card__state--complete"><Check size={20} aria-hidden="true" /><span>{!offline && settlementDates ? "所选日期已结清" : "全员余额已结清"}</span></div>
        : !offline && preview.data?.requiresOffsetConfirmation ? <div className="settlement-card__state settlement-offset-confirm"><span>无需转账，{preview.data.offsetExpenseCount} 笔账单可抵销结清。</span><Button disabled={!writable || preview.isFetching || Boolean(confirmOffsets.error)} busy={confirmOffsets.isPending} onClick={() => void confirmSelectedOffsets()}>确认抵销</Button></div>
        : rows && memberReady ? rows.length ? <div className="settlement-recommendations">{rows.map(recommendation => {
          const key = `${recommendation.payerMemberId}-${recommendation.receiverMemberId}`;
          const content = <><span className="settlement-recommendation-content"><TransferParties payer={recommendation.payerMemberId} receiver={recommendation.receiverMemberId} members={memberData} /></span><span className="settlement-recommendation-actions"><Money value={formatMoney(activity.baseCurrency, recommendation.amountMinor)} />{writable ? <ChevronRight size={16} aria-hidden="true" /> : null}</span></>;
          return <div className="settlement-recommendation-item" key={key} data-reading-key={`transfer-${key}`}>
            {writable ? <button type="button" disabled={preview.isFetching} className="settlement-recommendation-row settlement-recommendation-trigger" data-focus-key={`transfer-${key}`} aria-label={`记录 ${memberName(recommendation.payerMemberId, memberData)}付给${memberName(recommendation.receiverMemberId, memberData)}`} onClick={() => openForm({ key, initial: recommendation })}>{content}</button> : <div className="settlement-recommendation-row">{content}</div>}
          </div>;
        })}</div> : <p className="settlement-card__state settlement-empty">当前暂无推荐转账</p> : <div className="settlement-card__state"><AccountingSkeleton kind="settlement" section /></div>}
        {confirmOffsets.error && !offline ? <div className="settlement-card__state"><ErrorNotice error={confirmOffsets.error} /><Button variant="ghost" onClick={() => { confirmOffsets.reset(); void preview.refetch(); }}>刷新结算预览</Button></div> : null}
        {writable && !fullySettled && !preview.data?.requiresOffsetConfirmation ? <div className="settlement-card__footer" data-reading-key="manual-settlement"><Button variant="ghost" disabled={preview.isFetching} aria-label="记录其他转账" data-focus-key="manual-settlement" onClick={() => openForm({ key: "manual" })}>＋ 记录其他转账</Button></div> : null}
        </div>
      </section>
      <section className="settlement-section" aria-labelledby="settlement-history-heading"><header className="settlement-section__heading"><div className="settlement-section__title"><h2 id="settlement-history-heading">全部结算记录</h2>{records ? <span>· {records.length} 笔</span> : null}<small>{activity.baseCurrency}</small></div></header>
        {!offline && settlementDates ? <p className="settlement-history-hint">包含活动全部结算记录</p> : null}
        <div className="settlement-card settlement-card--history">
        <RefreshError error={settlements.error} retry={() => void settlements.refetch()} />
        {records && memberReady ? records.length ? <div className="settlement-list">{[...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(record => <SettlementRow key={record.settlementId} settlement={record} members={memberData} writable={writable} onEdit={() => openForm({ key: record.settlementId, existing: record })} beforeChange={capturePosition} afterChange={restorePosition} />)}</div> : !settlements.error ? <div className="settlement-card__state settlement-history-empty"><UsersRound size={22} aria-hidden="true" /><p>还没有结算记录</p></div> : null : !settlements.error && !members.error ? <div className="settlement-card__state"><AccountingSkeleton kind="settlement" section /></div> : null}
        </div>
      </section>
    </div></main>
    <RecommendationStrategyOverlay open={strategySheetOpen} selected={selectedStrategy} recommended={recommendedCentralized} onClose={() => setStrategySheetOpen(false)} onSelect={strategy => { capturePosition(); setStrategySelection(strategy === "centralized" ? { strategy, hubMemberId: activity.currentMemberId } : { strategy }); setStrategySheetOpen(false); }} />
    {datesOpen && !offline && preview.data ? <SettlementDates dates={settlementDates} options={preview.data.dateOptions} onApply={dates => { capturePosition(); setSettlementDates(dates); confirmOffsets.reset(); }} onClose={() => setDatesOpen(false)} /> : null}
    {form && !offline && activity.status !== "ARCHIVED" ? <SettlementForm key={form.key} initial={form.initial} existing={form.existing} scope={form.scope} members={memberData} onClose={closeForm} onRefresh={() => preview.refetch()} /> : null}
  </div>;
}
