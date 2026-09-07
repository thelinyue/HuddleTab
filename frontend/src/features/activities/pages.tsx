import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleStop,
  Download,
  CalendarDays,
  Check,
  KeyRound,
  Link as LinkIcon,
  LogOut,
  LoaderCircle,
  MapPin,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Sun,
  SunMoon,
  Trash2,
  UserPlus,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ApiRequestError } from "../../api/error";
import { formatMoney } from "../../domain-preview/money";
import { Button, ConfirmDialog, EmptyState, ErrorNotice, Field, Input, LoadingState, Money, Select } from "../../components/ui";
import { AVATAR_PRESETS, DEFAULT_AVATAR_PRESET, MemberAvatar, type AvatarPreset } from "../../components/member-avatar";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { Overlay } from "../../components/overlay";
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
  useRemoveGuestMutation,
  useRevokeInvitationMutation,
  useRestoreActivityMutation,
  useTransferOwnershipMutation,
  useUpdateActivityMutation,
} from "./api";
import { type Session, useLogoutMutation, useSessionQuery, useUpdateAvatarPresetMutation, useUpdateDisplayNameMutation } from "../auth/api";
import { useActivitySnapshotQuery, useOnlineStatus } from "./offline-workspace";
import { inclusiveCalendarDays } from "../../lib/calendar-date";
import { useThemePreference, type ThemePreference } from "../../components/theme-provider";

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

function tabUrl(activityId: string, tab: "feed" | "settlement", panel?: "members" | "manage") {
  const query = new URLSearchParams();
  if (tab === "settlement") query.set("tab", "settlement");
  if (panel) query.set("panel", panel);
  const suffix = query.toString();
  return `/activities/${encodeURIComponent(activityId)}${suffix ? `?${suffix}` : ""}`;
}

/** 服务端明确拒绝活动访问时，旧 Snapshot 不能覆盖当前事实。 */
function isDefinitiveActivityError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status >= 400 && error.status < 500;
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
  const definitiveError = [activity.error, snapshot.error].find(isDefinitiveActivityError);
  if (session.error || definitiveError || (activity.error && !snapshot.data) || snapshot.error && !online) return <ErrorNotice error={session.error ?? definitiveError ?? activity.error ?? snapshot.error} />;
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
    <section className="activity-group deleted-activities" aria-label="可恢复的活动">
      {visible.length ? <ul className="deleted-activity-list">{visible.map((activity) => <DeletedActivityRow key={activity.activityId} activity={activity} userId={userId} />)}</ul> : <p className="muted-copy">当前没有可恢复的活动。</p>}
    </section>
  );
}

