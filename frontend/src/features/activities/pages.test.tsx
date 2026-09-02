import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const activityApiState = vi.hoisted(() => ({
  activity: {
    activityId: "activity-1",
    allowedLifecycleActions: ["END"],
    baseCurrency: "CNY",
    canDelete: true,
    canRestore: false,
    currentMemberId: "member-owner",
    currentMemberRole: "OWNER",
    deletedAt: null as string | null,
    endDate: null as string | null,
    fieldPermissions: { baseCurrency: false, endDate: true, inviteMode: true, location: true, name: true, startDate: true },
    hasAccountingRecords: true,
    location: "杭州",
    inviteMode: "DIRECT_JOIN",
    name: "测试活动",
    ownerMemberId: "member-owner",
    purgeAfter: null as string | null,
    revision: "1",
    startDate: "2026-09-01",
    status: "ACTIVE",
    version: "7",
  },
  activities: [] as Array<Record<string, unknown>>,
  deletedActivities: [] as Array<Record<string, unknown>>,
  deletedQueryEnabled: [] as boolean[],
  deletedQueryError: null as unknown,
  deletedQueryPending: false,
  create: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  update: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  lifecycle: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  remove: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  restore: { error: null as unknown, isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() },
  invitationQueryEnabled: [] as boolean[],
  members: [
    {
      activityId: "activity-1",
      displayName: "测试用户",
      memberId: "member-owner",
      role: "OWNER",
      status: "ACTIVE",
      userId: "user-1",
      version: "1",
    },
    {
      activityId: "activity-1",
      displayName: "临时成员",
      memberId: "guest-1",
      role: "MEMBER",
      status: "ACTIVE",
      userId: null,
      version: "1",
    },
  ],
  invitations: [] as Array<{
    activityId: string;
    expiresAt: string;
    guestMemberId?: string | null;
    invitationId: string;
    kind: string;
    maxUses: number | null;
    purpose?: string;
    revision: string;
    revokedAt: string | null;
    targetUsername: string | null;
    useCount: number;
    version: string;
  }>,
  joinQueryEnabled: [] as boolean[],
  joinRequests: [] as Array<Record<string, unknown>>,
  createGuestBinding: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  decideJoinRequest: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
}));

vi.mock("../accounting/api", () => ({
  useActivityLedgersQuery: () => [],
}));

vi.mock("../auth/api", () => ({
  useLogoutMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useSessionQuery: () => ({
    data: { displayName: "测试用户", userId: "user-1", username: "tester" },
    isPending: false,
  }),
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    useActivitiesQuery: () => ({ data: activityApiState.activities, isPending: false }),
    useDeletedActivitiesQuery: (_userId: string, enabled = true) => {
      activityApiState.deletedQueryEnabled.push(enabled);
      return {
        data: activityApiState.deletedActivities,
        error: activityApiState.deletedQueryError,
        isPending: activityApiState.deletedQueryPending,
      };
    },
    useActivityQuery: () => ({ data: activityApiState.activity, isPending: false }),
    useCreateActivityMutation: () => activityApiState.create,
    useUpdateActivityMutation: () => activityApiState.update,
    useActivityLifecycleMutation: () => activityApiState.lifecycle,
    useDeleteActivityMutation: () => activityApiState.remove,
    useRestoreActivityMutation: () => activityApiState.restore,
    useMembersQuery: () => ({ data: activityApiState.members, isPending: false }),
    useInvitationsQuery: (_userId: string, _activityId: string, enabled: boolean) => {
      activityApiState.invitationQueryEnabled.push(enabled);
      return { data: activityApiState.invitations, isPending: false };
    },
    useCreateGuestMutation: () => ({ error: null, isPending: false, mutateAsync: vi.fn() }),
    useCreateInvitationMutation: () => ({ error: null, isPending: false, mutateAsync: vi.fn() }),
    useCreateGuestBindingInvitationMutation: () => activityApiState.createGuestBinding,
    useRevokeInvitationMutation: () => ({ isPending: false, mutate: vi.fn() }),
    useJoinRequestsQuery: (_userId: string, _activityId: string, enabled: boolean) => {
      activityApiState.joinQueryEnabled.push(enabled);
      return { data: activityApiState.joinRequests, isPending: false };
    },
    useDecideJoinRequestMutation: () => activityApiState.decideJoinRequest,
  };
});

