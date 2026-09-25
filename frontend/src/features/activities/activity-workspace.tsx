import { AccountingSkeleton } from "../accounting/skeleton";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Popover } from "radix-ui";
import { Link, Outlet, useLocation, useMatch, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../../api/error";
import { ErrorNotice } from "../../components/ui";
import { useActivityQuery, useMembersQuery } from "./api";
import { useSessionQuery } from "../auth/api";
import { useActivitySnapshotQuery, useOnlineStatus } from "./offline-workspace";
import { WorkspaceContext } from "./workspace-context";
import { ActivityViewProvider } from "./activity-view-state";
import { FeedFilterProvider } from "../accounting/feed-filter-context";
import { activityStatus } from "./presentation";
import { MembersOverlay } from "./members-panel";
import { ActivityManagementOverlay } from "./management-panel";

type ActivityTab = "feed" | "settlement";
function tabUrl(activityId: string, tab: ActivityTab, panel?: "members" | "manage") {
  const base = `/activities/${encodeURIComponent(activityId)}${tab === "settlement" ? "/settlement" : ""}`;
  return `${base}${panel ? `?panel=${panel}` : ""}`;
}

/** 服务端明确拒绝活动访问时，旧 Snapshot 不能覆盖当前事实。 */
function isDefinitiveActivityError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status >= 400 && error.status < 500;
}

