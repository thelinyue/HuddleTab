import { AccountingSkeleton } from "../accounting/skeleton";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Link, Outlet, useLocation, useMatch, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiRequestError } from "../../api/error";
import { ErrorNotice } from "../../components/ui";
import { ActivityCover } from "../../components/activity-cover";
import { MemberAvatar } from "../../components/member-avatar";
import { setActivityCoverThemeColor } from "../../components/theme-provider";
import { type ActivityMember, useActivityQuery, useMembersQuery } from "./api";
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

const ACTIVITY_MEMBER_AVATAR_SIZE = 38;
const ACTIVITY_MEMBER_STACK_OVERLAP = 12;
const ACTIVITY_MEMBER_STACK_HORIZONTAL_PADDING = 12;

/** 根据头像堆叠实际可用宽度计算可见数量；隐藏成员时预留一个头像槽位给 +N。 */
export function visibleActivityMemberCount(memberCount: number, availableWidth: number): number {
  if (memberCount <= 0) return 0;
  const contentWidth = Math.max(0, availableWidth - ACTIVITY_MEMBER_STACK_HORIZONTAL_PADDING);
  const step = ACTIVITY_MEMBER_AVATAR_SIZE - ACTIVITY_MEMBER_STACK_OVERLAP;
  const allMembersWidth = ACTIVITY_MEMBER_AVATAR_SIZE + Math.max(0, memberCount - 1) * step;
  if (allMembersWidth <= contentWidth) return memberCount;
  const visibleWithOverflow = Math.floor((contentWidth - ACTIVITY_MEMBER_AVATAR_SIZE) / step);
  return Math.min(memberCount, Math.max(1, visibleWithOverflow));
}

/**
 * 活动页把成员入口收敛为导航附近的头像堆叠，保留整组头像作为一个可点击入口。
 * 头像只负责视觉识别，链接的 aria-label 和 title 继续明确告知成员数量；鼠标按下不抢焦点，
 * 避免浏览器把收起状态下经过位移的链接滚回它的原始布局位置，键盘仍可正常聚焦和激活。
 */
function ActivityMemberStack({ activityId, tab, members }: { activityId: string; tab: ActivityTab; members: readonly ActivityMember[] }) {
  const stackRef = useRef<HTMLAnchorElement>(null);
  const [visibleMemberCount, setVisibleMemberCount] = useState(members.length);
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const updateVisibleMemberCount = () => {
      // jsdom 没有布局宽度时保留首屏全量渲染，真实浏览器由 ResizeObserver 立即测量。
      if (!stack.clientWidth) return;
      const nextCount = visibleActivityMemberCount(members.length, stack.clientWidth);
      setVisibleMemberCount((current) => current === nextCount ? current : nextCount);
    };
    const resize = new ResizeObserver(updateVisibleMemberCount);
    resize.observe(stack);
    updateVisibleMemberCount();
    return () => resize.disconnect();
  }, [members.length]);

  const visibleMembers = members.slice(0, visibleMemberCount);
  const hiddenCount = Math.max(0, members.length - visibleMembers.length);
  return <Link ref={stackRef} className="workspace-header__members-stack" to={tabUrl(activityId, tab, "members")} aria-label={`成员 ${members.length}`} title={`成员 ${members.length}`} onMouseDown={(event) => event.preventDefault()}>
    <span className="workspace-header__members-stack-list" aria-hidden="true">
      {visibleMembers.map(member => <span className="workspace-header__members-stack-item" key={member.memberId}><MemberAvatar memberId={member.memberId} userId={member.userId} displayName={member.displayName} avatarPreset={member.avatarPreset} avatarImageId={member.avatarImageId} size="sm" decorative /></span>)}
      {hiddenCount ? <span className="workspace-header__members-stack-overflow">+{hiddenCount}</span> : null}
  </span>
  </Link>;
}

/**
 * 页头更多操作只承载活动级入口，不把统计混入流水标题栏；菜单用纯文字保持轻量，关闭后仍由 Popover 将焦点还给触发按钮。
 * 统计入口把当前主页面写入路由 state，独立统计页才能在返回时恢复正确的流水或结算上下文。
 */
