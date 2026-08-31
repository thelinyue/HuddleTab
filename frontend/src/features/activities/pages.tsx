import {
  ArrowLeft,
  Bell,
  ChevronRight,
  CircleDollarSign,
  KeyRound,
  Link as LinkIcon,
  MapPin,
  MoreHorizontal,
  Plus,
  UserPlus,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
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
import { useActivityLedgersQuery } from "../accounting/api";
import {
  type Activity,
  useActivitiesQuery,
  useActivityQuery,
  useCreateActivityMutation,
  useCreateGuestMutation,
  useCreateInvitationMutation,
  useInvitationsQuery,
  useMembersQuery,
  useRevokeInvitationMutation,
} from "./api";
import { type Session, useLogoutMutation, useSessionQuery } from "../auth/api";

type WorkspaceValue = { session: Session; activity: Activity };
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

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

function Overlay({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="form-overlay" role="presentation">
      <button className="form-overlay__scrim" type="button" aria-label={`关闭${title}`} onClick={onClose} />
      <section className="form-overlay__sheet" role="dialog" aria-modal="true" aria-labelledby="overlay-title">
        <header className="form-overlay__header">
          <h2 id="overlay-title">{title}</h2>
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
  const activity = useActivityQuery(session.data?.userId ?? "", activityId);
  const members = useMembersQuery(session.data?.userId ?? "", activityId);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  if (session.isPending || activity.isPending) return <LoadingState label="正在打开活动…" />;
  if (session.error || activity.error) return <ErrorNotice error={session.error ?? activity.error} />;
  if (!session.data || !activity.data) return null;

  const tab = searchParams.get("tab") === "settlement" ? "settlement" : "feed";
  const panel = searchParams.get("panel");
  const closePanel = () => navigate(tabUrl(activityId, tab), { replace: true });

  return (
    <WorkspaceContext.Provider value={{ session: session.data, activity: activity.data }}>
      <section className="workspace">
        <header className="workspace-header">
          <div className="workspace-header__actions">
            <Link className="back-link" to="/activities" aria-label="返回活动列表"><ArrowLeft aria-hidden="true" size={20} /></Link>
            <span className="workspace-header__spacer" />
            <Link className="workspace-header__members" to={tabUrl(activityId, tab, "members")}>
              <UsersRound aria-hidden="true" size={17} /> 成员 {members.data?.length ?? 0}
            </Link>
            <Link className="icon-button" to={tabUrl(activityId, tab, "manage")} aria-label="活动管理" title="活动管理"><MoreHorizontal aria-hidden="true" size={21} /></Link>
          </div>
          <div className="workspace-header__identity">
            <h1>{activity.data.name}</h1>
            <p>{members.data?.length ?? 0}人 · {activityStatus(activity.data.status)} · {activity.data.baseCurrency}</p>
          </div>
          <nav className="workspace-nav" aria-label="活动导航">
            <Link className={tab === "feed" ? "active" : ""} aria-current={tab === "feed" ? "page" : undefined} to={tabUrl(activityId, "feed")}>流水</Link>
            <Link className={tab === "settlement" ? "active" : ""} aria-current={tab === "settlement" ? "page" : undefined} to={tabUrl(activityId, "settlement")}>结算</Link>
          </nav>
        </header>
        <main className="workspace-content"><Outlet /></main>
      </section>
      <Overlay open={panel === "members"} title="成员" onClose={closePanel}><MembersPage /></Overlay>
      <Overlay open={panel === "manage"} title="活动管理" onClose={closePanel}><MorePage /></Overlay>
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
                <span className="activity-list-item__content"><strong>{activity.name}</strong><small>{activityStatus(activity.status)} · {activity.baseCurrency}</small></span>
                <span className="activity-list-item__balance">{amount === 0n ? <small>已结清</small> : <><small>{amount > 0n ? "应收" : "应付"}</small><Money value={formatMoney(activity.baseCurrency, (amount < 0n ? -amount : amount).toString())} tone={amount > 0n ? "positive" : "negative"} /></>}<ChevronRight aria-hidden="true" size={16} /></span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ActivitiesPage() {
  const session = useSessionQuery();
  const activities = useActivitiesQuery(session.data?.userId ?? "");
  const ledgers = useActivityLedgersQuery(session.data?.userId ?? "", activities.data ?? []);
  const create = useCreateActivityMutation(session.data?.userId ?? "");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("CNY");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await create.mutateAsync({ name, baseCurrency });
    setName("");
    setOpen(false);
  }

  if (session.isPending || activities.isPending) return <LoadingState label="正在读取活动…" />;
  if (session.error || activities.error) return <ErrorNotice error={session.error ?? activities.error} />;
  const items = activities.data ?? [];
  const summaries = summarizeLedgers(items, ledgers);
  const active = items.filter((item) => item.status === "ACTIVE");
  const ended = items.filter((item) => item.status !== "ACTIVE");
  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="home-header"><h1>活动</h1><button className="home-add" type="button" aria-label="创建活动" onClick={() => setOpen(true)}><Plus aria-hidden="true" size={18} /></button></header>
        {summaries.map(([currency, summary]) => (
          <dl className="home-summary" key={currency} aria-label={`${currency} 跨活动账务摘要`}>
            <div><dt>待支付</dt><dd><Money value={formatMoney(currency, summary.payable.toString())} tone="negative" /></dd></div>
            <div><dt>待收款</dt><dd><Money value={formatMoney(currency, summary.receivable.toString())} tone="positive" /></dd></div>
          </dl>
        ))}
        {!items.length ? <EmptyState icon={<Plus size={28} />} title="还没有活动" description="创建第一个活动后，就可以开始记录消费。" action={<Button onClick={() => setOpen(true)}>创建活动</Button>} /> : null}
        <ActivityGroup title="进行中的活动" activities={active} allActivities={items} ledgers={ledgers} />
        <ActivityGroup title="最近结束" activities={ended} allActivities={items} ledgers={ledgers} />
      </main>
      <ProductBottomNavigation />
      <Overlay open={open} title="创建活动" onClose={() => setOpen(false)}>
        <form className="form-stack" onSubmit={submit}>
          <Field label="活动名称"><Input value={name} onChange={(event) => setName(event.target.value)} required autoFocus maxLength={120} /></Field>
          <Field label="主币种"><Select value={baseCurrency} onChange={(event) => setBaseCurrency(event.target.value)}><option value="CNY">CNY 人民币</option><option value="USD">USD 美元</option><option value="EUR">EUR 欧元</option><option value="JPY">JPY 日元</option></Select></Field>
          {create.error ? <ErrorNotice error={create.error} /> : null}
          <Button type="submit" busy={create.isPending}>创建活动</Button>
        </form>
      </Overlay>
    </div>
  );
}

export function MembersPage() {
  const { session, activity } = useWorkspace();
  const members = useMembersQuery(session.userId, activity.activityId);
  const invitations = useInvitationsQuery(session.userId, activity.activityId, true);
  const createGuest = useCreateGuestMutation(session.userId, activity.activityId);
  const createInvitation = useCreateInvitationMutation(session.userId, activity.activityId);
  const revokeInvitation = useRevokeInvitationMutation(session.userId, activity.activityId);
  const [guestName, setGuestName] = useState("");
  const [createdToken, setCreatedToken] = useState<string>();

  if (members.isPending) return <LoadingState label="正在读取成员…" />;
  if (members.error) return <ErrorNotice error={members.error} />;
  return (
    <div className="member-center">
      <div className="member-actions">
        <Button onClick={() => void createInvitation.mutateAsync({ kind: "LINK", maxUses: null, targetUsername: null }).then((result) => setCreatedToken(result.token))}><UserPlus aria-hidden="true" size={18} /> 邀请成员</Button>
        <form onSubmit={(event) => { event.preventDefault(); void createGuest.mutateAsync(guestName).then(() => setGuestName("")); }}><Input aria-label="临时成员名称" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="临时成员名称" required /><Button variant="secondary" type="submit" busy={createGuest.isPending}>添加</Button></form>
      </div>
      {createdToken ? <div className="issued-invite" role="status"><strong>邀请口令已创建</strong><code>{createdToken}</code></div> : null}
      {createGuest.error || createInvitation.error ? <ErrorNotice error={createGuest.error ?? createInvitation.error} /> : null}
      <section className="member-section"><h2>活动成员 · {members.data?.length ?? 0}人</h2><div className="member-list">{members.data?.map((member) => <div className="member-row" key={member.memberId}><MemberAvatar memberId={member.memberId} displayName={member.displayName} /><span><strong>{member.displayName}{member.memberId === activity.currentMemberId ? "（我）" : ""}</strong><small>{member.userId ? "正式成员" : "临时成员"}</small></span><span className="tag">{member.role === "OWNER" ? "所有者" : member.role === "ADMIN" ? "管理员" : "成员"}</span></div>)}</div></section>
      {invitations.data?.length ? <section className="member-section"><h2>有效邀请</h2><div className="compact-list">{invitations.data.filter((invite) => !invite.revokedAt).map((invite) => <div key={invite.invitationId}><span><strong>{invite.kind === "DIRECT" ? invite.targetUsername ?? "定向邀请" : "链接加入"}</strong><small>已使用 {invite.useCount}{invite.maxUses ? ` / ${invite.maxUses}` : ""}</small></span><Button variant="ghost" busy={revokeInvitation.isPending} onClick={() => revokeInvitation.mutate(invite.invitationId)}>撤销</Button></div>)}</div></section> : null}
    </div>
  );
}

export function MorePage() {
  const { activity } = useWorkspace();
  return (
    <div className="activity-more">
      <section><h2>活动信息</h2><div className="settings-list"><div><MapPin aria-hidden="true" size={17} /><span>活动名称</span><strong>{activity.name}</strong></div><div><CircleDollarSign aria-hidden="true" size={17} /><span>主币种</span><strong>{activity.baseCurrency}</strong></div><div><UsersRound aria-hidden="true" size={17} /><span>状态</span><strong>{activityStatus(activity.status)}</strong></div></div></section>
      <section><h2>协作与分享</h2><div className="settings-list"><div><LinkIcon aria-hidden="true" size={17} /><span>成员和邀请请从页头“成员”进入</span></div></div></section>
    </div>
  );
}

export function NotificationsPage() {
  return <TopLevelPlaceholder icon={<Bell size={28} />} title="通知" description="通知能力将在后续阶段接入。" />;
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
        <Button variant="secondary" busy={logout.isPending} onClick={() => void logout.mutateAsync().then(() => navigate("/login", { replace: true }))}>退出登录</Button>
      </main>
      <ProductBottomNavigation />
    </div>
  );
}

function TopLevelPlaceholder({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return <div className="top-level-page"><main className="app-frame app-frame--with-nav"><header className="home-header"><h1>{title}</h1></header><EmptyState icon={icon} title={title} description={description} /></main><ProductBottomNavigation /></div>;
}
