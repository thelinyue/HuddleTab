import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationRouter } from "./router";

const authState = vi.hoisted((): {
  data?: { userId: string; username: string; displayName: string };
} => ({
  data: { userId: "user-1", username: "tester", displayName: "测试用户" },
}));

vi.mock("../features/auth/api", () => ({
  useSessionQuery: () => ({ isPending: false, data: authState.data }),
  useChangePasswordMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("../features/auth/pages", () => ({
  JoinPage: () => null,
  LoginPage: () => <p>登录页</p>,
  RegisterPage: () => null,
}));

vi.mock("../features/activities/pages", async () => {
  const { Outlet } = await import("react-router-dom");
  return {
    ActivitiesPage: () => <p>活动列表</p>,
    ActivityWorkspace: () => <Outlet />,
    MePage: () => <p>我的</p>,
    NotificationsPage: () => <p>通知</p>,
  };
});

vi.mock("../features/accounting/pages", () => ({
  ExpenseDetailPage: () => <p>账单详情</p>,
  ExpenseFeedPage: () => <p>流水页</p>,
  NewExpensePage: () => <p>新增账单</p>,
  SettlementsPage: () => <p>结算页</p>,
}));

vi.mock("../features/sharing/page", () => ({ ShareSummaryPage: () => <h1>结算分享摘要</h1> }));

vi.mock("./pwa-update", () => ({ PwaUpdatePrompt: () => <p>PWA 更新提示</p> }));

afterEach(() => {
  cleanup();
  authState.data = { userId: "user-1", username: "tester", displayName: "测试用户" };
});

describe("ApplicationRouter", () => {
  it("已登录用户可打开独立的分享摘要页，且不渲染 PWA 提示", async () => {
    render(<MemoryRouter initialEntries={["/share-summary/activity-1"]}><ApplicationRouter /></MemoryRouter>);

    expect(await screen.findByRole("heading", { name: "结算分享摘要" })).toBeInTheDocument();
    expect(screen.queryByLabelText("主导航")).not.toBeInTheDocument();
    expect(screen.queryByText("PWA 更新提示")).not.toBeInTheDocument();
  });

  it("通过 tab query 在同一活动地址打开结算主视图", () => {
    render(<MemoryRouter initialEntries={["/activities/activity-1?tab=settlement"]}><ApplicationRouter /></MemoryRouter>);
    expect(screen.getByText("结算页")).toBeInTheDocument();
    expect(screen.queryByText("流水页")).not.toBeInTheDocument();
  });

  it("已登录用户可以直接打开修改密码二级页", () => {
    render(<MemoryRouter initialEntries={["/me/password"]}><ApplicationRouter /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "修改密码" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "找不到这个页面" })).not.toBeInTheDocument();
  });

  it("未登录用户打开修改密码页时跳转登录", async () => {
    authState.data = undefined;
    render(<MemoryRouter initialEntries={["/me/password"]}><ApplicationRouter /></MemoryRouter>);

    expect(await screen.findByText("登录页")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "修改密码" })).not.toBeInTheDocument();
  });

  it("未登录用户打开分享摘要页时跳转登录", async () => {
    authState.data = undefined;
    render(<MemoryRouter initialEntries={["/share-summary/activity-1"]}><ApplicationRouter /></MemoryRouter>);

    expect(await screen.findByText("登录页")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "结算分享摘要" })).not.toBeInTheDocument();
  });
});
