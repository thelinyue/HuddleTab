import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/error";

const state = vi.hoisted(() => ({
  online: true,
  usersError: null as unknown,
  usersPending: false,
  refetchUsers: vi.fn(),
  session: { userId: "admin-1", username: "admin", displayName: "管理员", avatarPreset: 2, isSystemAdmin: true },
  users: [{ id: "admin-1", username: "admin", displayName: "管理员", avatarPreset: 2, disabled: false, isSystemAdmin: true }, { id: "user-1", username: "alice", displayName: "Alice", avatarPreset: 5, disabled: false, isSystemAdmin: false }],
  status: { isPending: false, mutateAsync: vi.fn() },
  role: { isPending: false, mutateAsync: vi.fn() },
  reset: { isPending: false, mutateAsync: vi.fn(), variables: undefined },
  remove: { isPending: false, mutateAsync: vi.fn() },
  policy: { policy: "INVITE_ONLY", version: 1 },
  policyUpdate: { isPending: false, mutateAsync: vi.fn() },
}));

vi.mock("../auth/api", () => ({ useSessionQuery: () => ({ data: state.session, isPending: false }) }));
vi.mock("../activities/offline-workspace", () => ({ useOnlineStatus: () => state.online }));
vi.mock("../../components/product-bottom-navigation", () => ({ ProductBottomNavigation: () => null }));
vi.mock("./api", () => ({
  useAdminUsersQuery: () => ({ data: state.users, isPending: state.usersPending, error: state.usersError, refetch: state.refetchUsers }),
  useAdminStorageQuery: () => ({ data: { databaseBytes: "1024", uploadsBytes: "2048", totalBytes: "3072" }, isPending: false, error: null }),
  useSystemInformationQuery: () => ({ data: { appVersion: "dev", pwaVersion: "dev", databaseVersion: "PostgreSQL 18.6", dataDirectory: "/data" }, isPending: false, error: null }),
  useUpdateAdminUserStatusMutation: () => state.status,
  useUpdateAdminRoleMutation: () => state.role,
  useResetAdminPasswordMutation: () => state.reset,
  useDeleteAdminUserMutation: () => state.remove,
  useRegistrationPolicyQuery: () => ({ data: state.policy, isPending: false, error: null }),
  useUpdateRegistrationPolicyMutation: () => state.policyUpdate,
}));

import { AdminHomePage, AdminSettingsPage, AdminSystemInformationPage, AdminUsersPage } from "./pages";

afterEach(() => { cleanup(); vi.clearAllMocks(); state.online = true; state.usersError = null; state.usersPending = false; state.status.isPending = false; state.role.isPending = false; state.reset.isPending = false; state.status.mutateAsync.mockReset(); state.role.mutateAsync.mockReset(); state.reset.mutateAsync.mockReset(); state.users = [{ id: "admin-1", username: "admin", displayName: "管理员", avatarPreset: 2, disabled: false, isSystemAdmin: true }, { id: "user-1", username: "alice", displayName: "Alice", avatarPreset: 5, disabled: false, isSystemAdmin: false }]; });