import { ActivitiesPage, ActivityWorkspace, MemberInvitationPanel, MePage } from "./pages";

function renderWorkspace(entry = "/activities/activity-1?panel=members") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/activities/:activityId" element={<ActivityWorkspace />} />
        <Route path="/activities" element={<p>活动列表页</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderActivitiesPage() {
  return render(<MemoryRouter initialEntries={["/activities"]}><ActivitiesPage /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  activityApiState.activity.currentMemberRole = "OWNER";
  activityApiState.activity.status = "ACTIVE";
  activityApiState.activity.allowedLifecycleActions = ["END"];
  activityApiState.activity.canDelete = true;
  activityApiState.activity.fieldPermissions = { baseCurrency: false, endDate: true, inviteMode: true, location: true, name: true, startDate: true };
  activityApiState.activity.hasAccountingRecords = true;
  activityApiState.activity.location = "杭州";
  activityApiState.activities = [];
  activityApiState.deletedActivities = [];
  activityApiState.deletedQueryEnabled.length = 0;
  activityApiState.deletedQueryError = null;
  activityApiState.deletedQueryPending = false;
  for (const mutation of [activityApiState.create, activityApiState.update, activityApiState.lifecycle, activityApiState.remove, activityApiState.restore]) {
    mutation.error = null;
    mutation.isPending = false;
    mutation.mutateAsync.mockReset();
    mutation.mutateAsync.mockResolvedValue(activityApiState.activity);
  }
  activityApiState.update.mutateAsync.mockResolvedValue({ data: activityApiState.activity, warnings: [] });
  activityApiState.restore.mutate.mockReset();
  activityApiState.invitationQueryEnabled.length = 0;
  activityApiState.members[1] = {
    activityId: "activity-1",
    displayName: "临时成员",
    memberId: "guest-1",
    role: "MEMBER",
    status: "ACTIVE",
    userId: null,
    version: "1",
  };
  activityApiState.invitations = [];
  activityApiState.joinQueryEnabled.length = 0;
  activityApiState.joinRequests = [];
  activityApiState.createGuestBinding.error = null;
  activityApiState.createGuestBinding.isPending = false;
  activityApiState.createGuestBinding.mutateAsync.mockReset();
  activityApiState.decideJoinRequest.error = null;
  activityApiState.decideJoinRequest.isPending = false;
  activityApiState.decideJoinRequest.mutateAsync.mockReset();
  activityApiState.decideJoinRequest.mutateAsync.mockResolvedValue(undefined);
});

describe("MePage", () => {
  it("从账户与安全区域进入修改密码页", () => {
    render(<MemoryRouter initialEntries={["/me"]}><MePage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "账户与安全" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "修改密码" })).toHaveAttribute("href", "/me/password");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });
});

describe("活动管理导出", () => {
  it.each(["ACTIVE", "ENDED", "ARCHIVED"])("%s 活动在管理 Overlay 提供同源 CSV 下载链接", (status) => {
    activityApiState.activity.status = status;
    renderWorkspace("/activities/activity-1?panel=manage");

    expect(screen.getByRole("heading", { name: "活动管理" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "导出 CSV" })).toHaveAttribute("href", "/api/activities/activity-1/export.csv");
  });
});

