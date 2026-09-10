import { Check, ChevronDown, ChevronRight, ImageDown, Info, UsersRound } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError } from "../../api/error";
import { MemberAvatar } from "../../components/member-avatar";
import { Button, ConfirmDialog, EmptyState, ErrorNotice, Field, Input, Money, StateIllustration } from "../../components/ui";
import { amountToMinor, formatMoney, minorToInput } from "../../domain-preview/money";
import { type ActivityMember, useMembersQuery } from "../activities/api";
import { useWorkspace } from "../activities/workspace-context";
import { type Settlement, useCreateSettlementMutation, useLedgerQuery, useRecommendationsQuery, useSettlementsQuery, useUpdateSettlementMutation, useVoidSettlementMutation } from "./api";
import { memberAvatarPreset, memberName } from "./shared";
import { AccountingSkeleton } from "./skeleton";

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
          <span><small>{label}</small><strong>{selected ? <><MemberAvatar memberId={selected.memberId} displayName={selected.displayName} avatarPreset={selected.avatarPreset} size="sm" />{selected.displayName}</> : '请选择'}</strong></span><ChevronDown size={18} aria-hidden="true" />
        </button>
        {opened === field ? <div className="settlement-member-options" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
          <Input aria-label={`搜索${label}`} placeholder="搜索成员姓名" value={search} onChange={event => setSearch(event.target.value)} autoFocus />
          <div className="quick-member-list" role="group" aria-label={`选择${label}`}>
            {members.filter(member => member.status === 'ACTIVE' && member.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(member => <button type="button" className="quick-member-row__button" key={member.memberId} disabled={member.memberId === other} aria-label={`${member.displayName}${member.memberId === other ? `，已选为${field === "payerMemberId" ? "收款人" : "付款人"}` : ""}`} aria-pressed={member.memberId === value[field]} onClick={() => { onChange({ ...value, [field]: member.memberId }); close(); }}>
              <MemberAvatar memberId={member.memberId} displayName={member.displayName} avatarPreset={member.avatarPreset} size="sm" /><span>{member.displayName}{member.memberId === other ? <small>已选为{field === 'payerMemberId' ? '收款人' : '付款人'}</small> : null}</span>{member.memberId === value[field] ? <Check size={18} aria-hidden="true" /> : <span />}
            </button>)}
            {!members.some(member => member.status === 'ACTIVE' && member.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ? <p className="settlement-empty">没有找到成员</p> : null}
          </div><Button variant="ghost" onClick={close}>取消选择</Button>
        </div> : null}
      </div>;
    })}
  </div>;
}

/** 推荐与补记只有初值不同，校验、成员选择、提交和取消使用同一实现。 */
function SettlementForm({ initial, members, onClose }: { initial?: Recommendation; members: readonly ActivityMember[]; onClose: () => void }) {
  const { session, activity } = useWorkspace();
  const create = useCreateSettlementMutation(session.userId, activity.activityId);
  const [parties, setParties] = useState<Parties>({ payerMemberId: initial?.payerMemberId ?? '', receiverMemberId: initial?.receiverMemberId ?? '' });
  const [amount, setAmount] = useState(initial ? minorToInput(initial.amountMinor, activity.baseCurrency) : '');
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(undefined);
    if (!parties.payerMemberId || !parties.receiverMemberId) { setError('请选择付款人和收款人。'); return; }
    if (parties.payerMemberId === parties.receiverMemberId) { setError('付款人与收款人不能相同。'); return; }
    if (![parties.payerMemberId, parties.receiverMemberId].every(id => members.some(member => member.memberId === id && member.status === 'ACTIVE'))) { setError('所选成员已不可参与结算，请重新选择。'); return; }
    try {
      const amountMinor = amountToMinor(amount, activity.baseCurrency);
      if (BigInt(amountMinor) <= 0n) { setError('结算金额必须大于零。'); return; }
      await create.mutateAsync({ ...parties, amountMinor, currency: activity.baseCurrency, clientMutationId: crypto.randomUUID() }); onClose();
    } catch (reason) { if (!(reason instanceof ApiRequestError)) setError(reason instanceof Error ? reason.message : '结算输入不正确。'); }
  }
  return <form className="settlement-inline-form form-stack" aria-label={initial ? '记录推荐转账' : '补记结算'} onSubmit={event => void submit(event)}>
    <fieldset disabled={create.isPending}><SettlementParties members={members} value={parties} onChange={setParties} />
      <Field label={`金额（${activity.baseCurrency}）`}><Input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
    </fieldset>
    {error ? <p role="alert" className="notice notice--error">{error}</p> : null}{create.error ? <ErrorNotice error={create.error} /> : null}
    <div className="settlement-form-actions"><Button type="submit" busy={create.isPending}>记录结算</Button><Button variant="ghost" disabled={create.isPending} onClick={onClose}>取消</Button></div>
  </form>;
}