describe("系统管理页面", () => {
  afterEach(() => { state.remove.isPending = false; state.remove.mutateAsync.mockReset(); });

  it.each([false, true])("空账号删除确认、取消、成功后保留搜索并恢复焦点（禁用=%s）", async (disabled) => {
    state.users[1].disabled = disabled;
    state.remove.mutateAsync.mockImplementation(async () => { state.users = state.users.filter((user) => user.id !== "user-1"); });
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: /管理用户 Alice/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除账号" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Alice（@alice）");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("删除后无法恢复");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("原用户名可重新注册");
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(state.remove.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "删除账号" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除账号" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(state.remove.mutateAsync).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(screen.getByText("账号已删除。")).toHaveAttribute("role", "status");
    expect(search).toHaveValue("alice");
    expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: "全部 0" })).toBeInTheDocument();
    expect(state.status.mutateAsync).not.toHaveBeenCalled();
  });

  it("有历史时保留确认弹窗、账号及错误，可重试且不自动禁用", async () => {
    state.remove.mutateAsync.mockRejectedValueOnce(new ApiRequestError(409, { error: { code: "USER_HAS_BUSINESS_RECORDS", message: "该账号存在业务或历史记录，无法删除，请使用禁用账号。", requestId: "test", fieldErrors: {}, details: {} } }));
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /管理用户 Alice/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除账号" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除账号" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请使用禁用账号");
    expect(screen.getByRole("alertdialog")).toContainElement(screen.getByRole("alert"));
    expect(screen.getByRole("button", { name: /管理用户 Alice/ })).toBeInTheDocument();
    expect(state.status.mutateAsync).not.toHaveBeenCalled();
    state.remove.mutateAsync.mockImplementationOnce(async () => { state.users = state.users.filter((user) => user.id !== "user-1"); });
    fireEvent.click(screen.getByRole("button", { name: "确认删除账号" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(state.remove.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("删除提交期间禁止重复提交和关闭，并提示自身删除将退出", async () => {
    let finish!: () => void;
    state.remove.mutateAsync.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /管理用户 管理员/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除账号" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("操作成功后你将退出登录");
    const confirm = screen.getByRole("button", { name: "确认删除账号" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(state.remove.mutateAsync).toHaveBeenCalledExactlyOnceWith("admin-1");
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    finish();
    await waitFor(() => expect(confirm).not.toBeDisabled());
  });

  it("用户管理提供启用、管理员和重置密码操作", () => {
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alice的头像" }).querySelector("img"))
      .toHaveAttribute("src", "/member-avatars/avatar-05.webp");
    expect(screen.queryByRole("button", { name: "设为管理员" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "管理用户 Alice @alice" }));
    expect(screen.getByRole("button", { name: "设为管理员" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    expect(screen.getByRole("dialog", { name: "重置密码" })).toBeInTheDocument();
  });

  it("系统管理首页返回我的，二级页面返回系统管理", () => {
    const home = render(<MemoryRouter><AdminHomePage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "返回我的" })).toHaveAttribute("href", "/me");
    expect(screen.getByRole("link", { name: "AI 智能录入" })).toHaveAttribute("href", "/admin/ai");
    home.unmount();

    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "返回系统管理" })).toHaveAttribute("href", "/admin");
  });

  it("重置密码失败保留草稿", async () => {
    state.reset.mutateAsync.mockRejectedValue(new Error("重置失败"));
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "管理用户 Alice @alice" }));
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
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

  it("筛选计数基于搜索结果，管理员与已禁用可以交叉且不受选中分类限制", () => {
    state.users.push({ id: "disabled-admin", username: "alice-admin", displayName: "停用管理员", avatarPreset: 1, disabled: true, isSystemAdmin: true });
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "全部 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "管理员 2" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  ALICE  " } });
    expect(screen.getByRole("button", { name: "全部 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "管理员 1" }));
    expect(within(screen.getByRole("list", { name: "用户列表" })).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "正常 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已禁用 1" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "不存在" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有找到匹配的用户");
    fireEvent.click(screen.getByRole("button", { name: "清除搜索与筛选" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "全部 3" })).toHaveAttribute("aria-pressed", "true");
  });

  it("禁用先确认，取消不写入，服务端拒绝保留原位错误并允许重试", async () => {
    state.status.mutateAsync.mockRejectedValueOnce(new ApiRequestError(409, { error: { code: "LAST_ACTIVE_ADMIN", message: "至少保留一位可登录的系统管理员。", requestId: "test", fieldErrors: {}, details: {} } })).mockResolvedValueOnce({});
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /管理用户 管理员/ }));
    fireEvent.click(screen.getByRole("button", { name: "禁用账号" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("你将退出登录");
    expect(state.status.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(state.status.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "禁用账号" }));
    fireEvent.click(screen.getByRole("button", { name: "确认禁用账号" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("至少保留一位");
    expect(screen.getByRole("alertdialog")).toContainElement(screen.getByRole("alert"));
    fireEvent.click(screen.getByRole("button", { name: "确认禁用账号" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(state.status.mutateAsync).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("账号已禁用");
  });

  it("权限操作在确认后提交，处理中禁止重复提交", async () => {
    let finish!: () => void;
    state.role.mutateAsync.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "管理用户 Alice @alice" }));
    fireEvent.click(screen.getByRole("button", { name: "设为管理员" }));
    expect(state.role.mutateAsync).not.toHaveBeenCalled();
    const submit = screen.getByRole("button", { name: "确认设为管理员" });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(state.role.mutateAsync).toHaveBeenCalledExactlyOnceWith({ userId: "user-1", granted: true });
    finish();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("面板按 ID 跟随最新数据，启用后同步状态与计数", async () => {
    state.users[1].disabled = true;
    state.status.mutateAsync.mockImplementation(async () => { state.users = state.users.map((user) => user.id === "user-1" ? { ...user, disabled: false } : user); });
    const page = render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /管理用户 Alice/ }));
    fireEvent.click(screen.getByRole("button", { name: "启用账号" }));
    await waitFor(() => expect(state.status.mutateAsync).toHaveBeenCalledWith({ userId: "user-1", disabled: false }));
    page.rerender(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "已禁用 0" })).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByText("正常")).toBeInTheDocument();
  });

  it("离开密码子表单清空草稿和错误，重置成功返回管理面板", async () => {
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "管理用户 Alice @alice" }));
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "different-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "another-password" } });
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    expect(screen.getByRole("alert")).toHaveTextContent("不一致");
    fireEvent.click(screen.getByRole("button", { name: "返回管理用户" }));
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    expect(screen.getByLabelText("新密码")).toHaveValue("");
    expect(screen.getByLabelText("确认新密码")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "valid-password" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "valid-password" } });
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "管理用户" })).toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("密码已重置");
  });

  it("已有数据刷新失败时保留列表并提供重试", () => {
    state.usersError = new Error("读取失败");
    render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "管理用户 Alice @alice" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新读取用户" }));
    expect(state.refetchUsers).toHaveBeenCalledOnce();
  });

  it("注册策略使用当前 version 提交", async () => {
    render(<MemoryRouter><AdminSettingsPage /></MemoryRouter>);
    fireEvent.click(screen.getByLabelText("开放注册"));
    await waitFor(() => expect(state.policyUpdate.mutateAsync).toHaveBeenCalledWith({ policy: "OPEN", version: 1 }));
  });

  it("系统信息页面显示存储与运行信息", () => {
    render(<MemoryRouter><AdminSystemInformationPage /></MemoryRouter>);
    expect(screen.getByRole("region", { name: "存储使用" })).toBeInTheDocument();
    expect(screen.getByText("1 KB")).toBeInTheDocument();
    expect(screen.getByText("PostgreSQL 18.6")).toBeInTheDocument();
  });

  it("系统信息离线时不读取旧数据", () => {
    state.online = false;
    render(<MemoryRouter><AdminSystemInformationPage /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("系统信息需要联网");
  });
});
