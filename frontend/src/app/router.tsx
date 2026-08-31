import { FileQuestion } from "lucide-react";
import { Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { Brand } from "../components/brand";
import { EmptyState, LoadingState } from "../components/ui";
import { ExpenseDetailPage, ExpenseFeedPage, NewExpensePage, SettlementsPage } from "../features/accounting/pages";
import { ActivitiesPage, ActivityWorkspace, MePage, NotificationsPage } from "../features/activities/pages";
import { useSessionQuery } from "../features/auth/api";
import { JoinPage, LoginPage, RegisterPage } from "../features/auth/pages";
import { ChangePasswordPage } from "../features/me/password-page";
import { PwaUpdatePrompt } from "./pwa-update";

function RootRedirect() {
  const session = useSessionQuery();
  if (session.isPending) return <LoadingState label="正在打开伙记…" />;
  return <Navigate to={session.data ? "/activities" : "/login"} replace />;
}

function ProtectedRoute() {
  const session = useSessionQuery();
  const location = useLocation();
  if (session.isPending) return <LoadingState label="正在确认登录状态…" />;
  if (!session.data) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
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

export function ApplicationRouter() {
  return (
    <>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
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
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <PwaUpdatePrompt />
    </>
  );
}