describe("MemberInvitationPanel", () => {
  it("按用户名创建一次性定向邀请并显示明文口令", async () => {
    const onCreate = vi.fn().mockResolvedValue({
      activityId: "activity-1",
      expiresAt: "2026-09-08T00:00:00Z",
      invitationId: "invite-1",
      kind: "DIRECT",
      maxUses: 1,
      revision: "2",
      targetUsername: "invitee",
      token: "secret-token",
      useCount: 0,
      version: "1",
    });
    render(<MemberInvitationPanel onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "定向邀请" }));
    fireEvent.change(screen.getByRole("textbox", { name: /目标用户名/ }), { target: { value: "invitee" } });
    fireEvent.click(screen.getByRole("button", { name: "创建定向邀请" }));

    expect(await screen.findByText("secret-token")).toBeInTheDocument();
    expect(onCreate).toHaveBeenCalledWith({ mode: "direct", targetUsername: "invitee" });
  });

  it("创建失败时保留定向用户名并显示错误", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("定向邀请创建失败"));
    render(<MemberInvitationPanel onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "定向邀请" }));
    fireEvent.change(screen.getByRole("textbox", { name: /目标用户名/ }), { target: { value: "invitee" } });
    fireEvent.click(screen.getByRole("button", { name: "创建定向邀请" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("定向邀请创建失败");
    expect(screen.getByRole("textbox", { name: /目标用户名/ })).toHaveValue("invitee");
  });
});

