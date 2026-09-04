import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  CircleDollarSign,
  Download,
  CalendarDays,
  KeyRound,
  Link as LinkIcon,
  MapPin,
  MoreHorizontal,
  Plus,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Link,
  Outlet,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { formatMoney } from "../../domain-preview/money";
import { Button, EmptyState, ErrorNotice, Field, Input, LoadingState, Money, Select } from "../../components/ui";
import { MemberAvatar } from "../../components/member-avatar";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { useSheetDrag } from "../../components/gesture-sheet";
import { useActivityLedgersQuery } from "../accounting/api";
import {
  type Activity,
  type ActivityMember,
  type CreatedInvitation,
  type Invitation,
  type InvitationIntent,
  type UpdateActivityInput,
  useActivityLifecycleMutation,
  useActivitiesQuery,
  useActivityQuery,
  useCreateActivityMutation,
  useDeleteActivityMutation,
  useDeletedActivitiesQuery,
  useCreateGuestMutation,
  useCreateGuestBindingInvitationMutation,
  useCreateInvitationMutation,
  useInvitationsQuery,
  useJoinRequestsQuery,
  useMembersQuery,
  useDecideJoinRequestMutation,
  useRevokeInvitationMutation,
  useRestoreActivityMutation,
  useTransferOwnershipMutation,
  useUpdateActivityMutation,
} from "./api";
import { type Session, useLogoutMutation, useSessionQuery } from "../auth/api";
import { useActivitySnapshotQuery, useOnlineStatus } from "./offline-workspace";
import { inclusiveCalendarDays } from "../../lib/calendar-date";

type WorkspaceValue = { session: Session; activity: Activity; members: ActivityMember[]; offline: boolean; snapshot?: ReturnType<typeof useActivitySnapshotQuery>["data"] };
const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("活动页面必须在 ActivityWorkspace 中使用。");
  return value;
}

function activityStatus(status: string): string {
  if (status === "ACTIVE") return "进行中";
  if (status === "ENDED") return "已结束";
  return "已归档";
}

/** 活动列表沿用 v0.0.2 的可扫描元数据：优先显示包含首尾两天的持续天数。 */
function activityPeriodLabel(activity: Activity): string {
  const days = inclusiveCalendarDays(activity.startDate, activity.endDate);
  if (days !== null) return `${days}天`;
  return [activity.location, activity.startDate].filter(Boolean).join(" · ");
}

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

function localCalendarToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function Overlay({ open, title, backLabel, onBack, onClose, focusKey, children }: { open: boolean; title: string; backLabel?: string; onBack?: () => void; onClose: () => void; focusKey?: string; children: ReactNode }) {
  const titleId = useId();
  const { sheetRef, headerProps, style: sheetStyle } = useSheetDrag({ open, onClose });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = sheetRef.current;
    const focusableSelector = "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const initialFocus = sheet?.querySelector<HTMLElement>("[data-overlay-initial-focus]")
      ?? sheet?.querySelector<HTMLElement>("input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")
      ?? sheet?.querySelector<HTMLElement>(focusableSelector);
    initialFocus?.focus();

    // Overlay 自行维持 Escape、Tab 循环和焦点回还，URL 驱动的面板也能得到一致键盘行为。
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !sheet) return;
      const focusable = [...sheet.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [focusKey, open]);

  if (!open) return null;
  return (
    <div className="form-overlay" role="presentation">
      <button className="form-overlay__scrim" type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} />
      <section ref={sheetRef} style={sheetStyle} className="form-overlay__sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="form-overlay__header" {...headerProps}>
          <div className="form-overlay__header-main">
            {onBack ? <button className="icon-button" type="button" aria-label={backLabel ?? "返回"} onClick={onBack}><ArrowLeft aria-hidden="true" size={20} /></button> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="icon-button" type="button" aria-label={`关闭${title}`} onClick={onClose}><X aria-hidden="true" size={20} /></button>
        </header>
        <div className="form-overlay__body">{children}</div>
      </section>
    </div>
  );
}

function tabUrl(activityId: string, tab: "feed" | "settlement", panel?: "members" | "manage") {
  const query = new URLSearchParams();
  if (tab === "settlement") query.set("tab", "settlement");
  if (panel) query.set("panel", panel);
  const suffix = query.toString();
  return `/activities/${encodeURIComponent(activityId)}${suffix ? `?${suffix}` : ""}`;
}

