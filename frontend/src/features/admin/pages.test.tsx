import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  online: true,
  session: { userId: "admin-1", username: "admin", displayName: "管理员", avatarPreset: 2, isSystemAdmin: true },
  users: [{ id: "admin-1", username: "admin", displayName: "管理员", avatarPreset: 2, disabled: false, isSystemAdmin: true }, { id: "user-1", username: "alice", displayName: "Alice", avatarPreset: 5, disabled: false, isSystemAdmin: false }],
  status: { isPending: false, mutateAsync: vi.fn() },
  role: { isPending: false, mutateAsync: vi.fn() },
  reset: { isPending: false, mutateAsync: vi.fn(), variables: undefined },
  policy: { policy: "INVITE_ONLY", version: 1 },
  policyUpdate: { isPending: false, mutateAsync: vi.fn() },
}));

vi.mock("../auth/api", () => ({ useSessionQuery: () => ({ data: state.session, isPending: false }) }));
vi.mock("../activities/offline-workspace", () => ({ useOnlineStatus: () => state.online }));
vi.mock("../activities/pages", () => ({ Overlay: ({ children, title }: { children: React.ReactNode; title: string }) => <section role="dialog" aria-label={title}>{children}</section> }));
vi.mock("../../components/product-bottom-navigation", () => ({ ProductBottomNavigation: () => null }));
vi.mock("./api", () => ({
  useAdminUsersQuery: () => ({ data: state.users, isPending: false, error: null }),
  useAdminStorageQuery: () => ({ data: { databaseBytes: "1024", uploadsBytes: "2048", totalBytes: "3072" }, isPending: false, error: null }),
  useSystemInformationQuery: () => ({ data: { appVersion: "dev", pwaVersion: "dev", databaseVersion: "PostgreSQL 18.6", dataDirectory: "/data" }, isPending: false, error: null }),
  useUpdateAdminUserStatusMutation: () => state.status,
  useUpdateAdminRoleMutation: () => state.role,
  useResetAdminPasswordMutation: () => state.reset,
  useRegistrationPolicyQuery: () => ({ data: state.policy, isPending: false, error: null }),
  useUpdateRegistrationPolicyMutation: () => state.policyUpdate,
}));

import { AdminHomePage, AdminSettingsPage, AdminSystemInformationPage, AdminUsersPage } from "./pages";

afterEach(() => { cleanup(); vi.clearAllMocks(); state.online = true; });

describe("系统管理页面", () => {
  it("用户管理提供启用、管理员和重置密码操作", () => {
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alice的头像" }).querySelector("img"))
      .toHaveAttribute("src", "/member-avatars/avatar-05.webp");
    expect(screen.getByRole("button", { name: "设为管理员" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "重置密码" })[1]);
    expect(screen.getByRole("dialog", { name: "重置密码" })).toBeInTheDocument();
  });

  it("系统管理首页返回我的，二级页面返回系统管理", () => {
    const home = render(<MemoryRouter><AdminHomePage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "返回我的" })).toHaveAttribute("href", "/me");
    home.unmount();

    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "返回系统管理" })).toHaveAttribute("href", "/admin");
  });

  it("重置密码失败保留草稿", async () => {
    state.reset.mutateAsync.mockRejectedValue(new Error("重置失败"));
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: "重置密码" })[1]);
    const password = screen.getByLabelText("新密码");
    const confirmation = screen.getByLabelText("确认新密码");
    fireEvent.change(password, { target: { value: "new password value" } });
    fireEvent.change(confirmation, { target: { value: "new password value" } });
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("重置失败");
    expect(password).toHaveValue("new password value");
  });

  it("离线时不读取或执行管理写入", () => {
    state.online = false;
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("需要联网");
  });

  it("注册策略使用当前 version 提交", async () => {
    render(<MemoryRouter><AdminSettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText("开放注册"));
    await waitFor(() => expect(state.policyUpdate.mutateAsync).toHaveBeenCalledWith({ policy: "OPEN", version: 1 }));
  });

  it("系统信息页面显示存储与运行信息", () => {
    render(<MemoryRouter><AdminSystemInformationPage /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "存储使用" })).toBeInTheDocument();
    expect(screen.getByText("1 KB")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL 18.6")).toBeInTheDocument();
  });

  it("系统信息离线时不读取旧数据", () => {
    state.online = false;
    render(<MemoryRouter><AdminSystemInformationPage /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("系统信息需要联网");
  });
});
