import { FileQuestion } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { type ReactNode, lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { Brand } from "../components/brand";
import { EmptyState, LoadingState } from "../components/ui";
import { ExpenseQueueSync } from "../features/accounting/expense-queue-sync";
import { ActivitiesPage, ActivityWorkspace, MePage } from "../features/activities/pages";
import { useOnlineStatus } from "../features/activities/offline-workspace";
import { hasRememberedOfflineSession, useSessionQuery } from "../features/auth/api";
import { JoinPage, LoginPage, RegisterPage } from "../features/auth/pages";
import { PwaUpdatePrompt } from "./pwa-update";
import { PwaLaunchScreen } from "./pwa-launch-screen";
import { SetupPage, SetupStatusError } from "../features/setup/pages";
import { useSetupStatusQuery } from "../features/setup/api";

const ExpenseDetailPage = lazy(() => import("../features/accounting/pages").then((module) => ({ default: module.ExpenseDetailPage })));
const ExpenseFeedPage = lazy(() => import("../features/accounting/pages").then((module) => ({ default: module.ExpenseFeedPage })));
const NewExpensePage = lazy(() => import("../features/accounting/pages").then((module) => ({ default: module.NewExpensePage })));
const SettlementsPage = lazy(() => import("../features/accounting/pages").then((module) => ({ default: module.SettlementsPage })));
const AdminHomePage = lazy(() => import("../features/admin/pages").then((module) => ({ default: module.AdminHomePage })));
const AdminSettingsPage = lazy(() => import("../features/admin/pages").then((module) => ({ default: module.AdminSettingsPage })));
const AdminSystemInformationPage = lazy(() => import("../features/admin/pages").then((module) => ({ default: module.AdminSystemInformationPage })));
const AdminUsersPage = lazy(() => import("../features/admin/pages").then((module) => ({ default: module.AdminUsersPage })));
const ChangePasswordPage = lazy(() => import("../features/me/password-page").then((module) => ({ default: module.ChangePasswordPage })));
const NotificationsPage = lazy(() => import("../features/notifications/pages").then((module) => ({ default: module.NotificationsPage })));
const ShareSummaryPage = lazy(() => import("../features/sharing/page").then((module) => ({ default: module.ShareSummaryPage })));

function RootRedirect() {
  const session = useSessionQuery();
  if (session.isPending) return <LoadingState label="正在打开伙记…" />;
  return <Navigate to={session.data ? "/activities" : "/login"} replace />;
}

/** 初始化是全站部署前置条件；网络故障时宁可停在提示页，也不使用可能过期的产品缓存。 */
function SetupGuard() {
  const location = useLocation();
  const status = useSetupStatusQuery();
  const session = useSessionQuery();
  const online = useOnlineStatus();
  const previousOnline = useRef(online);
  useEffect(() => {
    const becameOnline = online && !previousOnline.current;
    previousOnline.current = online;
    if (becameOnline && status.error) void status.refetch();
  }, [online, status.error, status.refetch]);
  const [pwaStartupAvailable, setPwaStartupAvailable] = useState(true);
  const pwaStartupPending =
    status.isPending ||
    (status.data?.setupRequired === false && session.isPending);
  const pwaStartup =
    pwaStartupAvailable &&
    pwaStartupPending &&
    document.documentElement.classList.contains("pwa-standalone");
  useEffect(() => {
    if (!pwaStartupPending) setPwaStartupAvailable(false);
  }, [pwaStartupPending]);

  let guardedContent: ReactNode;
  if (status.isPending) {
    guardedContent = pwaStartup ? null : <LoadingState label="正在确认初始化状态…" />;
  } else if (status.error || !status.data) {
    // 离线工作台已经由当前标签页 Session 和 Snapshot 保护；只在网络错误时放行，
    // 认证失效仍会由 ProtectedRoute 清理身份，不能借缓存绕过服务端授权。
    if (online && status.error) {
      guardedContent = <LoadingState label="正在重新确认初始化状态…" />;
    } else {
      // 只有已缓存的活动深链允许在断网时跳过初始化状态探针；列表、管理等页面仍需在线确认。
      const cachedActivityDeepLink = location.pathname.startsWith("/activities/");
      guardedContent = !online && cachedActivityDeepLink && (session.data || hasRememberedOfflineSession())
        ? <Outlet />
        : <SetupStatusError onRetry={() => void status.refetch()} />;
    }
  } else if (status.data.setupRequired) {
    guardedContent = location.pathname === "/setup" ? <SetupPage /> : <Navigate to="/setup" replace />;
  } else {
    guardedContent = location.pathname === "/setup" ? <Navigate to="/login" replace /> : <Outlet />;
  }

  return (
    <>
      {pwaStartup ? null : guardedContent}
      <AnimatePresence>
        {pwaStartup ? <PwaLaunchScreen key="pwa-launch-screen" /> : null}
      </AnimatePresence>
    </>
  );
}

function ProtectedRoute() {
  const session = useSessionQuery();
  const location = useLocation();
  if (session.isPending) return <LoadingState label="正在确认登录状态…" />;
  if (!session.data) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  return <><ExpenseQueueSync userId={session.data.userId} /><Outlet /></>;
}

function ProtectedAdminRoute() {
  const session = useSessionQuery();
  const location = useLocation();
  if (session.isPending) return <LoadingState label="正在确认管理员权限…" />;
  if (!session.data) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (!session.data.isSystemAdmin) return <Navigate to="/me" replace />;
  return <Outlet />;
}

function NotFoundPage() {
  return (
    <main className="center-page">
      <Brand />
      <EmptyState icon={<FileQuestion size={30} />} title="找不到这个页面" description="链接可能已过期，或页面地址输入有误。" action={<a className="button button--primary" href="/">返回首页</a>} />
    </main>
  );
}

function ActivityPrimaryPage() {
  const [searchParams] = useSearchParams();
  const settlement = searchParams.get("tab") === "settlement";
  return (
    <Suspense fallback={<LoadingState label={settlement ? "正在打开结算…" : "正在打开流水…"} />}>
      {settlement ? <SettlementsPage /> : <ExpenseFeedPage />}
    </Suspense>
  );
}

function RoutePwaUpdatePrompt() {
  const location = useLocation();
  return location.pathname.startsWith("/share-summary/") ? null : <PwaUpdatePrompt />;
}

export function ApplicationRouter() {
  return (
    <>
      <Routes>
        <Route element={<SetupGuard />}>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/join/:token" element={<JoinPage />} />
          <Route element={<ProtectedRoute />}>
          <Route path="/activities" element={<ActivitiesPage />} />
          <Route path="/activities/:activityId" element={<ActivityWorkspace />}>
            <Route index element={<ActivityPrimaryPage />} />
            <Route path="expenses/new" element={<Suspense fallback={<LoadingState label="正在打开记账…" />}><NewExpensePage /></Suspense>} />
            <Route path="expenses/:expenseId" element={<Suspense fallback={<LoadingState label="正在打开账单…" />}><ExpenseDetailPage /></Suspense>} />
          </Route>
          <Route path="/notifications" element={<Suspense fallback={<LoadingState label="正在打开通知…" />}><NotificationsPage /></Suspense>} />
          <Route path="/me" element={<MePage />} />
          <Route path="/me/password" element={<Suspense fallback={<LoadingState label="正在打开密码设置…" />}><ChangePasswordPage /></Suspense>} />
          <Route element={<ProtectedAdminRoute />}>
            <Route path="/admin" element={<Suspense fallback={<LoadingState label="正在打开系统管理…" />}><AdminHomePage /></Suspense>} />
            <Route path="/admin/users" element={<Suspense fallback={<LoadingState label="正在打开用户管理…" />}><AdminUsersPage /></Suspense>} />
            <Route path="/admin/settings" element={<Suspense fallback={<LoadingState label="正在打开系统设置…" />}><AdminSettingsPage /></Suspense>} />
            <Route path="/admin/system" element={<Suspense fallback={<LoadingState label="正在打开系统信息…" />}><AdminSystemInformationPage /></Suspense>} />
          </Route>
            <Route path="/share-summary/:activityId" element={<Suspense fallback={<LoadingState label="正在打开结算摘要…" />}><ShareSummaryPage /></Suspense>} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <RoutePwaUpdatePrompt />
    </>
  );
}