export function ActivityWorkspace() {
  const { activityId = "" } = useParams();
  const session = useSessionQuery();
  const online = useOnlineStatus();
  const snapshot = useActivitySnapshotQuery(session.data?.userId ?? "", activityId);
  const activity = useActivityQuery(session.data?.userId ?? "", activityId, online);
  const members = useMembersQuery(session.data?.userId ?? "", activityId, online);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  if (session.isPending || (online ? activity.isPending : snapshot.isPending)) return <LoadingState label="正在打开活动…" />;
  if (session.error || (activity.error && !snapshot.data) || snapshot.error && !online) return <ErrorNotice error={session.error ?? activity.error ?? snapshot.error} />;
  if (!session.data) return null;
  const activityData = activity.data ?? snapshot.data?.snapshot.activity;
  const membersData = members.data ?? snapshot.data?.snapshot.members ?? [];
  if (!activityData) return null;

  const tab = searchParams.get("tab") === "settlement" ? "settlement" : "feed";
  const panel = searchParams.get("panel");
  const closePanel = () => navigate(tabUrl(activityId, tab), { replace: true });

  return (
      <WorkspaceContext.Provider value={{ session: session.data, activity: activityData, members: membersData, offline: !online, snapshot: snapshot.data }}>
      <section className="workspace">
        <header className="workspace-header">
          <div className="workspace-header__actions">
            <Link className="back-link" to="/activities" aria-label="返回活动列表"><ArrowLeft aria-hidden="true" size={20} /></Link>
            <span className="workspace-header__spacer" />
            <Link className="workspace-header__members" to={tabUrl(activityId, tab, "members")}>
              <UsersRound aria-hidden="true" size={17} /> 成员 {membersData.length}
            </Link>
            <Link className="icon-button" to={tabUrl(activityId, tab, "manage")} aria-label="活动管理" title="活动管理"><MoreHorizontal aria-hidden="true" size={21} /></Link>
          </div>
          <div className="workspace-header__identity">
            <h1>{activityData.name}</h1>
            <p>{activityPeriodLabel(activityData) ? `${activityPeriodLabel(activityData)} · ` : null}{membersData.length}人 · {activityStatus(activityData.status)}</p>
          </div>
          <nav className="workspace-nav" aria-label="活动导航">
            <Link className={tab === "feed" ? "active" : ""} aria-current={tab === "feed" ? "page" : undefined} to={tabUrl(activityId, "feed")}>流水</Link>
            <Link className={tab === "settlement" ? "active" : ""} aria-current={tab === "settlement" ? "page" : undefined} to={tabUrl(activityId, "settlement")}>结算</Link>
          </nav>
        </header>
        <main className="workspace-content"><Outlet /></main>
      </section>
      {panel === "members" ? <MembersOverlay onClose={closePanel} /> : null}
      {panel === "manage" ? <ActivityManagementOverlay onClose={closePanel} /> : null}
    </WorkspaceContext.Provider>
  );
}

function summarizeLedgers(activities: readonly Activity[], ledgers: ReturnType<typeof useActivityLedgersQuery>) {
  const byCurrency = new Map<string, { payable: bigint; receivable: bigint }>();
  activities.forEach((activity, index) => {
    const balance = ledgers[index]?.data?.balances.find((item) => item.memberId === activity.currentMemberId);
    const amount = BigInt(balance?.netMinor ?? "0");
    const current = byCurrency.get(activity.baseCurrency) ?? { payable: 0n, receivable: 0n };
    if (amount < 0n) current.payable += -amount;
    if (amount > 0n) current.receivable += amount;
    byCurrency.set(activity.baseCurrency, current);
  });
  return [...byCurrency.entries()];
}

