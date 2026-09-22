import { AccountingSkeleton } from "../accounting/skeleton";
import { ArrowLeft, MoreHorizontal, UsersRound } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useLayoutEffect, useRef } from "react";
import { Link, Outlet, useLocation, useMatch, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../../api/error";
import { ErrorNotice } from "../../components/ui";
import { ActivityCover } from "../../components/activity-cover";
import { setActivityCoverThemeColor } from "../../components/theme-provider";
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

const ACTIVITY_TAB_SWIPE_EDGE_GUARD = 20;
const ACTIVITY_TAB_SWIPE_HYSTERESIS = 10;
const ACTIVITY_TAB_SWIPE_DISTANCE = 48;
const ACTIVITY_TAB_SWIPE_AXIS_RATIO = 1.25;

type ActivityTab = "feed" | "settlement";
type ActivityTabGesture = {
  axis: "pending" | "horizontal" | "vertical";
  captured: boolean;
  pointerId: number;
  startX: number;
  startY: number;
};

function isActivitySwipeExcludedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable=\"true\"], [data-swipe-ignore=\"true\"]"));
}

/**
 * 主内容区只在移动端识别横向主导手势；纵向滚动、输入编辑和系统边缘返回始终优先。
 * 切页继续复用 URL 驱动的主路由，因此点击标签、滑动和浏览器历史保持同一套语义。
 */
