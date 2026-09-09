import { AccountingSkeleton } from "../accounting/skeleton";
import { ArrowLeft, MoreHorizontal, UsersRound } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../../api/error";
import { ErrorNotice } from "../../components/ui";
import { useActivityQuery, useMembersQuery } from "./api";
import { useSessionQuery } from "../auth/api";
import { useActivitySnapshotQuery, useOnlineStatus } from "./offline-workspace";
import { WorkspaceContext } from "./workspace-context";
import { activityStatus, activityPeriodLabel } from "./presentation";
import { MembersOverlay } from "./members-panel";
import { ActivityManagementOverlay } from "./management-panel";

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

/**
 * 页头保留展开时的文档占位，只裁剪表面、移动导航，避免改变高度触发滚动锚定。
 * 直接跟随页面顶部 32px 的滚动进度；窗口监听不捕获 Sheet 内部滚动，
 * DOM 更新按帧合并，不让整个工作台随每个滚动事件重新渲染。
 */
function WorkspaceHeader({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  useLayoutEffect(() => {
    const header = ref.current!;
    const metadata = header.querySelector<HTMLElement>(".workspace-header__metadata")!;
    const nav = header.querySelector<HTMLElement>(".workspace-nav")!;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let metadataHeight = metadata.getBoundingClientRect().height;
    const update = () => {
      frame = 0;
      const progress = reducedMotion.matches ? Number(window.scrollY >= 32) : Math.min(1, Math.max(0, window.scrollY / 32));
      const offset = progress * metadataHeight;
      header.style.clipPath = `inset(0 0 ${offset}px 0)`;
      nav.style.transform = `translateY(${-offset}px)`;
      metadata.style.opacity = String(1 - progress);
      metadata.style.transform = reducedMotion.matches ? "none" : `translateY(${-8 * progress}px)`;
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const resize = new ResizeObserver(() => {
      metadataHeight = metadata.getBoundingClientRect().height;
      schedule();
    });
    resize.observe(metadata);
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("pageshow", schedule);
    reducedMotion.addEventListener("change", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("pageshow", schedule);
      reducedMotion.removeEventListener("change", schedule);
      resize.disconnect();
    };
  }, [location.key, busy]);
  return <header ref={ref} className="workspace-header" aria-busy={busy || undefined}>{children}</header>;
}

/** 活动路由容器负责在线与快照读取，并向嵌套路由和面板提供同一个工作区上下文。 */
export function ActivityWorkspace() {
  const { activityId = "" } = useParams();
  const session = useSessionQuery();
  const online = useOnlineStatus();
  const snapshot = useActivitySnapshotQuery(session.data?.userId ?? "", activityId);
  const activity = useActivityQuery(session.data?.userId ?? "", activityId, online);
  const members = useMembersQuery(session.data?.userId ?? "", activityId, online);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  if (session.isPending || (online ? activity.isPending && !snapshot.data : snapshot.isPending)) return <section className="workspace">
    <WorkspaceHeader busy><div className="workspace-header__actions"><Link className="back-link" to="/activities" aria-label="返回活动列表"><ArrowLeft size={20} /></Link><div className="workspace-header__identity accounting-skeleton"><i style={{ width: "100%", maxWidth: 160, height: 28 }} /></div></div><div className="workspace-header__metadata accounting-skeleton"><i style={{ width: 140, height: 18 }} /></div><nav className="workspace-nav" aria-label="活动导航"><Link to={tabUrl(activityId ?? "", "feed")} className={searchParams.get("tab") !== "settlement" ? "active" : ""}>流水</Link><Link to={tabUrl(activityId ?? "", "settlement")} className={searchParams.get("tab") === "settlement" ? "active" : ""}>结算</Link></nav></WorkspaceHeader>
    <main className="workspace-content"><AccountingSkeleton kind={searchParams.get("tab") === "settlement" ? "settlement" : "feed"} /></main>
  </section>;
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
        <WorkspaceHeader>
          <div className="workspace-header__actions">
            <Link className="back-link" to="/activities" aria-label="返回活动列表"><ArrowLeft aria-hidden="true" size={20} /></Link>
            <div className="workspace-header__identity"><h1 title={activityData.name}>{activityData.name}</h1></div>
            <Link className="workspace-header__members" to={tabUrl(activityId, tab, "members")}>
              <UsersRound aria-hidden="true" size={17} /> 成员 {membersData.length}
            </Link>
            <Link className="icon-button" to={tabUrl(activityId, tab, "manage")} aria-label="活动管理" title="活动管理"><MoreHorizontal aria-hidden="true" size={21} /></Link>
          </div>
          <div className="workspace-header__metadata">
            <p>{activityPeriodLabel(activityData) ? `${activityPeriodLabel(activityData)} · ` : null}{activityStatus(activityData.status)}</p>
          </div>
          <nav className="workspace-nav" aria-label="活动导航">
            <Link className={tab === "feed" ? "active" : ""} aria-current={tab === "feed" ? "page" : undefined} to={tabUrl(activityId, "feed")}>流水</Link>
            <Link className={tab === "settlement" ? "active" : ""} aria-current={tab === "settlement" ? "page" : undefined} to={tabUrl(activityId, "settlement")}>结算</Link>
          </nav>
        </WorkspaceHeader>
        <main className="workspace-content"><Outlet /></main>
      </section>
      {panel === "members" ? <MembersOverlay onClose={closePanel} /> : null}
      {panel === "manage" ? <ActivityManagementOverlay onClose={closePanel} /> : null}
    </WorkspaceContext.Provider>
  );
}