function TransferParties({ payer, receiver, members }: { payer: string; receiver: string; members: readonly ActivityMember[] }) {
  return <span className="settlement-transfer"><span><MemberAvatar memberId={payer} displayName={memberName(payer, members)} avatarPreset={memberAvatarPreset(payer, members)} size="sm" /><strong>{memberName(payer, members)}</strong></span><small>付给</small><span><MemberAvatar memberId={receiver} displayName={memberName(receiver, members)} avatarPreset={memberAvatarPreset(receiver, members)} size="sm" /><strong>{memberName(receiver, members)}</strong></span></span>;
}

function SettlementRow({ settlement, members, writable }: { settlement: Settlement; members: readonly ActivityMember[]; writable: boolean }) {
  const { session, activity } = useWorkspace();
  const update = useUpdateSettlementMutation(session.userId, activity.activityId);
  const voidMutation = useVoidSettlementMutation(session.userId, activity.activityId);
  const [editing, setEditing] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string>();
  async function save(event: FormEvent) {
    event.preventDefault(); setError(undefined);
    try {
      const amountMinor = amountToMinor(amount, settlement.currency);
      if (BigInt(amountMinor) <= 0n) { setError('结算金额必须大于零。'); return; }
      await update.mutateAsync({ settlementId: settlement.settlementId, input: { amountMinor, payerMemberId: settlement.payerMemberId, receiverMemberId: settlement.receiverMemberId, version: settlement.version } }); setEditing(false);
    } catch (reason) { if (!(reason instanceof ApiRequestError)) setError(reason instanceof Error ? reason.message : '结算金额不正确。'); }
  }
  return <article className={`settlement-record${settlement.status === 'VOID' ? ' settlement-record--void' : ''}`}>
    <div className="settlement-record__main"><TransferParties payer={settlement.payerMemberId} receiver={settlement.receiverMemberId} members={members} /><span className="settlement-record__amount"><Money value={formatMoney(settlement.currency, settlement.amountMinor)} /><small>{settlement.currency}</small></span></div>
    <div className="settlement-record__meta"><time dateTime={settlement.createdAt}>记录于 {new Date(settlement.createdAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time><span className="settlement-record__status">{settlement.status === 'VOID' ? '已作废' : '已记录'}</span></div>
    {writable && settlement.status === 'ACTIVE' && !editing ? <div className="settlement-record__actions"><Button variant="ghost" onClick={() => { setAmount(minorToInput(settlement.amountMinor, settlement.currency)); setError(undefined); setEditing(true); }}>修改</Button><Button variant="ghost" onClick={() => setVoidOpen(true)}>作废</Button></div> : null}
    {editing && writable ? <form className="settlement-inline-form form-stack" aria-label="修改结算" onSubmit={event => void save(event)}><Field label={`结算金额（${settlement.currency}）`}><Input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" required autoFocus disabled={update.isPending} /></Field>{error ? <p role="alert">{error}</p> : null}{update.error ? <ErrorNotice error={update.error} /> : null}<div className="settlement-form-actions"><Button type="submit" busy={update.isPending}>保存</Button><Button variant="ghost" disabled={update.isPending} onClick={() => { setEditing(false); setAmount(minorToInput(settlement.amountMinor, settlement.currency)); }}>取消</Button></div></form> : null}
    <ConfirmDialog open={voidOpen && writable} title="作废结算" message="作废后这笔结算将不再计入余额，确定继续吗？" confirmLabel="确认作废" busy={voidMutation.isPending} error={voidMutation.error ? <ErrorNotice error={voidMutation.error} /> : undefined} onConfirm={() => void voidMutation.mutateAsync({ settlementId: settlement.settlementId, version: settlement.version }).then(() => setVoidOpen(false)).catch(() => undefined)} onCancel={() => setVoidOpen(false)} />
  </article>;
}

function RefreshError({ error, retry }: { error: unknown; retry: () => void }) {
  return error ? <div className="settlement-load-error"><ErrorNotice error={error} /><Button variant="ghost" onClick={retry}>重试</Button></div> : null;
}

/** 各区域只等待自身所需的数据；已有数据在后台刷新时继续展示，未知余额不能推断为已结清。 */
export function SettlementsPage() {
  const { session, activity, members: cachedMembers, offline, snapshot } = useWorkspace();
  const members = useMembersQuery(session.userId, activity.activityId, !offline);
  const ledger = useLedgerQuery(session.userId, activity.activityId, !offline);
  const recommendations = useRecommendationsQuery(session.userId, activity.activityId, !offline);
  const settlements = useSettlementsQuery(session.userId, activity.activityId, !offline);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [form, setForm] = useState<{ key: string; initial?: Recommendation }>();
  const memberData = members.data ?? cachedMembers ?? [];
  const ledgerData = ledger.data ?? snapshot?.snapshot.ledger;
  const recommendationData = recommendations.data ?? snapshot?.snapshot.recommendations;
  const records = settlements.data ?? snapshot?.snapshot.settlements;
  const balances = ledgerData?.balances;
  const current = balances?.find(balance => balance.memberId === activity.currentMemberId);
  const currentAmount = current ? BigInt(current.netMinor) : undefined;
  const fullySettled = Boolean(balances?.length && balances.every(balance => BigInt(balance.netMinor) === 0n));
  const memberReady = memberData.length > 0;
  const writable = activity.status !== 'ARCHIVED' && !offline && memberReady && Boolean(ledgerData) && !members.error && !ledger.error;
  const blockingError = [members.error, ledger.error, recommendations.error, settlements.error].find(error => error instanceof ApiRequestError && [401, 403, 404].includes(error.status));
  if (blockingError) return <ErrorNotice error={blockingError} />;
  const rows = recommendationData?.recommendations;
  const closeForm = () => setForm(undefined);
  return <div className="workspace-page settlement-page">
    {offline ? <div className="notice" role="status"><Info size={18} /><span>当前离线，以下结算使用最近一次同步的只读快照。</span></div> : null}
    <RefreshError error={members.error} retry={() => void members.refetch()} />
    <section className="settlement-summary" aria-label="我的结算">
      <header><p>我的结算</p><Link className="settlement-share-entry" to={`/share-summary/${encodeURIComponent(activity.activityId)}`}><ImageDown size={17} aria-hidden="true" />生成分享摘要</Link></header>
      {currentAmount !== undefined ? <><div><strong>{currentAmount > 0n ? '应收' : currentAmount < 0n ? '应付' : '已结清'}</strong>{currentAmount !== 0n ? <Money value={formatMoney(activity.baseCurrency, (currentAmount < 0n ? -currentAmount : currentAmount).toString())} tone={currentAmount > 0n ? 'positive' : 'negative'} /> : null}</div><small>{balances!.filter(balance => BigInt(balance.netMinor) !== 0n).length} 人未结清 · {balances!.filter(balance => BigInt(balance.netMinor) === 0n).length} 人已结清</small></> : ledger.error ? null : <AccountingSkeleton kind="settlement" section />}
      <RefreshError error={ledger.error} retry={() => void ledger.refetch()} />
    </section>
    <section className="settlement-section" aria-labelledby="recommendations-heading"><h2 id="recommendations-heading">推荐转账</h2><RefreshError error={recommendations.error} retry={() => void recommendations.refetch()} />
      {rows && memberReady ? rows.length ? <div className="settlement-recommendations">{rows.map(recommendation => {
        const key = `${recommendation.payerMemberId}-${recommendation.receiverMemberId}`;
        const content = <><TransferParties payer={recommendation.payerMemberId} receiver={recommendation.receiverMemberId} members={memberData} /><Money value={formatMoney(activity.baseCurrency, recommendation.amountMinor)} />{writable ? <ChevronRight size={16} aria-hidden="true" /> : null}</>;
        return <div className="settlement-recommendation-item" key={key}>{writable ? <button type="button" className="settlement-recommendation-trigger" aria-expanded={form?.key === key} onClick={() => setForm(form?.key === key ? undefined : { key, initial: recommendation })}>{content}</button> : <div className="settlement-recommendation-trigger">{content}</div>}{writable && form?.key === key ? <SettlementForm key={key} initial={form.initial} members={memberData} onClose={closeForm} /> : null}</div>;
      })}</div> : <p className="settlement-empty">{fullySettled ? '所有成员余额均已结清' : '当前暂无推荐转账'}</p> : !recommendations.error && !members.error ? <AccountingSkeleton kind="settlement" section /> : null}
    </section>
    <section className="settlement-section"><button className="balance-entry" type="button" aria-expanded={balanceOpen} onClick={() => setBalanceOpen(value => !value)}><strong>成员余额</strong><ChevronDown className={balanceOpen ? 'is-expanded' : ''} size={18} aria-hidden="true" /></button>
      {balanceOpen ? balances && memberReady ? <div className="settlement-balance-list">{balances.map(balance => { const net = BigInt(balance.netMinor); return <div className="balance-row" key={balance.memberId}><MemberAvatar memberId={balance.memberId} displayName={memberName(balance.memberId, memberData)} avatarPreset={memberAvatarPreset(balance.memberId, memberData)} /><strong>{memberName(balance.memberId, memberData)}</strong><span>{net > 0n ? '应收' : net < 0n ? '应付' : '已结清'}{net !== 0n ? <Money value={formatMoney(activity.baseCurrency, (net < 0n ? -net : net).toString())} tone={net > 0n ? 'positive' : 'negative'} /> : null}</span></div>; })}</div> : !ledger.error && !members.error ? <AccountingSkeleton kind="settlement" section /> : null : null}
    </section>
    {fullySettled ? <div className="settlement-complete"><Check size={19} />全部已结清</div> : null}
    <section className="settlement-section" aria-labelledby="settlement-history-heading"><header><h2 id="settlement-history-heading">实际结算记录</h2>{writable && !fullySettled ? <Button variant="ghost" onClick={() => setForm(form?.key === 'manual' ? undefined : { key: 'manual' })}>补记结算</Button> : null}</header>
      {writable && form?.key === 'manual' ? <SettlementForm members={memberData} onClose={closeForm} /> : null}
      <RefreshError error={settlements.error} retry={() => void settlements.refetch()} />
      {records && memberReady ? records.length ? <div className="settlement-list">{records.map(record => <SettlementRow key={record.settlementId} settlement={record} members={memberData} writable={writable} />)}</div> : <EmptyState icon={<UsersRound size={24} />} visual={<StateIllustration src="/illustrations/settlement-history-empty.webp" size="compact" />} title="还没有结算记录" description="完成转账后，在这里补记结算。" /> : !settlements.error && !members.error ? <AccountingSkeleton kind="settlement" section /> : null}
    </section>
  </div>;
}
