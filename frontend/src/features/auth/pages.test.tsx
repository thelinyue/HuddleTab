import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  preview: {
    activeMemberCount: 2,
    activityId: "activity-1",
    activityName: "测试活动",
    expiresAt: "2026-09-08T00:00:00Z",
    guestDisplayName: null as string | null,
    guestMemberId: null as string | null,
    kind: "LINK",
    purpose: "JOIN",
  },
  session: { displayName: "Bob", userId: "user-2", username: "bob" } as
    | { displayName: string; userId: string; username: string }
    | undefined,
  joinRequest: undefined as undefined | { activityId: string; requestId: string; status: string },
  join: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  joinApi: vi.fn(),
  login: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  register: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  policy: { data: "OPEN" as "OPEN" | "INVITE_ONLY" | undefined, isPending: false, isFetching: false, error: null as unknown, refetch: vi.fn() },
}));

vi.mock("./api", () => ({
  useInvitationPreviewQuery: () => ({
    data: state.preview,
    isPending: false,
  }),
  useJoinInvitationMutation: () => state.join,
  joinInvitation: state.joinApi,
  useJoinRequestQuery: () => ({ data: state.joinRequest, isPending: false }),
  useLoginMutation: () => state.login,
  useRegisterMutation: () => state.register,
  useRegistrationPolicyQuery: () => state.policy,
  useSessionQuery: () => ({
    data: state.session,
    isPending: false,
  }),
}));

import { JoinPage, LoginPage, RegisterPage } from "./pages";

function renderAuth(path: string, from?: string) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: path.split("?")[0], search: path.includes("?") ? `?${path.split("?")[1]}` : "", state: from ? { from } : null }]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/join/:token" element={<JoinPage />} />
          <Route path="/activities" element={<p>活动列表</p>} />
          <Route path="/activities/:activityId" element={<p>活动工作台</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderJoin() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <MemoryRouter initialEntries={["/join/token-1"]}>
      <Routes>
        <Route path="/join/:token" element={<JoinPage />} />
        <Route path="/activities/:activityId" element={<p>活动工作台</p>} />
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  state.join.error = null;
  state.join.isPending = false;
  state.join.mutateAsync.mockReset();
  state.joinApi.mockReset();
  state.login.mutateAsync.mockReset();
  state.register.mutateAsync.mockReset();
  state.login.error = null;
  state.register.error = null;
  state.policy = { data: "OPEN", isPending: false, isFetching: false, error: null, refetch: vi.fn() };
  state.joinRequest = undefined;
  state.session = { displayName: "Bob", userId: "user-2", username: "bob" };
  state.preview = {
    activeMemberCount: 2,
    activityId: "activity-1",
    activityName: "测试活动",
    expiresAt: "2026-09-08T00:00:00Z",
    guestDisplayName: null,
    guestMemberId: null,
    kind: "LINK",
    purpose: "JOIN",
  };
});

