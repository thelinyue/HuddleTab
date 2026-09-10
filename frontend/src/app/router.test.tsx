import "fake-indexeddb/auto";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationRouter } from "./router";

const authState = vi.hoisted((): {
  data?: { userId: string; username: string; displayName: string };
  isPending: boolean;
} => ({
  data: { userId: "user-1", username: "tester", displayName: "测试用户" },
  isPending: false,
}));

vi.mock("../features/auth/api", () => ({
  useSessionQuery: () => ({ isPending: authState.isPending, data: authState.data }),
  useChangePasswordMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("../features/auth/pages", () => ({
  JoinPage: () => null,
  LoginPage: () => <p>登录页</p>,
  RegisterPage: () => null,
}));



vi.mock("../features/me/page", () => ({ MePage: () => <p>我的</p> }));

vi.mock("../features/activities/activities-page", () => ({ ActivitiesPage: () => <p>活动列表</p> }));
vi.mock("../features/activities/activity-workspace", async () => {
  const { Outlet } = await import("react-router-dom");
  return { ActivityWorkspace: () => <Outlet /> };
});

vi.mock("../features/notifications/pages", () => ({
  NotificationsPage: () => <p>通知</p>,
}));

vi.mock("../features/accounting/feed-page", () => ({ ExpenseFeedPage: () => <p>流水页</p> }));
vi.mock("../features/accounting/settlement-page", () => ({ SettlementsPage: () => <p>结算页</p> }));
vi.mock("../features/accounting/expense-editor", () => ({ ExpenseDetailPage: () => <p>账单详情</p>, NewExpensePage: () => <p>记账页</p> }));

vi.mock("../features/sharing/page", () => ({ ShareSummaryPage: () => <h1>结算分享摘要</h1> }));

vi.mock("./pwa-update", () => ({ PwaUpdatePrompt: () => <p>PWA 更新提示</p> }));

function renderRoute(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renderApplication = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}><ApplicationRouter /></MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(renderApplication());
  return Object.assign(result, {
    rerenderApplication: () => result.rerender(renderApplication()),
  });
}

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("pwa-standalone");
  authState.isPending = false;
  authState.data = { userId: "user-1", username: "tester", displayName: "测试用户" };
});

describe("ApplicationRouter", () => {
  it("已登录用户可打开独立的分享摘要页，且不渲染 PWA 提示", async () => {
    renderRoute("/share-summary/activity-1");

    expect(await screen.findByRole("heading", { name: "结算分享摘要" })).toBeInTheDocument();
    expect(screen.queryByLabelText("主导航")).not.toBeInTheDocument();
    expect(screen.queryByText("PWA 更新提示")).not.toBeInTheDocument();
  });

  it("通过 tab query 在同一活动地址打开结算主视图", async () => {
    renderRoute("/activities/activity-1?tab=settlement");
    expect(await screen.findByText("结算页")).toBeInTheDocument();
    expect(screen.queryByText("流水页")).not.toBeInTheDocument();
  });

  it("已登录用户可打开通知页", async () => {
    renderRoute("/notifications");
    expect(await screen.findByText("通知")).toBeInTheDocument();
  });

  it("已登录用户可以直接打开修改密码二级页", async () => {
    renderRoute("/me/password");
    expect(await screen.findByRole("heading", { name: "修改密码" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "找不到这个页面" })).not.toBeInTheDocument();
  });

  it("未登录用户打开修改密码页时跳转登录", async () => {
    authState.data = undefined;
    renderRoute("/me/password");

    expect(await screen.findByText("登录页")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "修改密码" })).not.toBeInTheDocument();
  });

  it("未登录用户打开分享摘要页时跳转登录", async () => {
    authState.data = undefined;
    renderRoute("/share-summary/activity-1");

    expect(await screen.findByText("登录页")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "结算分享摘要" })).not.toBeInTheDocument();
  });

  it("已移除初始化页", async () => {
    const { container } = renderRoute("/setup");
    expect(await screen.findByRole("heading", { name: "找不到这个页面" })).toBeInTheDocument();
    const illustration = container.querySelector('img[src="/illustrations/not-found.webp"]');
    expect(illustration).toHaveAttribute("alt", "");
    expect(illustration).toHaveAttribute("aria-hidden", "true");
  });

  it("独立 PWA 等待登录状态时显示品牌启动层", () => {
    document.documentElement.classList.add("pwa-standalone");

    authState.isPending = true;
    renderRoute("/activities");

    expect(screen.getByRole("status", { name: "正在准备伙记" })).toBeInTheDocument();
    expect(screen.queryByText("正在确认登录状态…")).not.toBeInTheDocument();
  });

  it("独立 PWA 在登录态仍在确认时继续显示品牌启动层", () => {
    document.documentElement.classList.add("pwa-standalone");
    authState.isPending = true;

    renderRoute("/activities");

    expect(screen.getByRole("status", { name: "正在准备伙记" })).toBeInTheDocument();
    expect(screen.queryByText("正在确认登录状态…")).not.toBeInTheDocument();
  });

  it("普通浏览器等待登录状态时保留原有加载提示", () => {
    authState.isPending = true;

    renderRoute("/activities");

    expect(screen.getByText("正在确认登录状态…")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "正在准备伙记" })).not.toBeInTheDocument();
  });

  it("同一文档后续重新等待登录状态时不重复播放启动层", async () => {
    document.documentElement.classList.add("pwa-standalone");
    authState.isPending = true;
    const rendered = renderRoute("/activities");

    expect(screen.getByRole("status", { name: "正在准备伙记" })).toBeInTheDocument();

    authState.isPending = false;
    act(() => rendered.rerenderApplication());
    await waitFor(() => expect(screen.queryByRole("status", { name: "正在准备伙记" })).not.toBeInTheDocument());

    authState.isPending = true;
    act(() => rendered.rerenderApplication());
    expect(screen.queryByRole("status", { name: "正在准备伙记" })).not.toBeInTheDocument();
  });
});