function ActivityActionsMenu({ activityId, tab }: { activityId: string; tab: ActivityTab }) {
  const [open, setOpen] = useState(false);
  const statisticsState = { activityStatisticsFromWorkspace: true, activityStatisticsFromTab: tab };
  const closeMenu = () => setOpen(false);

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>
      <button className="icon-button" type="button" aria-label="更多操作" title="更多操作"><MoreHorizontal aria-hidden="true" size={21} /></button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="activity-actions-popover" side="bottom" align="end" sideOffset={8}>
        <nav className="activity-actions-popover__list" aria-label="活动操作">
          <Link className="activity-actions-popover__item" to={`/activities/${encodeURIComponent(activityId)}/statistics`} state={statisticsState} onClick={closeMenu}>
            <span>活动统计</span>
          </Link>
          <Link className="activity-actions-popover__item" to={tabUrl(activityId, tab, "manage")} onClick={closeMenu}>
            <span>活动管理</span>
          </Link>
        </nav>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}

/**
 * 页头保留展开时的文档占位，只裁剪表面、移动导航，避免改变高度触发滚动锚定。
 * 封面会把额外海报高度和元信息一起收起，直接跟随实际收起距离的滚动进度；窗口监听不捕获 Sheet 内部滚动，
 * DOM 更新按帧合并，不让整个工作台随每个滚动事件重新渲染。
 */
function WorkspaceHeader({ children, busy = false, withCover = false, memberStackReady = false }: { children: ReactNode; busy?: boolean; withCover?: boolean; memberStackReady?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const location = useLocation();
  useLayoutEffect(() => {
    const header = ref.current!;
    const metadata = header.querySelector<HTMLElement>(".workspace-header__metadata")!;
    const actions = header.querySelector<HTMLElement>(".workspace-header__actions")!;
    const nav = header.querySelector<HTMLElement>(".workspace-nav")!;
    const memberStack = header.querySelector<HTMLElement>(".workspace-header__members-stack");
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
      // 用实际 bottom 位移跟随胶囊，保持头像链接的命中框和视觉位置一致，避免点击前被浏览器滚回原布局位置。
      if (memberStack) memberStack.style.setProperty("--workspace-header-member-offset", `${offset}px`);
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
  }, [location.key, busy, withCover, memberStackReady]);
  return <header ref={ref} className={`workspace-header${withCover ? " workspace-header--cover" : ""}`} aria-busy={busy || undefined}>{children}</header>;
}

/**
 * 深度阅读页面使用独立外壳，但仍复用 ActivityWorkspace 提供的活动、成员和快照上下文。
 * 返回按钮优先回到流水进入前的位置；直接打开深链时回退到该活动的流水页。
 */
function StandaloneDetailFrame({ activityId, children, pending = false, readOnly = false, title = "账单详情" }: { activityId: string; children: ReactNode; pending?: boolean; readOnly?: boolean; title?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { activityStatisticsFromFeed?: boolean; activityStatisticsFromWorkspace?: boolean; activityStatisticsFromTab?: ActivityTab; expenseDetailFromFeed?: boolean } | null;
  const statisticsReturnTab = state?.activityStatisticsFromTab === "settlement" ? "settlement" : "feed";
  const fromWorkspace = Boolean(state?.expenseDetailFromFeed || state?.activityStatisticsFromFeed || state?.activityStatisticsFromWorkspace);
  const backTab = title === "活动统计" ? statisticsReturnTab : "feed";
  const backLabel = backTab === "settlement" ? "结算" : "流水";
  const goBack = () => {
    if (fromWorkspace) navigate(-1);
    else navigate(tabUrl(activityId, backTab));
  };
  return <section className="standalone-detail-shell">
    <header className="standalone-detail-header">
      <button className="standalone-detail-header__back" type="button" aria-label={`返回${backLabel}`} onClick={goBack}><ArrowLeft aria-hidden="true" size={18} /><span>{backLabel}</span></button>
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
        <WorkspaceHeader withCover memberStackReady={membersData.length > 0}>
          <ActivityCover className="workspace-header__cover" activityId={activityData.activityId} coverPreset={activityData.coverPreset} coverImageId={activityData.coverImageId} alt="" loading="eager" />
          <div className="workspace-header__actions">
            <Link className="back-link" to="/activities" aria-label="返回活动列表"><ArrowLeft aria-hidden="true" size={20} /></Link>
            <div className="workspace-header__identity"><h1 title={activityData.name}>{activityData.name}</h1></div>
            <ActivityActionsMenu activityId={activityId} tab={tab} />
          </div>
          <div className="workspace-header__metadata">
            <p>{activityPeriodLabel(activityData) ? `${activityPeriodLabel(activityData)} · ` : null}{activityStatus(activityData.status)}</p>
          </div>
          {membersData.length ? <ActivityMemberStack activityId={activityId} tab={tab} members={membersData} /> : null}
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