describe("成员 Overlay", () => {
  it("从成员列表进入邀请子面板并可返回", () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "邀请成员" }));
    expect(screen.getByRole("heading", { name: "邀请成员" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "链接邀请" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "返回成员" }));
    expect(screen.getByRole("heading", { name: "成员" })).toBeInTheDocument();
  });

  it.each([
    ["MEMBER", "ACTIVE"],
    ["OWNER", "ENDED"],
  ])("角色为 %s 且状态为 %s 时不加载或显示成员管理操作", (role, status) => {
    activityApiState.activity.currentMemberRole = role;
    activityApiState.activity.status = status;
    renderWorkspace();

    expect(screen.queryByRole("button", { name: "邀请成员" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("临时成员名称")).not.toBeInTheDocument();
    expect(activityApiState.invitationQueryEnabled.at(-1)).toBe(false);
    expect(activityApiState.joinQueryEnabled.at(-1)).toBe(role === "OWNER");
  });

  it("ACTIVE Owner 只可为 Guest 打开账号绑定编辑器", () => {
    renderWorkspace();

    expect(screen.getAllByRole("button", { name: "绑定账号" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "绑定账号" }));
    expect(screen.getByRole("textbox", { name: /目标用户名/ })).toHaveFocus();
  });

  it.each([
    ["MEMBER", "ACTIVE", null],
    ["OWNER", "ENDED", null],
    ["OWNER", "ACTIVE", "user-2"],
  ])("角色 %s、状态 %s、Guest userId %s 时不显示绑定入口", (role, status, userId) => {
    activityApiState.activity.currentMemberRole = role;
    activityApiState.activity.status = status;
    activityApiState.members[1] = { ...activityApiState.members[1], userId };

    renderWorkspace();

    expect(screen.queryByRole("button", { name: "绑定账号" })).not.toBeInTheDocument();
  });

  it("绑定失败保留用户名，成功显示一次性口令", async () => {
    activityApiState.createGuestBinding.mutateAsync
      .mockRejectedValueOnce(new Error("绑定邀请创建失败"))
      .mockResolvedValueOnce({ token: "binding-token" });
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "绑定账号" }));
    const input = screen.getByRole("textbox", { name: /目标用户名/ });
    fireEvent.change(input, { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: "创建绑定邀请" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("绑定邀请创建失败");
    expect(input).toHaveValue("alice");

    fireEvent.click(screen.getByRole("button", { name: "创建绑定邀请" }));
    expect(await screen.findAllByText("binding-token")).toHaveLength(1);
    expect(activityApiState.createGuestBinding.mutateAsync).toHaveBeenLastCalledWith({
      memberId: "guest-1",
      targetUsername: "alice",
    });
  });

  it("有效绑定邀请显示 Guest 与目标账号", () => {
    activityApiState.invitations = [{
      activityId: "activity-1",
      expiresAt: "2999-09-08T00:00:00Z",
      guestMemberId: "guest-1",
      invitationId: "binding-1",
      kind: "DIRECT",
      maxUses: 1,
      purpose: "GUEST_BINDING",
      revision: "2",
      revokedAt: null,
      targetUsername: "alice",
      useCount: 0,
      version: "1",
    }];
    renderWorkspace();

    expect(screen.getByText("绑定「临时成员」给 @alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销" })).toBeInTheDocument();
  });

  it("Owner 可审批 Pending，失败时保留申请和服务端中文错误", async () => {
    activityApiState.joinRequests = [{
      activityId: "activity-1",
      applicantDisplayName: "待加入成员",
      applicantUserId: "user-2",
      createdAt: "2026-09-01T10:00:00Z",
      decidedAt: null,
      requestId: "request-1",
      revision: "3",
      status: "PENDING",
    }];
    activityApiState.decideJoinRequest.mutateAsync.mockRejectedValue(
      new Error("当前活动不允许新成员加入。"),
    );
    renderWorkspace();

    expect(screen.getByText("待加入成员")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批准待加入成员" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("当前活动不允许新成员加入。");
    expect(screen.getByText("待加入成员")).toBeInTheDocument();
    expect(activityApiState.decideJoinRequest.mutateAsync).toHaveBeenCalledWith({
      decision: "APPROVE",
      requestId: "request-1",
    });
  });

  it("只显示未撤销、未过期且未用尽的有效邀请", async () => {
    activityApiState.invitations = [
      {
        activityId: "activity-1",
        expiresAt: "2999-09-08T00:00:00Z",
        invitationId: "active",
        kind: "DIRECT",
        maxUses: 1,
        revision: "2",
        revokedAt: null,
        targetUsername: "active-user",
        useCount: 0,
        version: "1",
      },
      {
        activityId: "activity-1",
        expiresAt: "2999-09-08T00:00:00Z",
        invitationId: "used",
        kind: "DIRECT",
        maxUses: 1,
        revision: "3",
        revokedAt: null,
        targetUsername: "used-user",
        useCount: 1,
        version: "1",
      },
      {
        activityId: "activity-1",
        expiresAt: "2020-01-01T00:00:00Z",
        invitationId: "expired",
        kind: "DIRECT",
        maxUses: 1,
        revision: "4",
        revokedAt: null,
        targetUsername: "expired-user",
        useCount: 0,
        version: "1",
      },
      {
        activityId: "activity-1",
        expiresAt: "2999-09-08T00:00:00Z",
        invitationId: "revoked",
        kind: "DIRECT",
        maxUses: 1,
        revision: "5",
        revokedAt: "2026-09-01T00:00:00Z",
        targetUsername: "revoked-user",
        useCount: 0,
        version: "2",
      },
    ];
    renderWorkspace();

    expect(await screen.findByText("active-user")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("used-user")).not.toBeInTheDocument();
      expect(screen.queryByText("expired-user")).not.toBeInTheDocument();
      expect(screen.queryByText("revoked-user")).not.toBeInTheDocument();
    });
  });
});

