import { ArrowRight, Bell, ChevronRight, Link as LinkIcon, Plus, RotateCcw, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { formatMoney } from "../../domain-preview/money";
import {
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  LoadingState,
  Money,
  Select,
} from "../../components/ui";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { Overlay } from "../../components/overlay";
import { useActivityLedgersQuery } from "../accounting/api";
import {
  type Activity,
  useActivitiesQuery,
  useCreateActivityMutation,
  useDeletedActivitiesQuery,
  useRestoreActivityMutation,
} from "./api";
import { useSessionQuery } from "../auth/api";
import { useNotificationsQuery } from "../notifications/api";
import { activityStatus, activityPeriodLabel } from "./presentation";

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

function localCalendarToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** 首页四种面板状态统一由 URL 驱动，便于系统返回和刷新后恢复可预测的入口层级。 */
type ActivityPanel = "actions" | "create" | "join" | "deleted";

function activityPanelFromSearch(value: string | null): ActivityPanel | null {
  return value === "actions" || value === "create" || value === "join" || value === "deleted" ? value : null;
}

function activityPanelDepth(state: unknown): number | null {
  if (!state || typeof state !== "object" || !("activityPanelDepth" in state)) return null;
  const depth = (state as { activityPanelDepth?: unknown }).activityPanelDepth;
  return depth === 1 || depth === 2 ? depth : null;
}

type ActivityLedgerResult = ReturnType<typeof useActivityLedgersQuery>[number];

type LedgerReadiness = "pending" | "error" | "ready";

type ActivitySummary = {
  payable: bigint;
  receivable: bigint;
  readiness: LedgerReadiness;
};

function ledgerReadiness(ledger: ActivityLedgerResult | undefined): LedgerReadiness {
  if (!ledger || ledger.isPending) return "pending";
  if (ledger.isError || !ledger.data) return "error";
  return "ready";
}

function summarizeLedgers(activities: readonly Activity[], ledgers: ReturnType<typeof useActivityLedgersQuery>) {
  const byCurrency = new Map<string, ActivitySummary>();
  activities.forEach((activity, index) => {
    const ledger = ledgers[index];
    const readiness = ledgerReadiness(ledger);
    const current = byCurrency.get(activity.baseCurrency) ?? {
      payable: 0n,
      receivable: 0n,
      readiness: "ready" as LedgerReadiness,
    };
    if (readiness === "error") current.readiness = "error";
    else if (readiness === "pending" && current.readiness === "ready") current.readiness = "pending";
    if (readiness !== "ready") {
      byCurrency.set(activity.baseCurrency, current);
      return;
    }
    const balance = ledger.data?.balances.find((item) => item.memberId === activity.currentMemberId);
    const amount = BigInt(balance?.netMinor ?? "0");
    if (amount < 0n) current.payable += -amount;
    if (amount > 0n) current.receivable += amount;
    byCurrency.set(activity.baseCurrency, current);
  });
  return [...byCurrency.entries()];
}

function ActivityListSkeleton() {
  return (
    <div className="activity-list-skeleton" aria-hidden="true">
      <span className="activity-skeleton-block activity-list-skeleton__heading" />
      <ul className="activity-list activity-list-skeleton__list">
        {[0, 1].map((index) => (
          <li className="activity-list-item activity-list-item--skeleton" key={index}>
            <span className="activity-skeleton-block activity-skeleton-block--cover" />
            <span className="activity-list-item__content">
              <span className="activity-skeleton-block activity-skeleton-block--title" />
              <span className="activity-skeleton-block activity-skeleton-block--period" />
            </span>
            <span className="activity-list-item__balance">
              <span className="activity-balance-skeleton"><i /><i /></span>
              <ChevronRight aria-hidden="true" size={16} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActivitySummarySkeleton() {
  return (
    <dl className="home-summary home-summary--skeleton" aria-hidden="true">
      {[0, 1].map((index) => (
        <div key={index}>
          <span className="activity-skeleton-block home-summary--skeleton__label" />
          <span className="activity-skeleton-block home-summary--skeleton__value" />
        </div>
      ))}
    </dl>
  );
}

function ActivityGroup({ title, activities, allActivities, ledgers }: { title: string; activities: readonly Activity[]; allActivities: readonly Activity[]; ledgers: ReturnType<typeof useActivityLedgersQuery> }) {
  if (!activities.length) return null;
  return (
    <section className="activity-group" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`}>{title}</h2>
      <ul className="activity-list">
        {activities.map((activity) => {
          const ledger = ledgers[allActivities.findIndex((item) => item.activityId === activity.activityId)];
          const readiness = ledgerReadiness(ledger);
          const own = readiness === "ready"
            ? ledger?.data?.balances.find((balance) => balance.memberId === activity.currentMemberId)
            : undefined;
          const amount = own ? BigInt(own.netMinor) : 0n;
          return (
            <li key={activity.activityId}>
              <Link className="activity-list-item" to={`/activities/${activity.activityId}`}>
                <img src={`/activity-covers/cover-0${stableIndex(activity.activityId, 6) + 1}.webp`} width={72} height={56} alt="" loading="lazy" decoding="async" />
                <span className="activity-list-item__content"><strong>{activity.name}</strong><small className="activity-list-item__period">{[activityPeriodLabel(activity), activityStatus(activity.status)].filter(Boolean).join(" · ")}</small></span>
                <span className="activity-list-item__balance">
                  {readiness === "pending" ? <span className="activity-balance-skeleton"><i /><i /></span> : null}
                  {readiness === "error" ? <small className="activity-list-item__balance--unavailable">余额暂不可用</small> : null}
                  {readiness === "ready" && amount === 0n ? <small>已结清</small> : null}
                  {readiness === "ready" && amount !== 0n ? <><small>{amount > 0n ? "应收" : "应付"}</small><Money value={formatMoney(activity.baseCurrency, (amount < 0n ? -amount : amount).toString())} tone={amount > 0n ? "positive" : "negative"} /></> : null}
                  <ChevronRight aria-hidden="true" size={16} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function activityDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function DeletedActivityRow({ activity, userId }: { activity: Activity; userId: string }) {
  const restore = useRestoreActivityMutation(userId, activity.activityId);
  return (
    <li className="deleted-activity-row">
      <span>
        <strong>{activity.name}</strong>
        <small>删除于 {activityDateTime(activity.deletedAt!)}</small>
        <small>可恢复至 {activityDateTime(activity.purgeAfter!)}</small>
      </span>
      {activity.canRestore ? <Button variant="secondary" busy={restore.isPending} aria-label={`恢复${activity.name}`} onClick={() => restore.mutate(activity.version)}> <RotateCcw aria-hidden="true" size={17} />恢复</Button> : null}
      {restore.error ? <ErrorNotice error={restore.error} /> : null}
    </li>
  );
}

function DeletedActivities({ activities, userId }: { activities: readonly Activity[]; userId: string }) {
  // deleted 查询可能来自陈旧缓存；恢复期限已过的条目不得重新出现在操作面板中。
  const visible = activities.filter((activity) =>
    Boolean(activity.deletedAt && activity.purgeAfter && Date.parse(activity.purgeAfter) > Date.now()),
  );
  return (
    <section className="activity-group deleted-activities" aria-label="可恢复的活动">
      {visible.length ? <ul className="deleted-activity-list">{visible.map((activity) => <DeletedActivityRow key={activity.activityId} activity={activity} userId={userId} />)}</ul> : <p className="muted-copy">当前没有可恢复的活动。</p>}
    </section>
  );
}

/** 活动列表及其 URL 驱动面板；面板切换和表单草稿仍由列表页面持有。 */
export function ActivitiesPage() {
  const session = useSessionQuery();
  const activities = useActivitiesQuery(session.data?.userId ?? "");
  const notifications = useNotificationsQuery(session.data?.userId ?? "");
  const routerLocation = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const panel = activityPanelFromSearch(searchParams.get("panel"));
  const deletedActivities = useDeletedActivitiesQuery(session.data?.userId ?? "", panel === "deleted");
  const ledgers = useActivityLedgersQuery(session.data?.userId ?? "", activities.data ?? []);
  const create = useCreateActivityMutation(session.data?.userId ?? "");
  const [joinToken, setJoinToken] = useState("");
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("CNY");
  const [startDate, setStartDate] = useState(localCalendarToday);
  const [endDate, setEndDate] = useState("");
  const [createError, setCreateError] = useState<unknown>();

  function openPanel(nextPanel: ActivityPanel) {
    const next = new URLSearchParams(searchParams);
    next.set("panel", nextPanel);
    setSearchParams(next, { state: { activityPanelDepth: nextPanel === "create" || nextPanel === "join" ? 2 : 1 } });
  }

  function closePanel() {
    const depth = activityPanelDepth(routerLocation.state);
    if (depth !== null) {
      navigate(-depth);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("panel");
    setSearchParams(next, { replace: true, state: null });
  }

  function backToActions() {
    if (activityPanelDepth(routerLocation.state) === 2) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set("panel", "actions");
    setSearchParams(next, { replace: true, state: null });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCreateError(undefined);
    try {
      await create.mutateAsync({
        name,
        location: location.trim() || null,
        baseCurrency,
        startDate,
        endDate: endDate || null,
      });
      setName("");
      setLocation("");
      setBaseCurrency("CNY");
      setStartDate(localCalendarToday());
      setEndDate("");
      closePanel();
    } catch (error) {
      setCreateError(error);
    }
  }

  const listPending = session.isPending || activities.isPending;
  const listError = session.error ?? activities.error;
  const items = activities.data ?? [];
  const summaries = summarizeLedgers(items, ledgers);
  const active = items.filter((item) => item.status === "ACTIVE");
  const ended = items.filter((item) => item.status === "ENDED");
  const archived = items.filter((item) => item.status === "ARCHIVED");
  function openChildPanel(nextPanel: "create" | "join") {
    if (panel === "actions") {
      openPanel(nextPanel);
      return;
    }
    // 空活动首页的快捷按钮直接进入表单，但仍为系统返回保留“选择操作”这一历史层级。
    const actions = new URLSearchParams(searchParams);
    actions.set("panel", "actions");
    navigate({ pathname: routerLocation.pathname, search: `?${actions.toString()}` }, { state: { activityPanelDepth: 1 } });
    const create = new URLSearchParams(actions);
    create.set("panel", nextPanel);
    navigate({ pathname: routerLocation.pathname, search: `?${create.toString()}` }, { state: { activityPanelDepth: 2 } });
  }
  const openCreate = () => openChildPanel("create");
  const openJoin = () => openChildPanel("join");
  const notificationsUnreadCount = notifications.data?.unreadCount ?? 0;
  const notificationsUnreadLabel = notificationsUnreadCount > 0
    ? `通知，${notificationsUnreadCount} 条未读`
    : "通知";
  return (
    <div className="top-level-page activities-page">
      <main className="app-frame app-frame--with-nav" aria-busy={listPending}>
        {listPending ? <span className="sr-only" role="status">正在读取活动…</span> : null}
        <header className="home-header">
          <div className="home-header__title">
            <h1>活动</h1>
            <button className="icon-button" type="button" aria-label="已删除活动" title="已删除活动" onClick={() => openPanel("deleted")}>
              <Trash2 aria-hidden="true" size={18} />
            </button>
          </div>
          <div className="home-header__actions">
            <Link className="icon-button activity-notifications-trigger" to="/notifications" aria-label={notificationsUnreadLabel} title="通知">
              <Bell aria-hidden="true" size={20} />
              {notificationsUnreadCount > 0 ? <span className="activity-notifications-trigger__badge" aria-hidden="true" /> : null}
            </Link>
          </div>
        </header>
        {!listPending && !listError ? summaries.map(([currency, summary]) => (
          <dl className="home-summary" key={currency} aria-label={`${currency} 跨活动账务摘要`}>
            <div><dt>待支付</dt><dd>{summary.readiness === "pending" ? <span className="home-summary__skeleton" aria-hidden="true" /> : summary.readiness === "error" ? <small className="home-summary__unavailable">暂不可用</small> : <Money value={formatMoney(currency, summary.payable.toString())} tone="negative" />}</dd></div>
            <div><dt>待收款</dt><dd>{summary.readiness === "pending" ? <span className="home-summary__skeleton" aria-hidden="true" /> : summary.readiness === "error" ? <small className="home-summary__unavailable">暂不可用</small> : <Money value={formatMoney(currency, summary.receivable.toString())} tone="positive" />}</dd></div>
          </dl>
        )) : null}
        {listPending ? <ActivitySummarySkeleton /> : null}
        {listPending ? <ActivityListSkeleton /> : null}
        {listError ? <ErrorNotice error={listError} /> : null}
        {!listPending && !listError && !items.length ? <EmptyState
          icon={<Plus size={28} />}
          visual={<img className="activity-empty-illustration" src="/illustrations/activity-list-empty.webp" alt="" aria-hidden="true" width={960} height={640} loading="eager" sizes="(max-width: 351px) calc(100vw - 32px), 320px" />}
          title="还没有活动"
          description="创建第一个活动后，就可以开始记录消费。"
          action={<div className="empty-state__actions"><Button className="activity-empty-create" onClick={openCreate}>创建活动</Button><Button className="activity-empty-join" variant="ghost" onClick={openJoin}>加入已有活动</Button></div>}
        /> : null}
        <ActivityGroup title="进行中的活动" activities={active} allActivities={items} ledgers={ledgers} />
        <ActivityGroup title="最近结束" activities={ended} allActivities={items} ledgers={ledgers} />
        {archived.length ? <details className="activity-history"><summary>查看历史活动</summary><ActivityGroup title="已归档" activities={archived} allActivities={items} ledgers={ledgers} /></details> : null}
      </main>
      <ProductBottomNavigation />
      <button className="activity-add-fab" type="button" aria-label="新建或加入活动" title="新建或加入活动" onClick={() => openPanel("actions")}><Plus aria-hidden="true" size={24} /></button>
      <Overlay open={panel === "actions" || panel === "create" || panel === "join"} title={panel === "create" ? "创建活动" : panel === "join" ? "加入活动" : "新建或加入活动"} onBack={panel === "create" || panel === "join" ? { label: "新建或加入活动", onClick: backToActions } : undefined} onClose={closePanel} focusKey={panel ?? "closed"} className="activity-home-overlay activity-actions-overlay">
        {panel === "actions" ? <div className="overlay-action-list">
          <button type="button" className="settings-row" data-overlay-initial-focus onClick={openCreate}><Plus aria-hidden="true" size={20} /><span><strong>创建活动</strong><small>为旅行或聚会建立新的账本</small></span><ChevronRight aria-hidden="true" size={18} /></button>
          <button type="button" className="settings-row" onClick={openJoin}><LinkIcon aria-hidden="true" size={20} /><span><strong>加入活动</strong><small>粘贴活动所有者发送的邀请口令</small></span><ChevronRight aria-hidden="true" size={18} /></button>
        </div> : null}
        {panel === "create" ? <form className="form-stack" onSubmit={submit}>
          <Field label="活动名称"><Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></Field>
          <Field label="地点（可选）"><Input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} /></Field>
          <Field label="主币种"><Select value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value)}><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option><option value="EUR">EUR 欧元</option><option value="JPY">JPY 日元</option></Select></Field>
          <Field label="开始日期"><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></Field>
          <Field label="结束日期（可选）"><Input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></Field>
          {createError ?? create.error ? <ErrorNotice error={createError ?? create.error} /> : null}
          <Button type="submit" busy={create.isPending}>创建活动</Button>
        </form> : null}
        {panel === "join" ? <form className="form-stack" onSubmit={(event) => { event.preventDefault(); const token = joinToken.trim(); if (token) navigate(`/join/${encodeURIComponent(token)}`); }}>
          <Field label="邀请口令" hint="向活动所有者索取邀请口令后粘贴到这里。"><Input value={joinToken} onChange={(event) => setJoinToken(event.target.value)} autoComplete="off" autoFocus required /></Field>
          <Button type="submit">查看邀请 <ArrowRight aria-hidden="true" size={18} /></Button>
        </form> : null}
      </Overlay>
      <Overlay open={panel === "deleted"} title="已删除活动" onClose={closePanel} focusKey={panel ?? "closed"} className="activity-home-overlay deleted-activities-overlay">
        {deletedActivities.isPending ? <LoadingState label="正在读取已删除活动…" /> : null}
        {deletedActivities.error ? <ErrorNotice error={deletedActivities.error} /> : null}
        {!deletedActivities.isPending && !deletedActivities.error
          ? <DeletedActivities activities={deletedActivities.data ?? []} userId={session.data?.userId ?? ""} />
          : null}
      </Overlay>
    </div>
  );
}
