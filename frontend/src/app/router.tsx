import { retryableLazy } from "../components/retryable-lazy";
import { AccountingSkeleton } from "../features/accounting/skeleton";
import { FileQuestion } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { Brand } from "../components/brand";
import { EmptyState, LoadingState, StateIllustration } from "../components/ui";
import { ExpenseQueueSync } from "../features/accounting/expense-queue-sync";
import { ActivitiesPage } from "../features/activities/activities-page";
import { ActivityWorkspace } from "../features/activities/activity-workspace";
import { MePage } from "../features/me/page";
import { useSessionQuery } from "../features/auth/api";
import { JoinPage, LoginPage, RegisterPage } from "../features/auth/pages";
import { PwaUpdatePrompt } from "./pwa-update";
import { PwaLaunchScreen } from "./pwa-launch-screen";

const ExpenseDetailPage = retryableLazy(() => import("../features/accounting/expense-editor").then((module) => ({ default: module.ExpenseDetailPage })));
const ExpenseFeedPage = retryableLazy(() => import("../features/accounting/feed-page").then((module) => ({ default: module.ExpenseFeedPage })), <AccountingSkeleton />);
const NewExpensePage = retryableLazy(() => import("../features/accounting/expense-editor").then((module) => ({ default: module.NewExpensePage })));
const SettlementsPage = retryableLazy(() => import("../features/accounting/settlement-page").then((module) => ({ default: module.SettlementsPage })), <AccountingSkeleton kind="settlement" />);
const AdminHomePage = lazy(() => import("../features/admin/pages").then((module) => ({ default: module.AdminHomePage })));
const AdminSettingsPage = lazy(() => import("../features/admin/pages").then((module) => ({ default: module.AdminSettingsPage })));
const AdminSystemInformationPage = lazy(() => import("../features/admin/pages").then((module) => ({ default: module.AdminSystemInformationPage })));
const AdminUsersPage = lazy(() => import("../features/admin/pages").then((module) => ({ default: module.AdminUsersPage })));
const ChangeUsernamePage = lazy(() => import("../features/me/username-page").then((module) => ({ default: module.ChangeUsernamePage })));
const ChangePasswordPage = lazy(() => import("../features/me/password-page").then((module) => ({ default: module.ChangePasswordPage })));
const NotificationsPage = lazy(() => import("../features/notifications/pages").then((module) => ({ default: module.NotificationsPage })));
const ShareSummaryPage = lazy(() => import("../features/sharing/page").then((module) => ({ default: module.ShareSummaryPage })));

function RootRedirect() {
  const session = useSessionQuery();
  if (session.isPending) return <LoadingState label="正在打开伙记…" />;
  return <Navigate to={session.data ? "/activities" : "/login"} replace />;
}

/** PWA 启动层只等待首次 Session 查询；后续刷新不重复播放，也不阻塞离线身份恢复。 */
function SessionLaunch() {
  const session = useSessionQuery();
  const [startupAvailable, setStartupAvailable] = useState(true);
  const showLaunch = startupAvailable && session.isPending && document.documentElement.classList.contains("pwa-standalone");
  useEffect(() => {
    if (!session.isPending) setStartupAvailable(false);
  }, [session.isPending]);
  return <>{showLaunch ? null : <Outlet />}<AnimatePresence>{showLaunch ? <PwaLaunchScreen key="pwa-launch-screen" /> : null}</AnimatePresence></>;
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
      <EmptyState icon={<FileQuestion size={30} />} visual={<StateIllustration src="/illustrations/not-found.webp" loading="eager" />} title="找不到这个页面" description="链接可能已过期，或页面地址输入有误。" action={<a className="button button--primary" href="/">返回首页</a>} />
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
        <Route element={<SessionLaunch />}>
          <Route path="/" element={<RootRedirect />} />
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
          <Route path="/me/username" element={<Suspense fallback={<LoadingState label="正在打开用户名设置…" />}><ChangeUsernamePage /></Suspense>} />
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
