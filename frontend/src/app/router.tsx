import { FileQuestion } from "lucide-react";
import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { Brand } from "../components/brand";
import { EmptyState, LoadingState } from "../components/ui";
import { ExpenseDetailPage, ExpenseFeedPage, NewExpensePage, SettlementsPage } from "../features/accounting/pages";
import { ExpenseQueueSync } from "../features/accounting/expense-queue-sync";
import { AdminHomePage, AdminSettingsPage, AdminUsersPage } from "../features/admin/pages";
import { ActivitiesPage, ActivityWorkspace, MePage } from "../features/activities/pages";
import { useSessionQuery } from "../features/auth/api";
import { JoinPage, LoginPage, RegisterPage } from "../features/auth/pages";
import { ChangePasswordPage } from "../features/me/password-page";
import { NotificationsPage } from "../features/notifications/pages";
import { PwaUpdatePrompt } from "./pwa-update";
import { SetupPage, SetupStatusError } from "../features/setup/pages";
import { useSetupStatusQuery } from "../features/setup/api";

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
  if (status.isPending) return <LoadingState label="正在确认初始化状态…" />;
  if (status.error || !status.data) return <SetupStatusError onRetry={() => void status.refetch()} />;
  if (status.data.setupRequired) {
    return location.pathname === "/setup" ? <SetupPage /> : <Navigate to="/setup" replace />;
  }
  if (location.pathname === "/setup") return <Navigate to="/login" replace />;
  return <Outlet />;
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
  return searchParams.get("tab") === "settlement" ? <SettlementsPage /> : <ExpenseFeedPage />;
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
            <Route path="expenses/new" element={<NewExpensePage />} />
            <Route path="expenses/:expenseId" element={<ExpenseDetailPage />} />
          </Route>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/me" element={<MePage />} />
          <Route path="/me/password" element={<ChangePasswordPage />} />
          <Route element={<ProtectedAdminRoute />}>
            <Route path="/admin" element={<AdminHomePage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/settings" element={<AdminSettingsPage />} />
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