export function ActivitiesPage() {
  const session = useSessionQuery();
  const activities = useActivitiesQuery(session.data?.userId ?? "");
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

  if (session.isPending || activities.isPending) return <LoadingState label="正在读取活动…" />;
  if (session.error || activities.error) return <ErrorNotice error={session.error ?? activities.error} />;
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
  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="home-header">
          <div className="home-header__title">
            <h1>活动</h1>
            <button className="icon-button" type="button" aria-label="已删除活动" title="已删除活动" onClick={() => openPanel("deleted")}>
              <Trash2 aria-hidden="true" size={18} />
            </button>
          </div>
          <button className="home-add" type="button" aria-label="新建或加入活动" title="新建或加入活动" onClick={() => openPanel("actions")}><Plus aria-hidden="true" size={18} /></button>
        </header>
        {summaries.map(([currency, summary]) => (
          <dl className="home-summary" key={currency} aria-label={`${currency} 跨活动账务摘要`}>
            <div><dt>待支付</dt><dd><Money value={formatMoney(currency, summary.payable.toString())} tone="negative" /></dd></div>
            <div><dt>待收款</dt><dd><Money value={formatMoney(currency, summary.receivable.toString())} tone="positive" /></dd></div>
          </dl>
        ))}
        {!items.length ? <EmptyState
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

function MembersOverlay({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<"list" | "invite">("list");
  return (
    <Overlay
      open
      title={view === "list" ? "成员" : "邀请成员"}
      onBack={view === "invite" ? { label: "返回成员", onClick: () => setView("list") } : undefined}
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
  const removeGuest = useRemoveGuestMutation(session.userId, activity.activityId);
  const revokeInvitation = useRevokeInvitationMutation(session.userId, activity.activityId);
  const [guestName, setGuestName] = useState("");
  const [bindingMemberId, setBindingMemberId] = useState<string>();
  const [bindingUsername, setBindingUsername] = useState("");
  const [bindingToken, setBindingToken] = useState<string>();
  const [bindingError, setBindingError] = useState<unknown>();
  const [decisionError, setDecisionError] = useState<unknown>();
  const [removalMemberId, setRemovalMemberId] = useState<string>();
  const [removalError, setRemovalError] = useState<unknown>();
  const [removalSubmitting, setRemovalSubmitting] = useState(false);

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

  const removalMember = memberData?.find((member) => member.memberId === removalMemberId);

  async function confirmGuestRemoval() {
    if (!removalMember || removeGuest.isPending || removalSubmitting) return;
    setRemovalError(undefined);
    setRemovalSubmitting(true);
    try {
      await removeGuest.mutateAsync(removalMember.memberId);
      setRemovalMemberId(undefined);
    } catch (reason) {
      setRemovalError(reason);
    } finally {
      setRemovalSubmitting(false);
    }
  }

  function openGuestRemoval(memberId: string) {
    setRemovalError(undefined);
    setRemovalMemberId(memberId);
  }

  function cancelGuestRemoval() {
    if (removeGuest.isPending || removalSubmitting) return;
    setRemovalError(undefined);
    setRemovalMemberId(undefined);
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
        {(() => {
          const activeMemberCount = memberData?.filter((member) => member.status === "ACTIVE").length ?? 0;
          const removedMemberCount = memberData?.filter((member) => member.status === "LEFT").length ?? 0;
          return <h2>活动成员 · {activeMemberCount}人{removedMemberCount ? ` · 已移除 ${removedMemberCount}人` : ""}</h2>;
        })()}
        <div className="member-list">
          {memberData?.map((member) => {
            const canBind = canManage && member.status === "ACTIVE" && member.userId == null;
            const canRemove = canManage
              && member.status === "ACTIVE"
              && member.role === "MEMBER"
              && member.userId == null;
            const editorOpen = bindingMemberId === member.memberId;
            const removed = member.status === "LEFT";
            return (
              <div className="member-entry" key={member.memberId}>
                <div className="member-row">
                  <MemberAvatar memberId={member.memberId} displayName={member.displayName} avatarPreset={member.avatarPreset} />
                  <span>
                    <strong>{member.displayName}{member.memberId === activity.currentMemberId ? "（我）" : ""}</strong>
                    <small>{member.userId ? "正式成员" : removed ? "临时成员 · 已移除" : "临时成员"}</small>
                  </span>
                  <div className="member-row__actions">
                    <span className="tag">{member.role === "OWNER" ? "所有者" : member.role === "ADMIN" ? "管理员" : "成员"}</span>
                    {removed ? <span className="tag tag--muted">已移除</span> : null}
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
                    {canRemove ? (
                      <button
                        className="icon-button member-row__remove"
                        type="button"
                        aria-label={`删除临时成员 ${member.displayName}`}
                        title={`删除临时成员 ${member.displayName}`}
                        onClick={() => openGuestRemoval(member.memberId)}
                        disabled={removeGuest.isPending || removalSubmitting}
                      >
                        <Trash2 aria-hidden="true" size={18} />
                      </button>
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
      <ConfirmDialog
        open={Boolean(removalMember)}
        title={removalMember ? `确认删除临时成员「${removalMember.displayName}」` : "确认删除临时成员"}
        message="成员将不能再参与新账单或结算，已有账务会保留；无历史记录时会彻底删除。"
        error={removalError ? <ErrorNotice error={removalError} /> : undefined}
        confirmLabel="删除成员"
        busy={removeGuest.isPending || removalSubmitting}
        onConfirm={() => void confirmGuestRemoval()}
        onCancel={cancelGuestRemoval}
      />
    </div>
  );
}

const lifecycleLabels: Record<string, string> = {
  END: "结束活动",
  REOPEN: "重新开启活动",
  ARCHIVE: "归档活动",
  UNARCHIVE: "取消归档",
};

const lifecycleDescriptions: Record<string, string> = {
  END: "结束后将停止新增账单、成员和邀请，可重新开启。",
  REOPEN: "重新开启后，活动成员可以继续记录账单。",
  ARCHIVE: "归档后活动完全只读，可在历史活动中查看。",
  UNARCHIVE: "取消归档后恢复活动的可用状态。",
};

const currencyOptions = [
  ["CNY", "人民币"],
  ["USD", "美元"],
  ["EUR", "欧元"],
  ["JPY", "日元"],
] as const;

const inviteModeLabels: Record<string, string> = {
  DIRECT_JOIN: "直接加入",
  REQUIRE_APPROVAL: "需要审批",
};

type ActivityField = keyof Activity["fieldPermissions"];

/**
 * 活动管理使用单层 Sheet：资料直接编辑，复杂操作在原位置展开。
 * 每次资料更新只提交一个字段和 version，避免覆盖其他成员的并发修改。
 */
export function MorePage({ onClose, closeAfterSave = false, onStateChange }: {
  onClose: () => void;
  closeAfterSave?: boolean;
  onStateChange?: (state: { busy: boolean; hasError: boolean }) => void;
}) {
  const { session, activity, offline } = useWorkspace();
  const update = useUpdateActivityMutation(session.userId, activity.activityId);
  const lifecycle = useActivityLifecycleMutation(session.userId, activity.activityId);
  const remove = useDeleteActivityMutation(session.userId, activity.activityId);
  const transfer = useTransferOwnershipMutation(session.userId, activity.activityId);
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => ({
    name: activity.name,
    location: activity.location ?? "",
    baseCurrency: activity.baseCurrency,
    startDate: activity.startDate,
    endDate: activity.endDate ?? "",
    inviteMode: activity.inviteMode,
  }));
  const [version, setVersion] = useState(activity.version);
  const [savingField, setSavingField] = useState<ActivityField | null>(null);
  const [lastSavedField, setLastSavedField] = useState<ActivityField | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ActivityField, unknown>>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [ownershipOpen, setOwnershipOpen] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [transferError, setTransferError] = useState<unknown>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>();
  const members = useMembersQuery(session.userId, activity.activityId, ownershipOpen);

  const canEdit = (field: ActivityField) =>
    !offline
    && activity.fieldPermissions[field]
    && (field !== "baseCurrency" || !activity.hasAccountingRecords);
  const editingBusy = savingField !== null || update.isPending;
  const actionBusy = editingBusy || lifecycle.isPending || transfer.isPending || remove.isPending;
  const hasError = Object.values(fieldErrors).some(Boolean)
    || Boolean(lifecycle.error || transferError || transfer.error || deleteError || remove.error);

  useEffect(() => {
    setVersion(activity.version);
  }, [activity.version]);

  useEffect(() => {
    onStateChange?.({ busy: actionBusy, hasError });
  }, [actionBusy, hasError, onStateChange]);

  function setDraftValue(field: ActivityField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setLastSavedField(null);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function normalizeFieldValue(field: ActivityField, value: string): string {
    return field === "location" ? value.trim() : value;
  }

  function currentFieldValue(field: ActivityField): string {
    if (field === "location") return activity.location ?? "";
    if (field === "endDate") return activity.endDate ?? "";
    return String(activity[field]);
  }

  async function saveField(field: ActivityField, rawValue: string) {
    const value = normalizeFieldValue(field, rawValue);
    setDraftValue(field, value);
    if (!canEdit(field) || editingBusy) return;
    if (value === currentFieldValue(field)) {
      if (field === "baseCurrency") setCurrencyOpen(false);
      return;
    }

    const input: UpdateActivityInput = { version };
    if (field === "name") input.name = value;
    if (field === "location") input.location = value || null;
    if (field === "baseCurrency") input.baseCurrency = value;
    if (field === "startDate") input.startDate = value;
    if (field === "endDate") input.endDate = value || null;
    if (field === "inviteMode") input.inviteMode = value;

    setSavingField(field);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    try {
      const result = await update.mutateAsync(input);
      setVersion(result.data.version);
      setWarnings(result.warnings);
      setLastSavedField(field);
      if (field === "baseCurrency") setCurrencyOpen(false);
    } catch (reason) {
      setFieldErrors((current) => ({ ...current, [field]: reason }));
    } finally {
      setSavingField(null);
    }
  }

  function fieldStatus(field: ActivityField): ReactNode {
    if (savingField === field) return <LoaderCircle aria-label="正在保存" className="spinner" size={16} />;
    if (lastSavedField === field) return <Check aria-label="已保存" size={16} />;
    return null;
  }

  function fieldError(field: ActivityField): ReactNode {
    return fieldErrors[field] ? <ErrorNotice error={fieldErrors[field]} /> : null;
  }

  async function transition(action: string) {
    if (actionBusy) return;
    try {
      await lifecycle.mutateAsync({ action, version });
    } catch {
      // mutation.error 由对应操作行下方的 ErrorNotice 展示，保留当前管理上下文。
    }
  }

  async function confirmTransfer() {
    if (!memberId || actionBusy) return;
    setTransferError(undefined);
    try {
      await transfer.mutateAsync({ newOwnerMemberId: memberId, version });
      onClose();
    } catch (reason) {
      setTransferError(reason);
    }
  }

  async function confirmDelete() {
    if (actionBusy) return;
    setDeleteError(undefined);
    try {
      await remove.mutateAsync(version);
      navigate("/activities", { replace: true });
    } catch (reason) {
      setDeleteError(reason);
    }
  }

  const currencyLabel = currencyOptions.find(([code]) => code === draft.baseCurrency)?.[1] ?? draft.baseCurrency;
  const candidates = members.data?.filter(
    (member) => member.status === "ACTIVE" && member.userId !== null && member.memberId !== activity.ownerMemberId,
  ) ?? [];

  return (
    <div className="activity-more" data-overlay-initial-focus tabIndex={-1}>
      {closeAfterSave && actionBusy ? <div className="notice" role="status">正在保存，保存完成后关闭活动管理。</div> : null}
      {offline ? <div className="notice" role="status">当前离线，活动管理需要联网后使用。</div> : null}
      {warnings.map((warning) => (
        <div className="notice" key={warning} role="status">
          {warning === "EXPENSE_BEFORE_ACTIVITY_START"
            ? "活动开始日期晚于已有账单的发生时间，请检查日期或历史账单。"
            : warning}
        </div>
      ))}
      <section>
        <h2>活动资料</h2>
        <div className="management-fields">
          <div className="management-field">
            <div className="management-field__heading"><Pencil aria-hidden="true" size={17} /><span><strong>活动名称</strong></span></div>
            {canEdit("name") ? <div className="management-field__control"><Input aria-label="活动名称" value={draft.name} disabled={editingBusy} required maxLength={120} onChange={(event) => setDraftValue("name", event.target.value)} onBlur={(event) => void saveField("name", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />{fieldStatus("name")}</div> : <span className="management-field__readonly">{activity.name}</span>}
            {fieldError("name")}
          </div>
          <div className="management-field">
            <div className="management-field__heading"><MapPin aria-hidden="true" size={17} /><span><strong>地点</strong><small>可选</small></span></div>
            {canEdit("location") ? <div className="management-field__control"><Input aria-label="地点" value={draft.location} disabled={editingBusy} maxLength={120} onChange={(event) => setDraftValue("location", event.target.value)} onBlur={(event) => void saveField("location", event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />{fieldStatus("location")}</div> : <span className="management-field__readonly">{activity.location || "未填写"}</span>}
            {fieldError("location")}
          </div>
          <div className="management-field">
            <div className="management-field__heading"><CircleDollarSign aria-hidden="true" size={17} /><span><strong>主币种</strong>{activity.hasAccountingRecords ? <small>已有账务记录，不可修改</small> : !activity.fieldPermissions.baseCurrency ? <small>当前账号无修改权限</small> : null}</span></div>
            {canEdit("baseCurrency") ? <div className="management-field__choice"><button className="management-choice-trigger" type="button" aria-expanded={currencyOpen} aria-controls="activity-currency-options" disabled={editingBusy} onClick={() => setCurrencyOpen((open) => !open)}><span>{draft.baseCurrency} {currencyLabel}</span><ChevronDown aria-hidden="true" size={18} /></button>{fieldStatus("baseCurrency")}</div> : <span className="management-field__readonly">{activity.baseCurrency}</span>}
            {currencyOpen && canEdit("baseCurrency") ? <div className="management-choice-list" id="activity-currency-options" role="radiogroup" aria-label="主币种选项">{currencyOptions.map(([code, label]) => <button key={code} type="button" role="radio" aria-checked={draft.baseCurrency === code} disabled={editingBusy} onClick={() => void saveField("baseCurrency", code)}><span><strong>{code}</strong><small>{label}</small></span>{draft.baseCurrency === code ? <Check aria-hidden="true" size={18} /> : null}</button>)}</div> : null}
            {fieldError("baseCurrency")}
          </div>
          <div className="management-field">
            <div className="management-field__heading"><CalendarDays aria-hidden="true" size={17} /><span><strong>开始日期</strong></span></div>
            {canEdit("startDate") ? <div className="management-field__control"><Input aria-label="开始日期" type="date" value={draft.startDate} disabled={editingBusy} required onChange={(event) => void saveField("startDate", event.target.value)} />{fieldStatus("startDate")}</div> : <span className="management-field__readonly">{activity.startDate}</span>}
            {fieldError("startDate")}
          </div>
          <div className="management-field">
            <div className="management-field__heading"><CalendarDays aria-hidden="true" size={17} /><span><strong>结束日期</strong><small>可选</small></span></div>
            {canEdit("endDate") ? <div className="management-field__control"><Input aria-label="结束日期" type="date" min={activity.startDate} value={draft.endDate} disabled={editingBusy} onChange={(event) => void saveField("endDate", event.target.value)} />{fieldStatus("endDate")}</div> : <span className="management-field__readonly">{activity.endDate || "未填写"}</span>}
            {fieldError("endDate")}
          </div>
          <div className="management-field management-field--readonly">
            <div className="management-field__heading"><UsersRound aria-hidden="true" size={17} /><span><strong>状态</strong></span></div>
            <span className="management-field__readonly">{activityStatus(activity.status)}</span>
          </div>
        </div>
      </section>
      <section>
        <h2>加入设置</h2>
        <div className="management-field">
          <div className="management-field__heading"><UserPlus aria-hidden="true" size={17} /><span><strong>加入方式</strong></span></div>
          {canEdit("inviteMode") ? <div className="management-field__segmented"><div className="segmented" role="group" aria-label="加入方式"><button type="button" aria-pressed={draft.inviteMode === "DIRECT_JOIN"} disabled={editingBusy} onClick={() => void saveField("inviteMode", "DIRECT_JOIN")}>直接加入</button><button type="button" aria-pressed={draft.inviteMode === "REQUIRE_APPROVAL"} disabled={editingBusy} onClick={() => void saveField("inviteMode", "REQUIRE_APPROVAL")}>需要审批</button></div>{fieldStatus("inviteMode")}</div> : <span className="management-field__readonly">{inviteModeLabels[activity.inviteMode] ?? activity.inviteMode}</span>}
          {fieldError("inviteMode")}
        </div>
      </section>
      <section>
        <h2>数据导出</h2>
        <a className="management-action-row" href={`/api/activities/${encodeURIComponent(activity.activityId)}/export.csv`} aria-label="导出 CSV" aria-describedby="activity-export-description"><Download aria-hidden="true" size={19} /><span><strong>导出 CSV</strong><small id="activity-export-description">下载活动账务明细</small></span><ChevronRight aria-hidden="true" size={18} /></a>
      </section>
      {!offline && activity.currentMemberRole === "OWNER" ? <section>
        <h2>成员与权限</h2>
        <button className="management-action-row" type="button" aria-expanded={ownershipOpen} aria-controls="activity-ownership-panel" disabled={actionBusy} onClick={() => { setOwnershipOpen((open) => !open); setTransferError(undefined); setMemberId(""); }}><UserRoundCheck aria-hidden="true" size={19} /><span><strong>转让所有权</strong><small>选择新的活动所有者</small></span><ChevronDown aria-hidden="true" className={ownershipOpen ? "management-chevron management-chevron--open" : "management-chevron"} size={18} /></button>
        {ownershipOpen ? <div className="management-expansion" id="activity-ownership-panel">
          <p className="form-hint">转让后，新成员将成为活动所有者，你会变为普通成员。</p>
          {members.isPending ? <LoadingState label="正在读取可转让成员…" /> : null}
          {members.error ? <ErrorNotice error={members.error} /> : null}
          {!members.isPending && !members.error && candidates.length ? <div className="management-member-list" role="radiogroup" aria-label="新所有者">{candidates.map((member) => <button key={member.memberId} type="button" role="radio" aria-checked={memberId === member.memberId} disabled={actionBusy} onClick={() => setMemberId(member.memberId)}><MemberAvatar memberId={member.memberId} displayName={member.displayName} avatarPreset={member.avatarPreset} size="sm" /><span>{member.displayName}</span>{memberId === member.memberId ? <Check aria-hidden="true" size={18} /> : null}</button>)}</div> : null}
          {!members.isPending && !members.error && !candidates.length ? <p className="empty-copy">暂无可转让的已绑定账号成员。</p> : null}
          {transferError ?? transfer.error ? <ErrorNotice error={transferError ?? transfer.error} /> : null}
          <div className="management-expansion__actions"><Button variant="secondary" type="button" disabled={actionBusy} onClick={() => setOwnershipOpen(false)}>取消</Button><Button type="button" busy={transfer.isPending} disabled={!memberId || actionBusy} onClick={() => void confirmTransfer()}>确认转让</Button></div>
        </div> : null}
      </section> : null}
      {!offline && activity.allowedLifecycleActions.length ? <section>
        <h2>活动状态</h2>
        <div className="management-action-list">{activity.allowedLifecycleActions.flatMap((action) => {
          const label = lifecycleLabels[action];
          if (!label) return [];
          const icon = action === "END" ? <CircleStop aria-hidden="true" size={19} /> : action === "REOPEN" ? <RotateCcw aria-hidden="true" size={19} /> : action === "ARCHIVE" ? <Archive aria-hidden="true" size={19} /> : <ArchiveRestore aria-hidden="true" size={19} />;
          return [<button key={action} className="management-action-row" type="button" disabled={actionBusy} aria-busy={lifecycle.isPending} onClick={() => void transition(action)}>{icon}<span><strong>{label}</strong><small>{lifecycleDescriptions[action]}</small></span><ChevronRight aria-hidden="true" size={18} /></button>];
        })}</div>
        {lifecycle.error ? <ErrorNotice error={lifecycle.error} /> : null}
      </section> : null}
      {!offline && activity.canDelete ? <section className="management-danger">
        <h2>危险操作</h2>
        <button className="management-action-row management-action-row--danger" type="button" aria-expanded={deleteOpen} aria-controls="activity-delete-panel" disabled={actionBusy} onClick={() => { setDeleteOpen((open) => !open); setDeleteError(undefined); }}><Trash2 aria-hidden="true" size={19} /><span><strong>删除活动</strong><small>活动将离开当前列表，可在恢复期限内找回</small></span><ChevronDown aria-hidden="true" className={deleteOpen ? "management-chevron management-chevron--open" : "management-chevron"} size={18} /></button>
        {deleteOpen ? <div className="management-expansion management-expansion--danger" id="activity-delete-panel"><p>删除后活动会离开当前列表，并在服务端给出的恢复期限内允许恢复。</p>{deleteError ?? remove.error ? <ErrorNotice error={deleteError ?? remove.error} /> : null}<div className="management-expansion__actions"><Button variant="secondary" type="button" disabled={remove.isPending} onClick={() => setDeleteOpen(false)}>取消</Button><Button autoFocus variant="danger" type="button" busy={remove.isPending} onClick={() => void confirmDelete()}>确认删除活动</Button></div></div> : null}
      </section> : null}
    </div>
  );
}

/** 管理 Overlay 只有一个页面；保存中的关闭请求会在成功后继续，失败则保留错误和草稿。 */
function ActivityManagementOverlay({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState({ busy: false, hasError: false });
  const [closeAfterSave, setCloseAfterSave] = useState(false);

  function requestClose() {
    if (!state.busy) return true;
    setCloseAfterSave(true);
    return false;
  }

  useEffect(() => {
    if (closeAfterSave && !state.busy && !state.hasError) {
      setCloseAfterSave(false);
      onClose();
    }
  }, [closeAfterSave, onClose, state.busy, state.hasError]);

  return (
    <Overlay open title="活动管理" onBeforeClose={requestClose} onClose={onClose} focusKey="management" className="activity-management-overlay">
      <MorePage onClose={onClose} closeAfterSave={closeAfterSave} onStateChange={setState} />
    </Overlay>
  );
}

export function MePage() {
  const session = useSessionQuery();
  const logout = useLogoutMutation();
  const avatar = useUpdateAvatarPresetMutation();
  const displayNameMutation = useUpdateDisplayNameMutation();
  const navigate = useNavigate();
  const { preference, setPreference } = useThemePreference();
  const currentAvatar = AVATAR_PRESETS.find((preset) => preset === session.data?.avatarPreset) ?? DEFAULT_AVATAR_PRESET;
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<AvatarPreset>(currentAvatar);
  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [themeOpen, setThemeOpen] = useState(false);

  function openAvatarPicker() {
    avatar.reset();
    setSelectedAvatar(currentAvatar);
    setAvatarOpen(true);
  }

  async function saveAvatar() {
    try {
      await avatar.mutateAsync(selectedAvatar);
      setAvatarOpen(false);
    } catch {
      // mutation.error 由 Overlay 内的 ErrorNotice 就地展示，保留当前选择。
    }
  }

  function openNicknameEditor() {
    displayNameMutation.reset();
    setNicknameError(null);
    setNickname(session.data?.displayName ?? "");
    setNicknameOpen(true);
  }

  async function saveNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = nickname.trim();
    const characterCount = Array.from(normalized).length;
    if (!(characterCount >= 1 && characterCount <= 80)) {
      setNicknameError("昵称无效，请输入 1 到 80 个字符。");
      return;
    }
    setNicknameError(null);
    try {
      await displayNameMutation.mutateAsync(normalized);
      setNicknameOpen(false);
    } catch {
      // mutation.error 由 Sheet 内的 ErrorNotice 就地展示，保留输入供用户重试。
    }
  }

  async function signOut() {
    try {
      await logout.mutateAsync();
      navigate("/login", { replace: true });
    } catch {
      // mutation.error 由页面内就地展示，避免 PWA 网络失败时出现未处理 Promise。
    }
  }

  const themeLabels: Record<ThemePreference, string> = {
    SYSTEM: "跟随系统",
    LIGHT: "亮色",
    DARK: "暗色",
  };
  const themeOptions: Array<[ThemePreference, string, ReactNode]> = [
    ["SYSTEM", "跟随系统", <Monitor aria-hidden="true" size={18} key="system" />],
    ["LIGHT", "亮色", <Sun aria-hidden="true" size={18} key="light" />],
    ["DARK", "暗色", <Moon aria-hidden="true" size={18} key="dark" />],
  ];

  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="home-header"><h1>我的</h1></header>
        <section className="profile-panel">
          <button className="profile-avatar-button" type="button" aria-label="选择头像" onClick={openAvatarPicker}>
            <MemberAvatar memberId={session.data?.userId ?? "current-user"} displayName={session.data?.displayName ?? "当前用户"} avatarPreset={currentAvatar} size="lg" decorative />
          </button>
          <button className="profile-identity-button" type="button" aria-label="修改昵称" onClick={openNicknameEditor}>
            <strong>{session.data?.displayName}</strong><small>{session.data?.username}</small><Pencil aria-hidden="true" size={16} />
          </button>
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
        <section className="account-settings" aria-labelledby="preferences-heading">
          <h2 id="preferences-heading">偏好设置</h2>
          <div className="settings-list">
            <button className="settings-link" type="button" aria-label={`主题：${themeLabels[preference]}`} onClick={() => setThemeOpen(true)}>
              <SunMoon aria-hidden="true" size={18} />
              <span><strong>主题</strong><small>调整应用显示模式</small></span>
              <span className="settings-link__value">{themeLabels[preference]}</span>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
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
        <section className="account-settings account-actions" aria-labelledby="account-actions-heading">
          <h2 id="account-actions-heading">账户操作</h2>
          <div className="settings-list">
            <button className="settings-link settings-link--danger" type="button" aria-label="退出登录" aria-busy={logout.isPending} disabled={logout.isPending} onClick={() => void signOut()}>
              {logout.isPending ? <LoaderCircle aria-hidden="true" className="spinner" size={18} /> : <LogOut aria-hidden="true" size={18} />}
              <span><strong>{logout.isPending ? "正在退出登录" : "退出登录"}</strong><small>结束当前设备上的登录状态</small></span>
            </button>
          </div>
          {logout.error ? <ErrorNotice error={logout.error} /> : null}
        </section>
      </main>
      <ProductBottomNavigation />
      <Overlay open={avatarOpen} title="选择头像" onClose={() => setAvatarOpen(false)} focusKey={String(selectedAvatar)}>
        <div className="avatar-picker">
          <div className="avatar-picker__grid" role="group" aria-label="默认头像">
            {AVATAR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className="avatar-picker__option"
                aria-label={`头像 ${preset}`}
                aria-pressed={selectedAvatar === preset}
                data-overlay-initial-focus={selectedAvatar === preset ? "" : undefined}
                onClick={() => setSelectedAvatar(preset)}
              >
                <MemberAvatar memberId={`avatar-${preset}`} displayName={`头像 ${preset}`} avatarPreset={preset} size="lg" decorative />
                <Check aria-hidden="true" size={18} />
              </button>
            ))}
          </div>
          {avatar.error ? <ErrorNotice error={avatar.error} /> : null}
          <Button className="avatar-picker__save" busy={avatar.isPending} onClick={() => void saveAvatar()}>保存头像</Button>
        </div>
      </Overlay>
      <Overlay open={nicknameOpen} title="修改昵称" onClose={() => setNicknameOpen(false)} focusKey={nicknameOpen ? "nickname" : "closed"}>
        <form className="form-stack nickname-form" onSubmit={(event) => void saveNickname(event)}>
          <Field label="昵称" error={nicknameError ?? undefined}>
            <Input data-overlay-initial-focus value={nickname} autoComplete="name" aria-invalid={nicknameError ? "true" : undefined} required onChange={(event) => { setNickname(event.target.value); setNicknameError(null); }} />
          </Field>
          {displayNameMutation.error ? <ErrorNotice error={displayNameMutation.error} /> : null}
          <Button type="submit" busy={displayNameMutation.isPending}>保存昵称</Button>
        </form>
      </Overlay>
      <Overlay open={themeOpen} title="主题" onClose={() => setThemeOpen(false)} focusKey={themeOpen ? preference : "closed"}>
        <div className="theme-picker" role="radiogroup" aria-label="显示模式">
          {themeOptions.map(([value, label, icon]) => (
            <button key={value} type="button" role="radio" aria-checked={preference === value} data-overlay-initial-focus={preference === value ? "" : undefined} onClick={() => setPreference(value)}>
              {icon}<span>{label}</span>{preference === value ? <Check aria-hidden="true" size={18} /> : null}
            </button>
          ))}
        </div>
      </Overlay>
    </div>
  );
}