describe("注册策略与邀请续接", () => {
  function fillRegistration() {
    fireEvent.change(screen.getByRole("textbox", { name: "昵称" }), { target: { value: "新成员" } });
    fireEvent.change(screen.getByRole("textbox", { name: "用户名" }), { target: { value: "new-user" } });
    fireEvent.change(screen.getByLabelText("密码", { exact: true }), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "注册" }));
  }

  it.each([
    ["OPEN", false, false, true],
    ["INVITE_ONLY", false, false, false],
    [undefined, true, false, false],
    ["OPEN", false, true, false],
  ] as const)("策略 %s，读取中 %s，失败 %s 时注册入口可见性为 %s", (policy, pending, failed, visible) => {
    state.session = undefined;
    state.policy.data = policy;
    state.policy.isPending = pending;
    state.policy.isFetching = pending;
    state.policy.error = failed ? new Error("策略读取失败") : null;
    renderAuth("/login");
    expect(Boolean(screen.queryByRole("link", { name: "注册新账号" }))).toBe(visible);
    expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
  });

  it("仅邀请注册的独立入口先要求口令", () => {
    state.session = undefined;
    state.policy.data = "INVITE_ONLY";
    renderAuth("/register");
    expect(screen.getByRole("textbox", { name: "邀请口令" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "昵称" })).not.toBeInTheDocument();
  });

  it("开放注册不带邀请时进入活动列表", async () => {
    state.session = undefined;
    state.register.mutateAsync.mockResolvedValue({ displayName: "新成员", userId: "user-new", username: "new-user" });
    renderAuth("/register");
    fillRegistration();
    expect(await screen.findByText("活动列表")).toBeInTheDocument();
    expect(state.register.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ invitationToken: undefined }));
    expect(state.joinApi).not.toHaveBeenCalled();
  });

  it("受邀注册需要审批时展示可恢复的申请状态", async () => {
    state.session = undefined;
    state.register.mutateAsync.mockImplementation(async () => {
      state.session = { displayName: "新成员", userId: "user-new", username: "new-user" };
      return state.session;
    });
    state.joinApi.mockResolvedValue({ activityId: "activity-1", requestId: "request-1", status: "PENDING_APPROVAL" });
    state.joinRequest = { activityId: "activity-1", requestId: "request-1", status: "PENDING" };
    renderAuth("/register?invite=token-1");
    fillRegistration();
    expect(await screen.findByText("等待活动所有者审批")).toBeInTheDocument();
    expect(state.joinApi).toHaveBeenCalledWith("token-1");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("绑定邀请注册后仍由用户确认绑定", async () => {
    state.session = undefined;
    state.preview = { ...state.preview, purpose: "GUEST_BINDING", kind: "DIRECT", guestMemberId: "guest-1" };
    state.register.mutateAsync.mockImplementation(async () => {
      state.session = { displayName: "新成员", userId: "user-new", username: "new-user" };
      return state.session;
    });
    renderAuth("/register?invite=token-1");
    fillRegistration();
    expect(await screen.findByRole("button", { name: "确认绑定" })).toBeInTheDocument();
    expect(state.joinApi).not.toHaveBeenCalled();
  });

  it("策略读取失败仍允许从有效邀请注册并自动加入", async () => {
    state.session = undefined;
    state.policy.error = new Error("策略读取失败");
    state.register.mutateAsync.mockImplementation(async () => {
      state.session = { displayName: "新成员", userId: "user-new", username: "new-user" };
      return state.session;
    });
    state.joinApi.mockResolvedValue({ activityId: "activity-1", requestId: null, status: "JOINED" });
    renderAuth("/register?invite=token-1");
    fireEvent.change(screen.getByRole("textbox", { name: "昵称" }), { target: { value: "新成员" } });
    fireEvent.change(screen.getByRole("textbox", { name: "用户名" }), { target: { value: "new-user" } });
    fireEvent.change(screen.getByLabelText("密码", { exact: true }), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    expect(await screen.findByText("活动工作台")).toBeInTheDocument();
    expect(state.register.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ invitationToken: "token-1" }));
    expect(state.joinApi).toHaveBeenCalledWith("token-1");
  });

  it("注册成功但加入失败时保留账号和重试入口", async () => {
    state.session = undefined;
    state.register.mutateAsync.mockImplementation(async () => {
      state.session = { displayName: "新成员", userId: "user-new", username: "new-user" };
      return state.session;
    });
    state.joinApi.mockRejectedValue(new Error("加入暂时失败"));
    renderAuth("/register?invite=token-1");
    fireEvent.change(screen.getByRole("textbox", { name: "昵称" }), { target: { value: "新成员" } });
    fireEvent.change(screen.getByRole("textbox", { name: "用户名" }), { target: { value: "new-user" } });
    fireEvent.change(screen.getByLabelText("密码", { exact: true }), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    expect(await screen.findByText(/账号已创建，但未能加入活动/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加入活动" })).toBeInTheDocument();
    state.join.mutateAsync.mockResolvedValue({ activityId: "activity-1", requestId: null, status: "JOINED" });
    fireEvent.click(screen.getByRole("button", { name: "加入活动" }));
    expect(await screen.findByText("活动工作台")).toBeInTheDocument();
  });

  it("已有会话打开登录页仍返回原邀请", async () => {
    renderAuth("/login", "/join/token-1");
    expect(await screen.findByRole("button", { name: "加入活动" })).toBeInTheDocument();
  });

  it("已有账号登录后返回原邀请", async () => {
    state.session = undefined;
    state.login.mutateAsync.mockImplementation(async () => {
      state.session = { displayName: "已有成员", userId: "user-old", username: "old-user" };
      return state.session;
    });
    renderAuth("/login", "/join/token-1");
    fireEvent.change(screen.getByRole("textbox", { name: "用户名" }), { target: { value: "old-user" } });
    fireEvent.change(screen.getByLabelText("密码", { exact: true }), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("button", { name: "加入活动" })).toBeInTheDocument();
  });
});

describe("JoinPage Guest Binding", () => {
  function useBindingPreview() {
    state.preview = {
      ...state.preview,
      guestDisplayName: "临时成员",
      guestMemberId: "guest-1",
      kind: "DIRECT",
      purpose: "GUEST_BINDING",
    };
  }

  it.each(["BOUND", "ALREADY_BOUND"])("%s 后打开原活动", async (status) => {
    useBindingPreview();
    state.join.mutateAsync.mockResolvedValue({
      activityId: "activity-1",
      memberId: "guest-1",
      requestId: null,
      revision: "4",
      status,
    });
    renderJoin();

    expect(screen.getByText("绑定临时成员身份")).toBeInTheDocument();
    expect(screen.getByText("临时成员")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认绑定" }));
    expect(await screen.findByText("活动工作台")).toBeInTheDocument();
  });

  it("未登录时提供注册后确认绑定和登录入口", () => {
    useBindingPreview();
    state.session = undefined;
    renderJoin();

    expect(screen.getByRole("link", { name: "注册后确认绑定" })).toHaveAttribute(
      "href",
      "/register?invite=token-1",
    );
    expect(screen.getByRole("link", { name: "登录" })).toBeInTheDocument();
  });

  it("确认失败时保留绑定上下文", async () => {
    useBindingPreview();
    state.join.mutateAsync.mockRejectedValue(new Error("绑定失败"));
    const view = renderJoin();
    fireEvent.click(screen.getByRole("button", { name: "确认绑定" }));
    await waitFor(() => expect(state.join.mutateAsync).toHaveBeenCalledOnce());
    state.join.error = new Error("绑定失败");
    view.rerender(
      <MemoryRouter initialEntries={["/join/token-1"]}>
        <Routes>
          <Route path="/join/:token" element={<JoinPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("绑定失败");
    expect(screen.getByText("绑定临时成员身份")).toBeInTheDocument();
    expect(screen.getByText("临时成员")).toBeInTheDocument();
  });
});

describe("JoinPage approval states", () => {
  it("有效期使用可读日期，异常日期不泄露 Invalid Date", () => {
    const view = renderJoin();
    expect(screen.getByText("邀请有效期至 2026/9/8")).toBeInTheDocument();
    view.unmount();
    state.preview.expiresAt = "invalid";
    renderJoin();
    expect(screen.getByText("有效期暂无法显示")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  it("匿名邀请保留携带口令的注册入口", () => {
    state.session = undefined;
    renderJoin();
    expect(screen.getByRole("link", { name: "注册并加入" })).toHaveAttribute("href", "/register?invite=token-1");
    expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute("href", "/login");
  });

  it("审批状态保留统一的中文品牌入口", async () => {
    const { container } = renderJoin();
    const brand = screen.getByRole("link", { name: "伙记首页" });
    expect(brand.querySelector('img[src="/icons/icon-192.png"]')).toHaveAttribute("alt", "");
    expect(screen.getByText("伙记")).toBeInTheDocument();
    expect(screen.queryByText("HuddleTab")).not.toBeInTheDocument();

    state.join.mutateAsync.mockResolvedValue({
      activityId: "activity-1",
      memberId: null,
      requestId: "request-1",
      revision: "3",
      status: "PENDING_APPROVAL",
    });
    state.joinRequest = { activityId: "activity-1", requestId: "request-1", status: "PENDING" };
    fireEvent.click(screen.getByRole("button", { name: /加入活动/ }));

    expect(await screen.findByText("等待活动所有者审批")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "伙记首页" })).toBe(brand);
    expect(container.querySelector(".account-card")).toContainElement(screen.getByText("等待活动所有者审批"));
  });

  it("Pending 留在邀请页并显示等待审批", async () => {
    state.join.mutateAsync.mockResolvedValue({
      activityId: "activity-1",
      memberId: null,
      requestId: "request-1",
      revision: "3",
      status: "PENDING_APPROVAL",
    });
    state.joinRequest = {
      activityId: "activity-1",
      requestId: "request-1",
      status: "PENDING",
    };
    renderJoin();

    fireEvent.click(screen.getByRole("button", { name: /加入活动/ }));
    expect(await screen.findByText("等待活动所有者审批")).toBeInTheDocument();
    expect(screen.queryByText("活动工作台")).not.toBeInTheDocument();
  });

  it.each([
    ["APPROVED", "申请已批准", true],
    ["REJECTED", "申请未通过", false],
    ["INVALIDATED", "邀请已作废", false],
  ])("%s 显示明确结果", async (status, label, hasLink) => {
    state.join.mutateAsync.mockResolvedValue({
      activityId: "activity-1",
      memberId: null,
      requestId: "request-1",
      revision: "4",
      status: "PENDING_APPROVAL",
    });
    state.joinRequest = { activityId: "activity-1", requestId: "request-1", status };
    renderJoin();

    fireEvent.click(screen.getByRole("button", { name: /加入活动/ }));
    expect(await screen.findByText(label)).toBeInTheDocument();
    await waitFor(() => {
      if (hasLink) {
        expect(screen.getByRole("link", { name: "打开活动" })).toHaveAttribute(
          "href",
          "/activities/activity-1",
        );
      } else {
        expect(screen.queryByRole("link", { name: "打开活动" })).not.toBeInTheDocument();
      }
    });
  });
});