function ActivityTabSwipe({ activityId, tab, disabled = false, children }: { activityId: string; tab: ActivityTab; disabled?: boolean; children: ReactNode }) {
  const navigate = useNavigate();
  const gestureRef = useRef<ActivityTabGesture | null>(null);
  const suppressClickRef = useRef(false);

  const releaseGesture = (event?: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (gesture?.captured && event && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    gestureRef.current = null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || event.pointerType !== "touch" || event.button > 0 || !window.matchMedia("(max-width: 639px)").matches) return;
    if (event.clientX <= ACTIVITY_TAB_SWIPE_EDGE_GUARD || event.clientX >= window.innerWidth - ACTIVITY_TAB_SWIPE_EDGE_GUARD) return;
    if (isActivitySwipeExcludedTarget(event.target)) return;
    suppressClickRef.current = false;
    gestureRef.current = { axis: "pending", captured: false, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const absoluteX = Math.abs(deltaX);
    const absoluteY = Math.abs(deltaY);
    if (gesture.axis === "pending") {
      if (Math.max(absoluteX, absoluteY) < ACTIVITY_TAB_SWIPE_HYSTERESIS) return;
      if (absoluteX <= absoluteY * ACTIVITY_TAB_SWIPE_AXIS_RATIO) {
        gesture.axis = "vertical";
        return;
      }
      gesture.axis = "horizontal";
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.captured = true;
      } catch {
        // 合成测试事件或不支持 Pointer Capture 的 WebView 不影响切页判定。
      }
    }
    if (gesture.axis === "horizontal") event.preventDefault();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const nextTab = deltaX < 0 ? "settlement" : "feed";
    const shouldSwitch = gesture.axis === "horizontal" && Math.abs(deltaX) >= ACTIVITY_TAB_SWIPE_DISTANCE && nextTab !== tab;
    if (shouldSwitch) {
      event.preventDefault();
      suppressClickRef.current = true;
      navigate(tabUrl(activityId, nextTab));
    }
    releaseGesture(event);
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerCancel = () => releaseGesture();

  return <main className="workspace-content" onClickCapture={onClickCapture} onLostPointerCapture={() => releaseGesture()} onPointerCancel={onPointerCancel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>{children}</main>;
}

/** 服务端明确拒绝活动访问时，旧 Snapshot 不能覆盖当前事实。 */
function isDefinitiveActivityError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.status >= 400 && error.status < 500;
}

/**
 * 页头保留展开时的文档占位，只裁剪表面、移动导航，避免改变高度触发滚动锚定。
 * 封面会把额外海报高度和元信息一起收起，直接跟随实际收起距离的滚动进度；窗口监听不捕获 Sheet 内部滚动，
 * DOM 更新按帧合并，不让整个工作台随每个滚动事件重新渲染。
 */
function WorkspaceHeader({ children, busy = false, withCover = false }: { children: ReactNode; busy?: boolean; withCover?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  useLayoutEffect(() => {
    const header = ref.current!;
    const metadata = header.querySelector<HTMLElement>(".workspace-header__metadata")!;
    const actions = header.querySelector<HTMLElement>(".workspace-header__actions")!;
    const nav = header.querySelector<HTMLElement>(".workspace-nav")!;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let metadataHeight = metadata.getBoundingClientRect().height;
    let collapseDistance = metadataHeight;
    const measure = () => {
      metadataHeight = metadata.getBoundingClientRect().height;
      if (!withCover) {
        collapseDistance = metadataHeight;
        return;
      }
      const headerHeight = header.getBoundingClientRect().height;
      const paddingTop = Number.parseFloat(window.getComputedStyle(header).paddingTop) || 0;
      // 悬浮胶囊的底部间距属于收起后的紧凑页头高度，避免裁剪时跳动或露出正文背景。
      const navMarginBottom = Number.parseFloat(window.getComputedStyle(nav).marginBottom) || 0;
      const compactHeight = paddingTop + actions.getBoundingClientRect().height + nav.getBoundingClientRect().height + navMarginBottom;
      collapseDistance = Math.max(0, headerHeight - compactHeight);
    };
    const update = () => {
      frame = 0;
      const threshold = Math.max(1, collapseDistance);
      const progress = reducedMotion.matches ? Number(window.scrollY >= threshold) : Math.min(1, Math.max(0, window.scrollY / threshold));
      const offset = progress * collapseDistance;
      header.style.clipPath = `inset(0 0 ${offset}px 0)`;
      nav.style.transform = `translateY(${-offset}px)`;
      metadata.style.opacity = String(1 - progress);
      metadata.style.transform = reducedMotion.matches ? "none" : `translateY(${-8 * progress}px)`;
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    const resize = new ResizeObserver(() => { measure(); schedule(); });
    resize.observe(header);
    resize.observe(metadata);
    measure();
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
  }, [location.key, busy, withCover]);
  return <header ref={ref} className={`workspace-header${withCover ? " workspace-header--cover" : ""}`} aria-busy={busy || undefined}>{children}</header>;
}

/**
 * 深度阅读页面使用独立外壳，但仍复用 ActivityWorkspace 提供的活动、成员和快照上下文。
 * 返回按钮优先回到流水进入前的位置；直接打开深链时回退到该活动的流水页。
 */
function StandaloneDetailFrame({ activityId, children, pending = false, readOnly = false, title = "账单详情" }: { activityId: string; children: ReactNode; pending?: boolean; readOnly?: boolean; title?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { activityStatisticsFromFeed?: boolean; expenseDetailFromFeed?: boolean } | null;
  const fromFeed = Boolean(state?.expenseDetailFromFeed || state?.activityStatisticsFromFeed);
  const goBack = () => {
    if (fromFeed) navigate(-1);
    else navigate(tabUrl(activityId, "feed"));
  };
  return <section className="standalone-detail-shell">
    <header className="standalone-detail-header">
      <button className="standalone-detail-header__back" type="button" aria-label="返回流水" onClick={goBack}><ArrowLeft aria-hidden="true" size={18} /><span>流水</span></button>
      <h1>{title}</h1>
      {readOnly ? <span className="standalone-detail-header__status">只读</span> : pending ? <span className="standalone-detail-header__status standalone-detail-header__status--placeholder" aria-hidden="true" /> : <span aria-hidden="true" />}
    </header>
    <main className="standalone-detail-content">{children}</main>
  </section>;
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
  const expenseDetailMatch = useMatch("/activities/:activityId/expenses/:expenseId");
  const isExpenseDetailRoute = Boolean(expenseDetailMatch && expenseDetailMatch.params.expenseId !== "new");
  const isStatisticsRoute = Boolean(useMatch("/activities/:activityId/statistics"));
  const navigate = useNavigate();
  const activityData = activity.data ?? snapshot.data?.snapshot.activity;
  const shouldUseActivityCoverTheme = !isExpenseDetailRoute && !isStatisticsRoute && !session.error && !activity.error && !snapshot.error;

  /** 活动主工作台只临时覆盖浏览器 theme-color；切换到详情、报错或卸载时统一恢复主题色。 */
  useLayoutEffect(() => {
    setActivityCoverThemeColor(shouldUseActivityCoverTheme);
    return () => setActivityCoverThemeColor(false);
  }, [shouldUseActivityCoverTheme]);

  const standaloneTitle = isStatisticsRoute ? "活动统计" : "账单详情";
  if (session.isPending || (online ? activity.isPending && !snapshot.data : snapshot.isPending)) return isExpenseDetailRoute || isStatisticsRoute ? <StandaloneDetailFrame activityId={activityId} title={standaloneTitle} pending><AccountingSkeleton kind="feed" /></StandaloneDetailFrame> : <section className="workspace">
    <WorkspaceHeader busy withCover><div className="workspace-header__actions"><Link className="back-link" to="/activities" aria-label="返回活动列表"><ArrowLeft size={20} /></Link><div className="workspace-header__identity accounting-skeleton"><i style={{ width: "100%", maxWidth: 160, height: 28 }} /></div></div><div className="workspace-header__metadata accounting-skeleton"><i style={{ width: 140, height: 18 }} /></div><nav className="workspace-nav" aria-label="活动导航"><Link to={tabUrl(activityId ?? "", "feed")} className={searchParams.get("tab") !== "settlement" ? "active" : ""}>流水</Link><Link to={tabUrl(activityId ?? "", "settlement")} className={searchParams.get("tab") === "settlement" ? "active" : ""}>结算</Link></nav></WorkspaceHeader>
    <main className="workspace-content"><AccountingSkeleton kind={searchParams.get("tab") === "settlement" ? "settlement" : "feed"} /></main>
  </section>;
  const definitiveError = [activity.error, snapshot.error].find(isDefinitiveActivityError);
  if (session.error || definitiveError || (activity.error && !snapshot.data) || snapshot.error && !online) {
    const error = <ErrorNotice error={session.error ?? definitiveError ?? activity.error ?? snapshot.error} />;
    return isExpenseDetailRoute || isStatisticsRoute ? <StandaloneDetailFrame activityId={activityId} title={standaloneTitle}>{error}</StandaloneDetailFrame> : error;
  }
  if (!session.data) return null;
  const membersData = members.data ?? snapshot.data?.snapshot.members ?? [];
  if (!activityData) return null;

  const tab = searchParams.get("tab") === "settlement" ? "settlement" : "feed";
  const panel = searchParams.get("panel");
  const closePanel = () => navigate(tabUrl(activityId, tab), { replace: true });
  const standaloneReadOnly = Boolean(isExpenseDetailRoute && (activityData.status !== "ACTIVE" || !online));
  const standalone = standaloneReadOnly || isStatisticsRoute;

  return (
      <WorkspaceContext.Provider value={{ session: session.data, activity: activityData, members: membersData, offline: !online, snapshot: snapshot.data }}>
      {standalone ? <StandaloneDetailFrame activityId={activityId} title={standaloneTitle} readOnly={standaloneReadOnly}><Outlet /></StandaloneDetailFrame> : <section className="workspace">
        <WorkspaceHeader withCover>
          <ActivityCover className="workspace-header__cover" activityId={activityData.activityId} coverPreset={activityData.coverPreset} coverImageId={activityData.coverImageId} alt="" loading="eager" />
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
        <ActivityTabSwipe activityId={activityId} tab={tab} disabled={Boolean(panel)}><Outlet /></ActivityTabSwipe>
      </section>}
      {panel === "members" ? <MembersOverlay onClose={closePanel} /> : null}
      {panel === "manage" ? <ActivityManagementOverlay onClose={closePanel} /> : null}
    </WorkspaceContext.Provider>
  );
}