describe("创建活动 Overlay", () => {
  it("提交完整 generated 请求，空白地点归一化为 null，并使用本地公历当天", async () => {
    renderActivitiesPage();
    fireEvent.click(screen.getAllByRole("button", { name: "创建活动" })[0]);

    fireEvent.change(screen.getByRole("textbox", { name: "活动名称" }), { target: { value: "国庆旅行" } });
    fireEvent.change(screen.getByRole("textbox", { name: "地点（可选）" }), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("结束日期（可选）"), { target: { value: "2026-10-07" } });
    fireEvent.change(screen.getByRole("combobox", { name: "主币种" }), { target: { value: "USD" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "创建活动" })).getByRole("button", { name: "创建活动" }));

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await waitFor(() => expect(activityApiState.create.mutateAsync).toHaveBeenCalledWith({
      baseCurrency: "USD",
      endDate: "2026-10-07",
      location: null,
      name: "国庆旅行",
      startDate: today,
    }));
  });

  it("服务端失败后保留全部输入并展示错误", async () => {
    activityApiState.create.mutateAsync.mockRejectedValue(new Error("活动创建失败"));
    renderActivitiesPage();
    fireEvent.click(screen.getAllByRole("button", { name: "创建活动" })[0]);

    fireEvent.change(screen.getByRole("textbox", { name: "活动名称" }), { target: { value: "保留的名称" } });
    fireEvent.change(screen.getByRole("textbox", { name: "地点（可选）" }), { target: { value: "上海" } });
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("结束日期（可选）"), { target: { value: "2026-09-12" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "创建活动" })).getByRole("button", { name: "创建活动" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("活动创建失败");
    expect(screen.getByRole("textbox", { name: "活动名称" })).toHaveValue("保留的名称");
    expect(screen.getByRole("textbox", { name: "地点（可选）" })).toHaveValue("上海");
    expect(screen.getByLabelText("开始日期")).toHaveValue("2026-09-10");
    expect(screen.getByLabelText("结束日期（可选）")).toHaveValue("2026-09-12");
  });

  it("Escape 关闭 Overlay 并将焦点还给打开按钮", async () => {
    renderActivitiesPage();
    const trigger = screen.getAllByRole("button", { name: "创建活动" })[0];
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox", { name: "活动名称" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "创建活动" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe("活动管理 Overlay", () => {
  it("按字段权限把资料行渲染为独立编辑入口，不展示权限清单或统一编辑按钮", () => {
    renderWorkspace("/activities/activity-1?panel=manage");

    expect(screen.getByText("杭州")).toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    expect(screen.getByText(/已有账务记录/)).toBeInTheDocument();
    expect(screen.queryByText("字段权限")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑活动资料" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑活动名称" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑地点" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑主币种" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑开始日期" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑结束日期" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑加入方式" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "结束活动" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除活动" })).toBeInTheDocument();
  });

  it("非 Owner 且服务端未授权时不显示任何管理命令", () => {
    activityApiState.activity.currentMemberRole = "MEMBER";
    activityApiState.activity.allowedLifecycleActions = [];
    activityApiState.activity.canDelete = false;
    activityApiState.activity.fieldPermissions = { baseCurrency: false, endDate: false, inviteMode: false, location: false, name: false, startDate: false };
    renderWorkspace("/activities/activity-1?panel=manage");

    expect(screen.queryByRole("button", { name: /^编辑/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "结束活动" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除活动" })).not.toBeInTheDocument();
  });

  it("点击资料行只编辑对应字段，失败时携带版本并保留草稿和错误", async () => {
    activityApiState.update.mutateAsync.mockRejectedValue(new Error("资料保存失败"));
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: "编辑地点" }));

    expect(screen.getByRole("button", { name: "返回活动管理" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "地点" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "活动名称" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "地点（可选）" }), { target: { value: "苏州" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(activityApiState.update.mutateAsync).toHaveBeenCalledWith({
      location: "苏州",
      version: "7",
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent("资料保存失败");
    expect(screen.getByRole("textbox", { name: "地点（可选）" })).toHaveValue("苏州");
  });

  it("加入方式在独立子视图显式保存，不在选择时立即提交", async () => {
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: "编辑加入方式" }));

    expect(screen.getByRole("button", { name: "直接加入" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "需要审批" }));
    expect(activityApiState.update.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(activityApiState.update.mutateAsync).toHaveBeenCalledWith({
      inviteMode: "REQUIRE_APPROVAL",
      version: "7",
    }));
  });

  it("单字段保存后返回管理根视图并展示 generated warning", async () => {
    activityApiState.update.mutateAsync.mockResolvedValue({
      data: activityApiState.activity,
      warnings: ["EXPENSE_BEFORE_ACTIVITY_START"],
    });
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: "编辑开始日期" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("活动开始日期晚于已有账单的发生时间，请检查日期或历史账单。"))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑开始日期" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭活动管理" })).toHaveFocus();
  });

  it("切换管理子视图后关闭仍将焦点还给页头触发器", async () => {
    renderWorkspace("/activities/activity-1");
    const trigger = screen.getByRole("link", { name: "活动管理" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "编辑活动名称" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "活动名称" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "返回活动管理" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭活动管理" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "活动管理" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("生命周期命令始终携带当前版本", async () => {
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: "结束活动" }));
    await waitFor(() => expect(activityApiState.lifecycle.mutateAsync).toHaveBeenCalledWith({ action: "END", version: "7" }));
  });

  it("删除必须在 Overlay 内二次确认，成功后返回活动列表", async () => {
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: "删除活动" }));
    expect(activityApiState.remove.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "确认删除活动" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "确认删除活动" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "确认删除活动" }));
    await waitFor(() => expect(activityApiState.remove.mutateAsync).toHaveBeenCalledWith("7"));
    expect(await screen.findByText("活动列表页")).toBeInTheDocument();
  });

  it("主导航始终严格保持流水和结算两项", () => {
    renderWorkspace("/activities/activity-1?panel=manage");
    expect(screen.getByRole("navigation", { name: "活动导航" }).querySelectorAll("a")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /^(流水|结算)$/ }).map((link) => link.textContent)).toEqual(["流水", "结算"]);
  });
});