/** 活动信息、统计与分享共用轻量菜单，关闭后由 Popover 恢复入口焦点。 */
function ActivityActionsMenu({ activityId }: { activityId: string }) {
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button className="icon-button" type="button" aria-label="更多操作" data-focus-key="activity-menu"><MoreHorizontal aria-hidden="true" size={21} /></button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="activity-actions-popover" side="bottom" align="end" sideOffset={8}>
      <nav className="activity-actions-popover__list" aria-label="活动操作">
        <Link className="activity-actions-popover__item" to={tabUrl(activityId, "feed", "manage")} state={{ activityManagementFromWorkspace: true }} onClick={closeMenu}>活动信息</Link>
        <Link className="activity-actions-popover__item" to={`/activities/${encodeURIComponent(activityId)}/statistics`} state={{ activityStatisticsFromWorkspace: true, activityStatisticsFromTab: "feed" }} onClick={closeMenu}>活动统计</Link>
        <Link className="activity-actions-popover__item" to={`/share-feed/${encodeURIComponent(activityId)}`} onClick={closeMenu}>分享流水小票</Link>
      </nav>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

/**
 * 深度阅读页面使用独立外壳，但仍复用 ActivityWorkspace 提供的活动、成员和快照上下文。
 * 返回按钮优先回到流水进入前的位置；直接打开深链时回退到该活动的流水页。
 */
function StandaloneDetailFrame({ activityId, children, pending = false, readOnly = false, title = "账单详情" }: { activityId: string; children: ReactNode; pending?: boolean; readOnly?: boolean; title?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { activityStatisticsFromFeed?: boolean; activityStatisticsFromWorkspace?: boolean; activityStatisticsFromTab?: ActivityTab; expenseDetailFromFeed?: boolean; expenseDetailFromStatistics?: boolean } | null;
  const statisticsReturnTab = state?.activityStatisticsFromTab === "settlement" ? "settlement" : "feed";
  const fromWorkspace = Boolean(state?.expenseDetailFromFeed || state?.expenseDetailFromStatistics || state?.activityStatisticsFromFeed || state?.activityStatisticsFromWorkspace);
  const backTab = title === "活动统计" ? statisticsReturnTab : "feed";
  const backLabel = state?.expenseDetailFromStatistics ? "活动统计" : backTab === "settlement" ? "结算" : "流水";
  const goBack = () => {
    if (fromWorkspace) navigate(-1);
    else navigate(tabUrl(activityId, backTab));
  };
  return <section className="standalone-detail-shell">
    <header className={`standalone-detail-header${state?.expenseDetailFromStatistics ? " standalone-detail-header--statistics-back" : ""}`}>
      <button className="standalone-detail-header__back" type="button" aria-label={`返回${backLabel}`} onClick={goBack}><ArrowLeft aria-hidden="true" size={18} /><span>{backLabel}</span></button>
      <h1>{title}</h1>
      {readOnly ? <span className="standalone-detail-header__status">只读</span> : pending ? <span className="standalone-detail-header__status standalone-detail-header__status--placeholder" aria-hidden="true" /> : <span aria-hidden="true" />}
    </header>
    <main className="standalone-detail-content">{children}</main>
  </section>;
}

/** 活动容器提供数据与会话状态；独立结算页和详情页各自拥有紧凑页头。 */
export function ActivityWorkspace() {
  const { activityId = "" } = useParams();
  const session = useSessionQuery();
  const online = useOnlineStatus();
  const snapshot = useActivitySnapshotQuery(session.data?.userId ?? "", activityId);
  const activity = useActivityQuery(session.data?.userId ?? "", activityId, online);
  const members = useMembersQuery(session.data?.userId ?? "", activityId, online);
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const expenseDetailMatch = useMatch("/activities/:activityId/expenses/:expenseId");
  const isExpenseDetailRoute = Boolean(expenseDetailMatch && expenseDetailMatch.params.expenseId !== "new");
  const isStatisticsRoute = Boolean(useMatch("/activities/:activityId/statistics"));
  const isSettlementRoute = Boolean(useMatch("/activities/:activityId/settlement")) || searchParams.get("tab") === "settlement";
  const navigate = useNavigate();
  const activityData = activity.data ?? snapshot.data?.snapshot.activity;
  const standaloneTitle = isStatisticsRoute ? "活动统计" : "账单详情";
  if (session.isPending || (online ? activity.isPending && !snapshot.data : snapshot.isPending)) return isExpenseDetailRoute || isStatisticsRoute ? <StandaloneDetailFrame activityId={activityId} title={standaloneTitle} pending><AccountingSkeleton kind="feed" /></StandaloneDetailFrame> : <section className="workspace">
    <header className="workspace-header workspace-header--compact" aria-busy="true"><div className="workspace-header__actions"><Link className="back-link" to={isSettlementRoute ? tabUrl(activityId, "feed") : "/activities"} aria-label={isSettlementRoute ? "返回流水" : "返回活动列表"}><ArrowLeft size={20} /></Link><div className="workspace-header__identity accounting-skeleton"><i style={{ width: 160, height: 24 }} /></div></div></header>
    <main className="workspace-content"><AccountingSkeleton kind={isSettlementRoute ? "settlement" : "feed"} /></main>
  </section>;
  const definitiveError = [activity.error, snapshot.error].find(isDefinitiveActivityError);
  if (session.error || definitiveError || (activity.error && !snapshot.data) || snapshot.error && !online) {
    const error = <ErrorNotice error={session.error ?? definitiveError ?? activity.error ?? snapshot.error} />;
    return isExpenseDetailRoute || isStatisticsRoute ? <StandaloneDetailFrame activityId={activityId} title={standaloneTitle}>{error}</StandaloneDetailFrame> : error;
  }
  if (!session.data || !activityData) return null;
  const membersData = members.data ?? snapshot.data?.snapshot.members ?? [];
  const panel = searchParams.get("panel");
  const closePanel = () => {
    if (panel === "manage" && (location.state as { activityManagementFromWorkspace?: boolean } | null)?.activityManagementFromWorkspace) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("panel");
    navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
  };
  const standaloneReadOnly = Boolean(isExpenseDetailRoute && (activityData.status !== "ACTIVE" || !online || searchParams.get("view") === "readonly"));
  const standalone = standaloneReadOnly || isStatisticsRoute;
  return <ActivityViewProvider key={`${session.data.userId}:${activityId}`}><FeedFilterProvider>
    <WorkspaceContext.Provider value={{ session: session.data, activity: activityData, members: membersData, offline: !online, snapshot: snapshot.data }}>
      {standalone ? <StandaloneDetailFrame activityId={activityId} title={standaloneTitle} readOnly={standaloneReadOnly}><Outlet /></StandaloneDetailFrame> : <section className="workspace">
        {isSettlementRoute ? <Outlet /> : <>
          <header className="workspace-header workspace-header--compact"><div className="workspace-header__actions">
            <Link className="back-link" to="/activities" aria-label="返回活动列表"><ArrowLeft aria-hidden="true" size={20} /></Link>
            <div className="workspace-header__identity"><h1 title={activityData.name}>{activityData.name}</h1></div>
            {activityData.status !== "ACTIVE" ? <span className="workspace-header__status">{activityStatus(activityData.status)}</span> : null}
            <Link className="workspace-members-entry" to={tabUrl(activityId, "feed", "members")} aria-label={`成员 ${membersData.length}`} data-focus-key="activity-members">成员 <span>{membersData.length}</span></Link>
            <ActivityActionsMenu activityId={activityId} />
          </div></header>
          <main className="workspace-content"><Outlet /></main>
        </>}
      </section>}
      {panel === "members" ? <MembersOverlay onClose={closePanel} /> : null}
      {panel === "manage" ? <ActivityManagementOverlay onClose={closePanel} /> : null}
    </WorkspaceContext.Provider>
  </FeedFilterProvider></ActivityViewProvider>;
}