function ActivityGroup({ title, activities, allActivities, ledgers }: { title: string; activities: readonly Activity[]; allActivities: readonly Activity[]; ledgers: ReturnType<typeof useActivityLedgersQuery> }) {
  if (!activities.length) return null;
  return (
    <section className="activity-group" aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`}>{title}</h2>
      <ul className="activity-list">
        {activities.map((activity) => {
          const ledger = ledgers[allActivities.findIndex((item) => item.activityId === activity.activityId)];
          const own = ledger?.data?.balances.find((balance) => balance.memberId === activity.currentMemberId);
          const amount = BigInt(own?.netMinor ?? "0");
          return (
            <li key={activity.activityId}>
              <Link className="activity-list-item" to={`/activities/${activity.activityId}`}>
                <img src={`/activity-covers/cover-0${stableIndex(activity.activityId, 6) + 1}.webp`} width={72} height={56} alt="" />
                <span className="activity-list-item__content"><strong>{activity.name}</strong><small className="activity-list-item__period">{[activityPeriodLabel(activity), activityStatus(activity.status)].filter(Boolean).join(" · ")}</small></span>
                <span className="activity-list-item__balance">{amount === 0n ? <small>已结清</small> : <><small>{amount > 0n ? "应收" : "应付"}</small><Money value={formatMoney(activity.baseCurrency, (amount < 0n ? -amount : amount).toString())} tone={amount > 0n ? "positive" : "negative"} /></>}<ChevronRight aria-hidden="true" size={16} /></span>
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
    <section className="activity-group deleted-activities" aria-labelledby="deleted-activities-heading">
      <h2 id="deleted-activities-heading">已删除活动</h2>
      {visible.length ? <ul className="deleted-activity-list">{visible.map((activity) => <DeletedActivityRow key={activity.activityId} activity={activity} userId={userId} />)}</ul> : <p className="muted-copy">当前没有可恢复的活动。</p>}
    </section>
  );
}

export function ActivitiesPage() {
  const session = useSessionQuery();
  const activities = useActivitiesQuery(session.data?.userId ?? "");
  const [deletedOpen, setDeletedOpen] = useState(false);
  const deletedActivities = useDeletedActivitiesQuery(session.data?.userId ?? "", deletedOpen);
  const ledgers = useActivityLedgersQuery(session.data?.userId ?? "", activities.data ?? []);
  const create = useCreateActivityMutation(session.data?.userId ?? "");
  const [actionView, setActionView] = useState<"actions" | "create" | "join" | null>(null);
  const [joinToken, setJoinToken] = useState("");
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("CNY");
  const [startDate, setStartDate] = useState(localCalendarToday);
  const [endDate, setEndDate] = useState("");
  const [createError, setCreateError] = useState<unknown>();

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
      setActionView(null);
    } catch (error) {
      setCreateError(error);
    }
  }

  if (session.isPending || activities.isPending) return <LoadingState label="正在读取活动…" />;
  if (session.error || activities.error) return <ErrorNotice error={session.error ?? activities.error} />;
  const items = activities.data ?? [];
  const summaries = summarizeLedgers(items, ledgers);
  const active = items.filter((item) => item.status === "ACTIVE");
  const ended = items.filter((item) => item.status === "ENDED");
  const archived = items.filter((item) => item.status === "ARCHIVED");
  const openCreate = () => setActionView("create");
  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="home-header"><h1>活动</h1><button className="home-add" type="button" aria-label="新建或加入活动" title="新建或加入活动" onClick={() => setActionView("actions")}><Plus aria-hidden="true" size={18} /></button></header>
        {summaries.map(([currency, summary]) => (
          <dl className="home-summary" key={currency} aria-label={`${currency} 跨活动账务摘要`}>
            <div><dt>待支付</dt><dd><Money value={formatMoney(currency, summary.payable.toString())} tone="negative" /></dd></div>
            <div><dt>待收款</dt><dd><Money value={formatMoney(currency, summary.receivable.toString())} tone="positive" /></dd></div>
          </dl>
        ))}
        {!items.length ? <EmptyState icon={<Plus size={28} />} title="还没有活动" description="创建第一个活动后，就可以开始记录消费。" action={<div className="empty-state__actions"><Button onClick={openCreate}>创建活动</Button><Button variant="secondary" onClick={() => setActionView("join")}>加入已有活动</Button></div>} /> : null}
        <ActivityGroup title="进行中的活动" activities={active} allActivities={items} ledgers={ledgers} />
        <ActivityGroup title="最近结束" activities={ended} allActivities={items} ledgers={ledgers} />
        {archived.length ? <details className="activity-history"><summary>查看历史活动</summary><ActivityGroup title="已归档" activities={archived} allActivities={items} ledgers={ledgers} /></details> : null}
        <button className="settings-link deleted-activities-entry" type="button" aria-label="已删除活动" onClick={() => setDeletedOpen(true)}>
          <RotateCcw aria-hidden="true" size={18} />
          <span><strong>已删除活动</strong><small>查看恢复期限内可恢复的活动</small></span>
          <ChevronRight aria-hidden="true" size={18} />
        </button>
      </main>
      <ProductBottomNavigation />
      <Overlay open={actionView !== null} title={actionView === "create" ? "创建活动" : actionView === "join" ? "加入活动" : "新建或加入活动"} onBack={actionView && actionView !== "actions" ? () => setActionView("actions") : undefined} backLabel="新建或加入活动" onClose={() => setActionView(null)}>
        {actionView === "actions" ? <div className="overlay-action-list">
          <button type="button" className="settings-row" onClick={openCreate}><Plus aria-hidden="true" size={20} /><span><strong>创建活动</strong><small>为旅行或聚会建立新的账本</small></span><ChevronRight aria-hidden="true" size={18} /></button>
          <button type="button" className="settings-row" onClick={() => setActionView("join")}><LinkIcon aria-hidden="true" size={20} /><span><strong>加入活动</strong><small>粘贴活动所有者发送的邀请口令</small></span><ChevronRight aria-hidden="true" size={18} /></button>
        </div> : null}
        {actionView === "create" ? <form className="form-stack" onSubmit={submit}>
          <Field label="活动名称"><Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></Field>
          <Field label="地点（可选）"><Input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} /></Field>
          <Field label="主币种"><Select value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value)}><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option><option value="EUR">EUR 欧元</option><option value="JPY">JPY 日元</option></Select></Field>
          <Field label="开始日期"><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></Field>
          <Field label="结束日期（可选）"><Input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></Field>
          {createError ?? create.error ? <ErrorNotice error={createError ?? create.error} /> : null}
          <Button type="submit" busy={create.isPending}>创建活动</Button>
        </form> : null}
        {actionView === "join" ? <form className="form-stack" onSubmit={(event) => { event.preventDefault(); const token = joinToken.trim(); if (token) navigate(`/join/${encodeURIComponent(token)}`); }}>
          <Field label="邀请口令" hint="向活动所有者索取邀请口令后粘贴到这里。"><Input value={joinToken} onChange={(event) => setJoinToken(event.target.value)} autoComplete="off" autoFocus required /></Field>
          <Button type="submit">查看邀请 <ArrowRight aria-hidden="true" size={18} /></Button>
        </form> : null}
      </Overlay>
      <Overlay open={deletedOpen} title="已删除活动" onClose={() => setDeletedOpen(false)}>
        {deletedActivities.isPending ? <LoadingState label="正在读取已删除活动…" /> : null}
        {deletedActivities.error ? <ErrorNotice error={deletedActivities.error} /> : null}
        {!deletedActivities.isPending && !deletedActivities.error
          ? <DeletedActivities activities={deletedActivities.data ?? []} userId={session.data?.userId ?? ""} />
          : null}
      </Overlay>
    </div>
  );
}

function MembersOverlay({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<"list" | "invite">("list");
  return (
    <Overlay
      open
      title={view === "list" ? "成员" : "邀请成员"}
      backLabel="返回成员"
      onBack={view === "invite" ? () => setView("list") : undefined}
      onClose={onClose}
    >
      <MembersPage key={view} view={view} onInvite={() => setView("invite")} />
    </Overlay>
  );
}

export function MemberInvitationPanel({
  onCreate,
}: {
  onCreate: (intent: InvitationIntent) => Promise<CreatedInvitation>;
}) {
  const [mode, setMode] = useState<"link" | "direct">("link");
  const [targetUsername, setTargetUsername] = useState("");
  const [createdToken, setCreatedToken] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [submitting, setSubmitting] = useState(false);

  const selectMode = (nextMode: "link" | "direct") => {
    setMode(nextMode);
    setCreatedToken(undefined);
    setError(undefined);
  };

  const create = async (intent: InvitationIntent) => {
    setSubmitting(true);
    setCreatedToken(undefined);
    setError(undefined);
    try {
      const invitation = await onCreate(intent);
      setCreatedToken(invitation.token);
    } catch (reason) {
      setError(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="member-invite-panel">
      <div className="segmented" role="group" aria-label="邀请方式">
        <button type="button" aria-pressed={mode === "link"} disabled={submitting} onClick={() => selectMode("link")}>链接邀请</button>
        <button type="button" aria-pressed={mode === "direct"} disabled={submitting} onClick={() => selectMode("direct")}>定向邀请</button>
      </div>

      {mode === "link" ? (
        <section className="invite-mode-panel" aria-label="链接邀请">
          <p>生成可分享的邀请口令，对方登录或注册后即可加入活动。</p>
          <Button busy={submitting} onClick={() => void create({ mode: "link" })}><LinkIcon aria-hidden="true" size={18} />生成链接邀请</Button>
        </section>
      ) : (
        <form className="invite-mode-panel" onSubmit={(event) => { event.preventDefault(); void create({ mode: "direct", targetUsername }); }}>
          <Field label="目标用户名" hint="只有该用户名可使用此口令；对方可以登录或注册。">
            <Input
              value={targetUsername}
              onChange={(event) => setTargetUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              minLength={3}
              maxLength={32}
              required
              autoFocus
            />
          </Field>
          <Button type="submit" busy={submitting}><UserPlus aria-hidden="true" size={18} />创建定向邀请</Button>
        </form>
      )}

      {createdToken ? <div className="issued-invite" role="status" aria-live="polite"><strong>邀请口令已创建</strong><code>{createdToken}</code><small>口令只在本次创建后显示，请及时发送给对方。</small></div> : null}
      {error ? <ErrorNotice error={error} /> : null}
    </div>
  );
}

function MemberInvitationView({ userId, activityId }: { userId: string; activityId: string }) {
  const createInvitation = useCreateInvitationMutation(userId, activityId);
  return <MemberInvitationPanel onCreate={createInvitation.mutateAsync} />;
}

function activeInvitations(invitations: readonly Invitation[], now: number): Invitation[] {
  return invitations.filter((invitation) =>
    !invitation.revokedAt &&
    Date.parse(invitation.expiresAt) > now &&
    (invitation.maxUses == null || invitation.useCount < invitation.maxUses),
  );
}

export function MembersPage({ view = "list", onInvite }: { view?: "list" | "invite"; onInvite?: () => void }) {
  const { session, activity, members: cachedMembers, offline } = useWorkspace();
  const members = useMembersQuery(session.userId, activity.activityId, !offline);
  const memberData = members.data ?? cachedMembers;
  const isOwner = activity.currentMemberRole === "OWNER";
  const canManage = activity.status === "ACTIVE" && isOwner && !offline;
  const invitations = useInvitationsQuery(session.userId, activity.activityId, canManage);
  const joinRequests = useJoinRequestsQuery(session.userId, activity.activityId, isOwner && !offline);
  const decideJoinRequest = useDecideJoinRequestMutation(session.userId, activity.activityId);
  const createGuest = useCreateGuestMutation(session.userId, activity.activityId);
  const createGuestBinding = useCreateGuestBindingInvitationMutation(
    session.userId,
    activity.activityId,
  );
  const revokeInvitation = useRevokeInvitationMutation(session.userId, activity.activityId);
  const [guestName, setGuestName] = useState("");
  const [bindingMemberId, setBindingMemberId] = useState<string>();
  const [bindingUsername, setBindingUsername] = useState("");
  const [bindingToken, setBindingToken] = useState<string>();
  const [bindingError, setBindingError] = useState<unknown>();
  const [decisionError, setDecisionError] = useState<unknown>();

  async function createBindingInvitation(memberId: string) {
    setBindingError(undefined);
    setBindingToken(undefined);
    try {
      const invitation = await createGuestBinding.mutateAsync({
        memberId,
        targetUsername: bindingUsername,
      });
      setBindingToken(invitation.token);
    } catch (reason) {
      setBindingError(reason);
    }
  }

  async function decide(requestId: string, decision: "APPROVE" | "REJECT") {
    setDecisionError(undefined);
    try {
      await decideJoinRequest.mutateAsync({ requestId, decision });
    } catch (reason) {
      setDecisionError(reason);
    }
  }

  if (members.isPending && !memberData) return <LoadingState label="正在读取成员…" />;
  if (members.error && !memberData) return <ErrorNotice error={members.error} />;
  if (view === "invite" && canManage) {
    return <MemberInvitationView userId={session.userId} activityId={activity.activityId} />;
  }
  const visibleInvitations = canManage
    ? activeInvitations(invitations.data ?? [], Date.now())
    : [];
  return (
    <div className="member-center">
      {offline ? <div className="notice" role="status">当前离线，成员列表使用最近一次同步的缓存；邀请、绑定和审批需要联网。</div> : null}
      {canManage ? <div className="member-actions">
        <Button onClick={onInvite}><UserPlus aria-hidden="true" size={18} /> 邀请成员</Button>
        <form onSubmit={(event) => { event.preventDefault(); void createGuest.mutateAsync(guestName).then(() => setGuestName("")); }}><Input aria-label="临时成员名称" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="临时成员名称" required /><Button variant="secondary" type="submit" busy={createGuest.isPending}>添加</Button></form>
      </div> : null}
      {createGuest.error ? <ErrorNotice error={createGuest.error} /> : null}
      {isOwner && joinRequests.isPending ? <LoadingState label="正在读取待审批申请…" /> : null}
      {isOwner && joinRequests.error ? <ErrorNotice error={joinRequests.error} /> : null}
      {isOwner && joinRequests.data?.length ? (
        <section className="member-section" aria-labelledby="join-requests-heading">
          <h2 id="join-requests-heading">待审批 · {joinRequests.data.length}人</h2>
          <div className="join-request-list">
            {joinRequests.data.map((request) => (
              <div className="join-request-row" key={request.requestId}>
                <span>
                  <strong>{request.applicantDisplayName}</strong>
                  <small>申请加入活动</small>
                </span>
                <div className="join-request-actions">
                  <Button
                    variant="secondary"
                    busy={decideJoinRequest.isPending}
                    aria-label={`拒绝${request.applicantDisplayName}`}
                    onClick={() => void decide(request.requestId, "REJECT")}
                  >拒绝</Button>
                  <Button
                    busy={decideJoinRequest.isPending}
                    disabled={activity.status !== "ACTIVE"}
                    aria-label={`批准${request.applicantDisplayName}`}
                    onClick={() => void decide(request.requestId, "APPROVE")}
                  >批准</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {decisionError ? <ErrorNotice error={decisionError} /> : null}
      <section className="member-section">
        <h2>活动成员 · {memberData?.length ?? 0}人</h2>
        <div className="member-list">
          {memberData?.map((member) => {
            const canBind = canManage && member.status === "ACTIVE" && member.userId == null;
            const editorOpen = bindingMemberId === member.memberId;
            return (
              <div className="member-entry" key={member.memberId}>
                <div className="member-row">
                  <MemberAvatar memberId={member.memberId} displayName={member.displayName} />
                  <span>
                    <strong>{member.displayName}{member.memberId === activity.currentMemberId ? "（我）" : ""}</strong>
                    <small>{member.userId ? "正式成员" : "临时成员"}</small>
                  </span>
                  <div className="member-row__actions">
                    <span className="tag">{member.role === "OWNER" ? "所有者" : member.role === "ADMIN" ? "管理员" : "成员"}</span>
                    {canBind ? (
                      <Button
                        variant="ghost"
                        aria-expanded={editorOpen}
                        onClick={() => {
                          setBindingMemberId(editorOpen ? undefined : member.memberId);
                          setBindingUsername("");
                          setBindingToken(undefined);
                          setBindingError(undefined);
                        }}
                      >
                        <UserRoundCheck aria-hidden="true" size={17} />绑定账号
                      </Button>
                    ) : null}
                  </div>
                </div>
                {editorOpen ? (
                  <form
                    className="guest-binding-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createBindingInvitation(member.memberId);
                    }}
                  >
                    <Field label="目标用户名" hint="该用户确认后，将继承此临时成员的账务身份。">
                      <Input
                        value={bindingUsername}
                        onChange={(event) => setBindingUsername(event.target.value)}
                        autoComplete="username"
                        autoCapitalize="none"
                        minLength={3}
                        maxLength={32}
                        required
                        autoFocus
                      />
                    </Field>
                    <Button type="submit" busy={createGuestBinding.isPending}>创建绑定邀请</Button>
                    {bindingToken ? <div className="issued-invite" role="status" aria-live="polite"><strong>绑定口令已创建</strong><code>{bindingToken}</code><small>口令只在本次创建后显示，请及时发送给对方。</small></div> : null}
                    {bindingError ? <ErrorNotice error={bindingError} /> : null}
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
      {visibleInvitations.length ? <section className="member-section"><h2>有效邀请</h2><div className="compact-list">{visibleInvitations.map((invite) => {
        const guestName = memberData?.find((member) => member.memberId === invite.guestMemberId)?.displayName ?? "临时成员";
        const label = invite.purpose === "GUEST_BINDING"
          ? `绑定「${guestName}」给 @${invite.targetUsername ?? "目标用户"}`
          : invite.kind === "DIRECT" ? invite.targetUsername ?? "定向邀请" : "链接加入";
        return <div key={invite.invitationId}><span><strong>{label}</strong><small>已使用 {invite.useCount}{invite.maxUses ? ` / ${invite.maxUses}` : ""}</small></span><Button variant="ghost" busy={revokeInvitation.isPending} onClick={() => revokeInvitation.mutate(invite.invitationId)}>撤销</Button></div>;
      })}</div></section> : null}
    </div>
  );
}

const lifecycleLabels: Record<string, string> = {
  END: "结束活动",
  REOPEN: "重新开启活动",
  ARCHIVE: "归档活动",
  UNARCHIVE: "取消归档",
};

type ActivityField = keyof Activity["fieldPermissions"];

const activityFieldLabels: Record<ActivityField, string> = {
  name: "活动名称",
  location: "地点",
  baseCurrency: "主币种",
  startDate: "开始日期",
  endDate: "结束日期",
  inviteMode: "加入方式",
};

/** 单字段编辑器确保一次保存只提交当前字段与 version，避免无意覆盖其他并发修改。 */
function ActivityFieldEditor({ field, onSaved }: { field: ActivityField; onSaved: (warnings: string[]) => void }) {
  const { session, activity } = useWorkspace();
  const update = useUpdateActivityMutation(session.userId, activity.activityId);
  const initialValue = field === "location"
    ? activity.location ?? ""
    : field === "endDate"
      ? activity.endDate ?? ""
      : String(activity[field]);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<unknown>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const input: UpdateActivityInput = { version: activity.version };
    if (field === "name") input.name = value;
    if (field === "location") input.location = value.trim() || null;
    if (field === "baseCurrency") input.baseCurrency = value;
    if (field === "startDate") input.startDate = value;
    if (field === "endDate") input.endDate = value || null;
    if (field === "inviteMode") input.inviteMode = value as "DIRECT_JOIN" | "REQUIRE_APPROVAL";
    try {
      const result = await update.mutateAsync(input);
      onSaved(result.warnings);
    } catch (reason) {
      setError(reason);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      {field === "name" ? <Field label="活动名称"><Input value={value} onChange={(event) => setValue(event.target.value)} required autoFocus maxLength={120} /></Field> : null}
      {field === "location" ? <Field label="地点（可选）"><Input value={value} onChange={(event) => setValue(event.target.value)} autoFocus maxLength={120} /></Field> : null}
      {field === "baseCurrency" ? <Field label="主币种"><Select value={value} onChange={(event) => setValue(event.target.value)} autoFocus><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option><option value="EUR">EUR 欧元</option><option value="JPY">JPY 日元</option></Select></Field> : null}
      {field === "startDate" ? <Field label="开始日期"><Input type="date" value={value} onChange={(event) => setValue(event.target.value)} required autoFocus /></Field> : null}
      {field === "endDate" ? <Field label="结束日期（可选）"><Input type="date" min={activity.startDate} value={value} onChange={(event) => setValue(event.target.value)} autoFocus /></Field> : null}
      {field === "inviteMode" ? (
        <div className="segmented" role="group" aria-label="加入方式">
          <button type="button" aria-pressed={value === "DIRECT_JOIN"} onClick={() => setValue("DIRECT_JOIN")}>直接加入</button>
          <button type="button" aria-pressed={value === "REQUIRE_APPROVAL"} onClick={() => setValue("REQUIRE_APPROVAL")}>需要审批</button>
        </div>
      ) : null}
      {error ?? update.error ? <ErrorNotice error={error ?? update.error} /> : null}
      <Button type="submit" busy={update.isPending}>保存</Button>
    </form>
  );
}

/** 资料行直接体现服务端权限：可编辑行是完整按钮，只读行不暴露虚假的交互语义。 */
function ActivityInfoRow({ icon, label, value, helper, editable, onEdit }: { icon: ReactNode; label: string; value: string; helper?: string; editable: boolean; onEdit?: () => void }) {
  const content = <>{icon}<span>{label}</span><span className="settings-row__value"><strong>{value}</strong>{helper ? <small>{helper}</small> : null}</span>{editable ? <ChevronRight aria-hidden="true" size={18} /> : null}</>;
  return editable
    ? <button className="settings-row" type="button" aria-label={`编辑${label}`} onClick={onEdit}>{content}</button>
    : <div className="settings-row">{content}</div>;
}

export function MorePage({ onEdit, onDelete, onTransfer }: { onEdit?: (field: ActivityField) => void; onDelete?: () => void; onTransfer?: () => void }) {
  const { session, activity, offline } = useWorkspace();
  const lifecycle = useActivityLifecycleMutation(session.userId, activity.activityId);
  const [error, setError] = useState<unknown>();
  const canOpenEditor = Boolean(onEdit);

  async function transition(action: string) {
    setError(undefined);
    try {
      await lifecycle.mutateAsync({ action, version: activity.version });
    } catch (reason) {
      setError(reason);
    }
  }

  return (
    <div className="activity-more">
      {offline ? <div className="notice" role="status">当前离线，活动管理需要联网后使用。</div> : null}
      <section>
        <h2>活动资料</h2>
        <div className="settings-list">
          <ActivityInfoRow icon={<Pencil aria-hidden="true" size={17} />} label="活动名称" value={activity.name} editable={!offline && canOpenEditor && activity.fieldPermissions.name} onEdit={() => onEdit?.("name")} />
          <ActivityInfoRow icon={<MapPin aria-hidden="true" size={17} />} label="地点" value={activity.location || "未填写"} editable={!offline && canOpenEditor && activity.fieldPermissions.location} onEdit={() => onEdit?.("location")} />
          <ActivityInfoRow icon={<CircleDollarSign aria-hidden="true" size={17} />} label="主币种" value={activity.baseCurrency} helper={activity.hasAccountingRecords ? "已有账务记录，不可修改" : undefined} editable={!offline && canOpenEditor && activity.fieldPermissions.baseCurrency} onEdit={() => onEdit?.("baseCurrency")} />
          <ActivityInfoRow icon={<CalendarDays aria-hidden="true" size={17} />} label="开始日期" value={activity.startDate} editable={!offline && canOpenEditor && activity.fieldPermissions.startDate} onEdit={() => onEdit?.("startDate")} />
          <ActivityInfoRow icon={<CalendarDays aria-hidden="true" size={17} />} label="结束日期" value={activity.endDate || "未填写"} editable={!offline && canOpenEditor && activity.fieldPermissions.endDate} onEdit={() => onEdit?.("endDate")} />
          <ActivityInfoRow icon={<UsersRound aria-hidden="true" size={17} />} label="状态" value={activityStatus(activity.status)} editable={false} />
        </div>
      </section>
      <section>
        <h2>加入设置</h2>
        <div className="settings-list">
          <ActivityInfoRow icon={<UserPlus aria-hidden="true" size={17} />} label="加入方式" value={activity.inviteMode === "DIRECT_JOIN" ? "直接加入" : "需要审批"} editable={!offline && canOpenEditor && activity.fieldPermissions.inviteMode} onEdit={() => onEdit?.("inviteMode")} />
        </div>
      </section>
      <section>
        <h2>数据导出</h2>
        <a className="button button--secondary" href={`/api/activities/${encodeURIComponent(activity.activityId)}/export.csv`}><Download aria-hidden="true" size={17} />导出 CSV</a>
      </section>
      {!offline && activity.currentMemberRole === "OWNER" && onTransfer ? <section><h2>成员与权限</h2><div className="settings-list"><ActivityInfoRow icon={<UserRoundCheck aria-hidden="true" size={17} />} label="转让所有权" value="选择新所有者" editable onEdit={onTransfer} /></div></section> : null}
      {!offline && activity.allowedLifecycleActions.length ? <section><h2>活动状态</h2><div className="management-actions">{activity.allowedLifecycleActions.flatMap((action) => lifecycleLabels[action] ? [<Button key={action} variant="secondary" busy={lifecycle.isPending} onClick={() => void transition(action)}>{lifecycleLabels[action]}</Button>] : [])}</div></section> : null}
      {error ?? lifecycle.error ? <ErrorNotice error={error ?? lifecycle.error} /> : null}
      {!offline && activity.canDelete && onDelete ? <section className="management-danger"><h2>危险操作</h2><Button variant="danger" onClick={onDelete}><Trash2 aria-hidden="true" size={17} />删除活动</Button></section> : null}
    </div>
  );
}

function OwnershipTransferEditor({ onTransferred }: { onTransferred: () => void }) {
  const { session, activity } = useWorkspace();
  const members = useMembersQuery(session.userId, activity.activityId);
  const transfer = useTransferOwnershipMutation(session.userId, activity.activityId);
  const [memberId, setMemberId] = useState("");
  const [error, setError] = useState<unknown>();
  const candidates = members.data?.filter(
    (member) =>
      member.status === "ACTIVE" &&
      member.userId !== null &&
      member.memberId !== activity.ownerMemberId,
  ) ?? [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      await transfer.mutateAsync({ newOwnerMemberId: memberId, version: activity.version });
      onTransferred();
    } catch (reason) {
      setError(reason);
    }
  }

  if (members.isPending) return <LoadingState label="正在读取可转让成员…" />;
  if (members.error) return <ErrorNotice error={members.error} />;
  return (
    <form className="form-stack" onSubmit={submit}>
      <p className="form-hint">转让后，新成员将成为活动所有者，你会变为普通成员。</p>
      <Field label="新所有者">
        <Select value={memberId} onChange={(event) => setMemberId(event.target.value)} required autoFocus>
          <option value="">请选择成员</option>
          {candidates.map((member) => <option key={member.memberId} value={member.memberId}>{member.displayName}</option>)}
        </Select>
      </Field>
      {!candidates.length ? <p className="empty-copy">暂无可转让的已绑定账号成员。</p> : null}
      {error ?? transfer.error ? <ErrorNotice error={error ?? transfer.error} /> : null}
      <Button type="submit" busy={transfer.isPending} disabled={!memberId}>确认转让</Button>
    </form>
  );
}

/** 管理流程始终留在同一 Overlay 内，子视图负责返回，删除成功才退出活动工作区。 */
function ActivityManagementOverlay({ onClose }: { onClose: () => void }) {
  const { session, activity } = useWorkspace();
  const remove = useDeleteActivityMutation(session.userId, activity.activityId);
  const navigate = useNavigate();
  const [view, setView] = useState<"root" | "delete" | "ownership" | ActivityField>("root");
  const [deleteError, setDeleteError] = useState<unknown>();
  const [warnings, setWarnings] = useState<string[]>([]);

  async function confirmDelete() {
    setDeleteError(undefined);
    try {
      await remove.mutateAsync(activity.version);
      navigate("/activities", { replace: true });
    } catch (reason) {
      setDeleteError(reason);
    }
  }

  const title = view === "root" ? "活动管理" : view === "delete" ? "确认删除活动" : view === "ownership" ? "转让所有权" : activityFieldLabels[view];
  return (
    <Overlay open title={title} backLabel="返回活动管理" onBack={view === "root" ? undefined : () => setView("root")} onClose={onClose} focusKey={view}>
      {view === "root" ? warnings.map((warning) => (
        <div className="notice" key={warning} role="status">
          {warning === "EXPENSE_BEFORE_ACTIVITY_START"
            ? "活动开始日期晚于已有账单的发生时间，请检查日期或历史账单。"
            : warning}
        </div>
      )) : null}
      {view === "root" ? <MorePage onEdit={setView} onDelete={() => setView("delete")} onTransfer={() => setView("ownership")} /> : null}
      {view !== "root" && view !== "delete" && view !== "ownership" ? <ActivityFieldEditor field={view} onSaved={(nextWarnings) => { setWarnings(nextWarnings); setView("root"); }} /> : null}
      {view === "ownership" ? <OwnershipTransferEditor onTransferred={onClose} /> : null}
      {view === "delete" ? <div className="delete-confirmation"><p>删除后活动会离开当前列表，并在服务端给出的恢复期限内允许恢复。</p>{deleteError ?? remove.error ? <ErrorNotice error={deleteError ?? remove.error} /> : null}<Button data-overlay-initial-focus variant="danger" busy={remove.isPending} onClick={() => void confirmDelete()}><Trash2 aria-hidden="true" size={17} />确认删除活动</Button></div> : null}
    </Overlay>
  );
}

export function MePage() {
  const session = useSessionQuery();
  const logout = useLogoutMutation();
  const navigate = useNavigate();
  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="home-header"><h1>我的</h1></header>
        <section className="profile-panel">
          <span className="profile-avatar"><UserRound aria-hidden="true" size={30} /></span>
          <div><strong>{session.data?.displayName}</strong><small>@{session.data?.username}</small></div>
        </section>
        <section className="account-settings" aria-labelledby="account-security-heading">
          <h2 id="account-security-heading">账户与安全</h2>
          <div className="settings-list">
            <Link className="settings-link" to="/me/password" aria-label="修改密码">
              <KeyRound aria-hidden="true" size={18} />
              <span><strong>修改密码</strong><small>更新当前登录凭证</small></span>
              <ChevronRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </section>
        {session.data?.isSystemAdmin ? <section className="account-settings" aria-labelledby="system-management-heading">
          <h2 id="system-management-heading">管理</h2>
          <div className="settings-list">
            <Link className="settings-link" to="/admin" aria-label="系统管理">
              <ShieldCheck aria-hidden="true" size={18} />
              <span><strong>系统管理</strong><small>用户与注册策略</small></span>
              <ChevronRight aria-hidden="true" size={18} />
            </Link>
          </div>
        </section> : null}
        <Button variant="secondary" busy={logout.isPending} onClick={() => void logout.mutateAsync().then(() => navigate("/login", { replace: true }))}>退出登录</Button>
      </main>
      <ProductBottomNavigation />
    </div>
  );
}