describe("已删除活动", () => {
  it("仅打开独立 Overlay 后查询，并显示期限、过滤过期缓存及按版本恢复", async () => {
    activityApiState.deletedActivities = [
      { ...activityApiState.activity, activityId: "deleted-valid", canDelete: false, canRestore: true, deletedAt: "2026-08-20T08:00:00Z", name: "可恢复活动", purgeAfter: "2999-09-20T08:00:00Z", status: "ENDED", version: "9" },
      { ...activityApiState.activity, activityId: "deleted-expired", canDelete: false, canRestore: true, deletedAt: "2020-08-20T08:00:00Z", name: "过期缓存活动", purgeAfter: "2020-09-20T08:00:00Z", status: "ENDED", version: "3" },
    ];
    renderActivitiesPage();

    expect(activityApiState.deletedQueryEnabled).toEqual([false]);
    expect(screen.queryByText("可恢复活动")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "已删除活动" }));

    expect(activityApiState.deletedQueryEnabled.at(-1)).toBe(true);
    expect(screen.getByRole("dialog", { name: "已删除活动" })).toBeInTheDocument();
    expect(screen.getByText("可恢复活动")).toBeInTheDocument();
    expect(screen.getByText(/删除于/)).toBeInTheDocument();
    expect(screen.getByText(/可恢复至/)).toBeInTheDocument();
    expect(screen.queryByText("过期缓存活动")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "恢复可恢复活动" }));
    expect(activityApiState.restore.mutate).toHaveBeenCalledWith("9");
  });

  it("deleted 查询错误只在 Overlay 内显示，不阻塞 current 活动页面", () => {
    activityApiState.activities = [activityApiState.activity];
    activityApiState.deletedQueryError = new Error("已删除活动读取失败");
    renderActivitiesPage();

    expect(screen.getByRole("heading", { name: "活动" })).toBeInTheDocument();
    expect(screen.getByText("测试活动")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "已删除活动" }));
    expect(screen.getByRole("alert")).toHaveTextContent("已删除活动读取失败");
  });
});
