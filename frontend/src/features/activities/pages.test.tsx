import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/error";

const testNavigator = globalThis.navigator;
const testUrl = globalThis.URL;

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
  activityError: null as unknown,
  activities: [] as Array<Record<string, unknown>>,
  activitiesError: null as unknown,
  activitiesPending: false,
  notifications: { items: [] as Array<Record<string, unknown>>, timeZone: "Asia/Shanghai", unreadCount: 0 },
  notificationMarkRead: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  notificationDelete: { error: null as unknown, isPending: false, mutateAsync: vi.fn(), variables: undefined as string | undefined },
  notificationDecide: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  ledgers: [] as Array<{ data?: { balances: Array<{ memberId: string; netMinor: string }> }; isError: boolean; isPending: boolean }>,
  deletedActivities: [] as Array<Record<string, unknown>>,
  deletedQueryEnabled: [] as boolean[],
  deletedQueryError: null as unknown,
  deletedQueryPending: false,
  snapshotData: undefined as unknown,
  snapshotError: null as unknown,
  create: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  update: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  lifecycle: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  remove: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  removeGuest: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
  restore: { error: null as unknown, isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() },
  transfer: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
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
  exportCsv: vi.fn(),
  pwaStandalone: false,
}));

vi.mock("../accounting/api", () => ({
  useActivityLedgersQuery: () => activityApiState.ledgers,
}));

vi.mock("../auth/api", () => ({
  useSessionQuery: () => ({
    data: { avatarPreset: 4, displayName: "测试用户", isSystemAdmin: true, userId: "user-1", username: "tester" },
    isPending: false,
  }),
}));

vi.mock("../notifications/api", () => ({
  useNotificationsQuery: () => ({ data: activityApiState.notifications, isPending: false }),
  useMarkNotificationReadMutation: () => activityApiState.notificationMarkRead,
  useDeleteNotificationMutation: () => activityApiState.notificationDelete,
  useDecideNotificationJoinRequestMutation: () => activityApiState.notificationDecide,
}));

vi.mock("./offline-workspace", () => ({
  useOnlineStatus: () => true,
  useActivitySnapshotQuery: () => ({ data: activityApiState.snapshotData, error: activityApiState.snapshotError, isPending: false }),
}));

vi.mock("../../app/pwa-standalone", () => ({
  isPwaStandalone: () => activityApiState.pwaStandalone,
}));

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return {
    ...original,
    useActivitiesQuery: () => ({ data: activityApiState.activities, error: activityApiState.activitiesError, isPending: activityApiState.activitiesPending }),
    useDeletedActivitiesQuery: (_userId: string, enabled = true) => {
      activityApiState.deletedQueryEnabled.push(enabled);
      return {
        data: activityApiState.deletedActivities,
        error: activityApiState.deletedQueryError,
        isPending: activityApiState.deletedQueryPending,
      };
    },
    useActivityQuery: () => ({ data: activityApiState.activity, error: activityApiState.activityError, isPending: false }),
    exportActivityCsv: activityApiState.exportCsv,
    useCreateActivityMutation: () => activityApiState.create,
    useUpdateActivityMutation: () => activityApiState.update,
    useActivityLifecycleMutation: () => activityApiState.lifecycle,
    useDeleteActivityMutation: () => activityApiState.remove,
    useRemoveGuestMutation: () => activityApiState.removeGuest,
    useRestoreActivityMutation: () => activityApiState.restore,
    useTransferOwnershipMutation: () => activityApiState.transfer,
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

import { ActivitiesPage } from "./activities-page";
import { ActivityWorkspace } from "./activity-workspace";
import { MemberInvitationPanel } from "./members-panel";
import { useWorkspace } from "./workspace-context";

function renderWorkspace(entry = "/activities/activity-1?panel=members", includeLocation = false) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/activities/:activityId" element={<ActivityWorkspace />} />
        <Route path="/activities" element={<p>活动列表页</p>} />
      </Routes>
      {includeLocation ? <LocationProbe /> : null}
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderActivitiesPage(entry = "/activities", includeLocation = false) {
  return render(<MemoryRouter initialEntries={[entry]}><ActivitiesPage />{includeLocation ? <LocationProbe /> : null}</MemoryRouter>);
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => {
  cleanup();
  activityApiState.activity.currentMemberRole = "OWNER";
  activityApiState.activity.status = "ACTIVE";
  activityApiState.activity.allowedLifecycleActions = ["END"];
  activityApiState.activity.canDelete = true;
  activityApiState.activity.fieldPermissions = { baseCurrency: false, endDate: true, inviteMode: true, location: true, name: true, startDate: true };
  activityApiState.activity.hasAccountingRecords = true;
  activityApiState.activity.location = "杭州";
  activityApiState.activity.inviteMode = "DIRECT_JOIN";
  activityApiState.activities = [];
  activityApiState.notifications = { items: [], timeZone: "Asia/Shanghai", unreadCount: 0 };
  for (const mutation of [activityApiState.notificationMarkRead, activityApiState.notificationDelete, activityApiState.notificationDecide]) {
    mutation.error = null;
    mutation.isPending = false;
    mutation.mutateAsync.mockReset();
  }
  activityApiState.notificationDelete.variables = undefined;
  activityApiState.activitiesError = null;
  activityApiState.activitiesPending = false;
  activityApiState.ledgers = [];
  activityApiState.activityError = null;
  activityApiState.deletedActivities = [];
  activityApiState.deletedQueryEnabled.length = 0;
  activityApiState.deletedQueryError = null;
  activityApiState.deletedQueryPending = false;
  activityApiState.snapshotData = undefined;
  activityApiState.snapshotError = null;
  activityApiState.exportCsv.mockReset();
  activityApiState.exportCsv.mockResolvedValue(new Blob(["csv"], { type: "text/csv" }));
  activityApiState.pwaStandalone = false;
  for (const mutation of [activityApiState.create, activityApiState.update, activityApiState.lifecycle, activityApiState.remove, activityApiState.removeGuest, activityApiState.restore, activityApiState.transfer]) {
    mutation.error = null;
    mutation.isPending = false;
    mutation.mutateAsync.mockReset();
    mutation.mutateAsync.mockResolvedValue(activityApiState.activity);
  }
  activityApiState.removeGuest.mutateAsync.mockResolvedValue({ data: { memberId: "guest-1", result: "DELETED", revision: "2" } });
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
  vi.stubGlobal("navigator", testNavigator);
  vi.stubGlobal("URL", testUrl);
});

describe("活动管理导出", () => {
  it.each(["ACTIVE", "ENDED", "ARCHIVED"])("%s 活动在管理 Overlay 提供应用内 CSV 导出按钮", (status) => {
    activityApiState.activity.status = status;
    renderWorkspace("/activities/activity-1?panel=manage");

    expect(screen.getByRole("heading", { name: "活动管理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 CSV" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "导出 CSV" })).not.toBeInTheDocument();
  });

  it("standalone PWA 支持文件分享时保持当前 URL 和管理 Sheet", async () => {
    activityApiState.pwaStandalone = true;
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, canShare: vi.fn(() => true), share });
    renderWorkspace("/activities/activity-1?panel=manage", true);

    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));

    await waitFor(() => expect(activityApiState.exportCsv).toHaveBeenCalledWith("activity-1"));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.any(File)] }));
    expect((share.mock.calls[0][0].files[0] as File).name).toBe("activity-export.csv");
    expect(screen.getByRole("dialog", { name: "活动管理" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/activities/activity-1?panel=manage");
  });

  it("用户取消系统分享时不显示错误且管理上下文不变", async () => {
    activityApiState.pwaStandalone = true;
    const share = vi.fn().mockRejectedValue(new DOMException("用户取消", "AbortError"));
    vi.stubGlobal("navigator", { ...navigator, canShare: vi.fn(() => true), share });
    renderWorkspace("/activities/activity-1?panel=manage", true);

    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));

    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "活动管理" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("?panel=manage");
  });

  it("普通浏览器使用临时 Blob URL 下载并立即清理", async () => {
    const createObjectURL = vi.fn(() => "blob:activity-export");
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    renderWorkspace("/activities/activity-1?panel=manage", true);

    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:activity-export");
    expect(screen.getByText("CSV 已开始下载。")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("?panel=manage");
  });

  it("导出准备期间锁定其他写操作并显示固定状态", async () => {
    let resolveExport!: (blob: Blob) => void;
    activityApiState.exportCsv.mockImplementation(() => new Promise<Blob>((resolve) => { resolveExport = resolve; }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:activity-export"), revokeObjectURL: vi.fn() });
    renderWorkspace("/activities/activity-1?panel=manage");

    fireEvent.click(screen.getByRole("button", { name: "导出 CSV" }));

    expect(await screen.findByText("正在准备 CSV…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^结束活动/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^删除活动/ })).toBeDisabled();
    resolveExport(new Blob(["csv"], { type: "text/csv" }));
    await waitFor(() => expect(screen.queryByText("正在准备 CSV…")).not.toBeInTheDocument());
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

  it("仅 ACTIVE Owner 对未绑定临时成员显示带昵称的删除按钮", () => {
    renderWorkspace();

    const removeButton = screen.getByRole("button", { name: "删除临时成员 临时成员" });
    expect(removeButton).toHaveAttribute("title", "删除临时成员 临时成员");
    expect(removeButton).toHaveClass("member-row__remove");

    activityApiState.activity.currentMemberRole = "MEMBER";
    cleanup();
    renderWorkspace();
    expect(screen.queryByRole("button", { name: "删除临时成员 临时成员" })).not.toBeInTheDocument();
  });

  it.each([
    ["ENDED", null],
    ["ACTIVE", "user-2"],
    ["ACTIVE", null, "LEFT"],
  ])("状态 %s、userId %s 或已移除成员不显示删除入口", (status, userId, memberStatus = "ACTIVE") => {
    activityApiState.activity.status = status;
    activityApiState.members[1] = { ...activityApiState.members[1], status: memberStatus, userId };
    renderWorkspace();

    expect(screen.queryByRole("button", { name: /删除临时成员/ })).not.toBeInTheDocument();
  });

  it("确认删除时显示说明、支持焦点恢复并只提交一次", async () => {
    const mutateAsync = activityApiState.removeGuest.mutateAsync.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: { memberId: "guest-1", result: "DELETED", revision: "2" } }), 0)),
    );
    renderWorkspace();

    const trigger = screen.getByRole("button", { name: "删除临时成员 临时成员" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog", { name: "确认删除临时成员「临时成员」" });
    expect(within(dialog).getByText(/不能再参与新账单或结算/)).toBeInTheDocument();
    expect(within(dialog).getByText(/已有账务会保留/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();

    fireEvent.click(within(dialog).getByRole("button", { name: "删除成员" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "删除成员" }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("button", { name: "删除成员" })).toBeDisabled();

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("删除失败时保留确认弹层并显示服务端中文错误", async () => {
    activityApiState.removeGuest.mutateAsync.mockRejectedValue(new Error("成员已被其他操作修改。"));
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "删除临时成员 临时成员" }));
    const dialog = screen.getByRole("alertdialog", { name: "确认删除临时成员「临时成员」" });
    fireEvent.click(within(dialog).getByRole("button", { name: "删除成员" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("成员已被其他操作修改。");
    expect(screen.getByRole("alertdialog", { name: "确认删除临时成员「临时成员」" })).toBeInTheDocument();
  });

  it("硬删除后成员消失，软删除后保留原位并标记只读状态", async () => {
    activityApiState.removeGuest.mutateAsync.mockImplementationOnce(async () => {
      activityApiState.members.splice(1, 1);
      return { data: { memberId: "guest-1", result: "DELETED", revision: "2" } };
    });
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "删除临时成员 临时成员" }));
    fireEvent.click(screen.getByRole("button", { name: "删除成员" }));

    await waitFor(() => expect(screen.queryByText("临时成员")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "活动成员 · 1人" })).toBeInTheDocument();

    cleanup();
    activityApiState.members[1] = {
      activityId: "activity-1",
      displayName: "临时成员",
      memberId: "guest-1",
      role: "MEMBER",
      status: "ACTIVE",
      userId: null,
      version: "1",
    };
    activityApiState.removeGuest.mutateAsync.mockImplementationOnce(async () => {
      activityApiState.members[1] = { ...activityApiState.members[1], status: "LEFT", version: "2" };
      return { data: { memberId: "guest-1", result: "LEFT", revision: "3" } };
    });
    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "删除临时成员 临时成员" }));
    fireEvent.click(screen.getByRole("button", { name: "删除成员" }));

    await waitFor(() => expect(screen.getByText("临时成员 · 已移除")).toBeInTheDocument());
    expect(screen.getByText("已移除")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "活动成员 · 1人 · 已移除 1人" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /删除临时成员/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "绑定账号" })).not.toBeInTheDocument();
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

describe("活动列表空状态", () => {
  it("空状态插画下保持创建和加入入口的主次操作层级", () => {
    const { container } = renderActivitiesPage();

    const illustration = container.querySelector<HTMLImageElement>(
      'img[src="/illustrations/activity-list-empty.webp"]',
    );
    expect(illustration).toHaveAttribute("alt", "");
    expect(illustration).toHaveAttribute("aria-hidden", "true");
    expect(illustration).toHaveAttribute("width", "960");
    expect(illustration).toHaveAttribute("height", "640");
    expect(illustration).toHaveAttribute("loading", "eager");
    expect(illustration).toHaveAttribute(
      "sizes",
      "(max-width: 351px) calc(100vw - 32px), 320px",
    );
    expect(container.querySelector(".empty-state__icon")).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "创建活动" })).toHaveClass(
      "button--primary",
      "activity-empty-create",
    );
    expect(screen.getByRole("button", { name: "加入已有活动" })).toHaveClass(
      "button--ghost",
      "activity-empty-join",
    );
  });

  it("把恢复入口放在标题文字右侧，通知留在页头并把新建入口移到浮动按钮", () => {
    const { container } = renderActivitiesPage();
    const heading = screen.getByRole("heading", { name: "活动" });
    const deletedButton = screen.getByRole("button", { name: "已删除活动" });
    const notificationButton = screen.getByRole("link", { name: "通知" });
    const actionButton = screen.getByRole("button", { name: "新建或加入活动" });

    expect(heading.parentElement).toHaveClass("home-header__title");
    expect(heading.nextElementSibling).toBe(deletedButton);
    expect(container.querySelector(".home-header__actions")).toContainElement(notificationButton);
    expect(actionButton).toHaveClass("activity-add-fab");
    expect(actionButton.closest(".home-header")).toBeNull();
    expect(deletedButton).toHaveAttribute("title", "已删除活动");
    expect(deletedButton.querySelector(".lucide-trash-2")).toBeInTheDocument();
    expect(deletedButton.querySelector(".lucide-rotate-ccw")).not.toBeInTheDocument();
    expect(container.querySelector(".deleted-activities-entry")).not.toBeInTheDocument();
  });

  it("页头通知入口提供未读数量文案并直接跳转通知页", () => {
    activityApiState.notifications.unreadCount = 3;
    renderActivitiesPage("/activities", true);

    const trigger = screen.getByRole("link", { name: "通知，3 条未读" });
    expect(trigger.querySelector(".activity-notifications-trigger__badge")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("href", "/notifications");
    fireEvent.click(trigger);

    expect(screen.getByTestId("location")).toHaveTextContent("/notifications");
    expect(screen.queryByRole("dialog", { name: "通知" })).not.toBeInTheDocument();
  });

  it("已有活动时不显示空状态插画", () => {
    activityApiState.activities = [activityApiState.activity];
    const { container } = renderActivitiesPage();

    expect(
      container.querySelector('img[src="/illustrations/activity-list-empty.webp"]'),
    ).not.toBeInTheDocument();
    expect(container.querySelector('img[src^="/activity-covers/"]')).toHaveAttribute("loading", "lazy");
    expect(container.querySelector('img[src^="/activity-covers/"]')).toHaveAttribute("decoding", "async");
  });
});

describe("活动列表加载状态", () => {
  it("活动数据等待时保留页面外壳并只显示内容骨架", () => {
    activityApiState.activitiesPending = true;
    renderActivitiesPage();

    expect(screen.getByRole("heading", { name: "活动" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建或加入活动" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll(".activity-list-item--skeleton")).toHaveLength(2);
    expect(screen.queryByText("正在读取活动…")).toBeInTheDocument();
  });

  it("活动列表失败时保留页面外壳并在内容区显示错误", () => {
    activityApiState.activitiesError = new Error("活动列表读取失败");
    renderActivitiesPage();

    expect(screen.getByRole("heading", { name: "活动" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("活动列表读取失败");
    expect(screen.queryByText("正在读取活动…")).not.toBeInTheDocument();
  });

  it("Ledger 等待或失败时不把未知余额显示为已结清", () => {
    activityApiState.activities = [activityApiState.activity];
    activityApiState.ledgers = [{ isPending: true, isError: false }];
    const { rerender } = renderActivitiesPage();

    expect(screen.getByText("测试活动")).toBeInTheDocument();
    expect(screen.queryByText("已结清")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".activity-balance-skeleton")).toHaveLength(1);
    expect(document.querySelectorAll(".home-summary__skeleton")).toHaveLength(2);

    activityApiState.ledgers = [{ isPending: false, isError: true }];
    rerender(<MemoryRouter initialEntries={["/activities"]}><ActivitiesPage /></MemoryRouter>);
    expect(screen.getByText("余额暂不可用")).toBeInTheDocument();
    expect(screen.queryByText("已结清")).not.toBeInTheDocument();
  });

  it("Ledger 成功后显示真实余额和汇总", () => {
    activityApiState.activities = [activityApiState.activity];
    activityApiState.ledgers = [{
      isPending: false,
      isError: false,
      data: { balances: [{ memberId: "member-owner", netMinor: "-1200" }] },
    }];
    renderActivitiesPage();

    expect(screen.getByText("应付")).toBeInTheDocument();
    expect(screen.queryByText("余额暂不可用")).not.toBeInTheDocument();
    expect(document.querySelector(".home-summary__skeleton")).toBeNull();
  });
});

describe("创建活动 Overlay", () => {
  it("从选择页进入创建页后按历史层级返回，并在子视图切换时聚焦表单", async () => {
    renderActivitiesPage("/activities", true);
    const trigger = screen.getByRole("button", { name: "新建或加入活动" });

    fireEvent.click(trigger);
    expect(screen.getByTestId("location")).toHaveTextContent("/activities?panel=actions");
    const actions = screen.getByRole("dialog", { name: "新建或加入活动" });
    expect(within(actions).getByRole("button", { name: /^创建活动/ })).toHaveFocus();
    fireEvent.click(within(actions).getByRole("button", { name: /^创建活动/ }));

    expect(screen.getByTestId("location")).toHaveTextContent("/activities?panel=create");
    expect(screen.getByRole("textbox", { name: "活动名称" })).toHaveFocus();
    fireEvent.click(within(screen.getByRole("dialog", { name: "创建活动" })).getByRole("button", { name: "新建或加入活动" }));
    expect(screen.getByRole("dialog", { name: "新建或加入活动" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/activities?panel=actions");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "新建或加入活动" })).not.toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent("/activities");
  });

  it("从创建子视图直接关闭后恢复首页入口焦点", async () => {
    renderActivitiesPage();
    const trigger = screen.getByRole("button", { name: "新建或加入活动" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("dialog", { name: "新建或加入活动" })).getByRole("button", { name: /^创建活动/ }));

    fireEvent.click(within(screen.getByRole("dialog", { name: "创建活动" })).getByRole("button", { name: "关闭创建活动" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("空态直达创建仍保留创建/选择历史，并保留草稿", () => {
    renderActivitiesPage("/activities", true);
    fireEvent.click(screen.getAllByRole("button", { name: "创建活动" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "活动名称" }), { target: { value: "保留的活动" } });

    expect(screen.getByTestId("location")).toHaveTextContent("/activities?panel=create");
    fireEvent.click(within(screen.getByRole("dialog", { name: "创建活动" })).getByRole("button", { name: "新建或加入活动" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "新建或加入活动" })).getByRole("button", { name: /^创建活动/ }));
    expect(screen.getByRole("textbox", { name: "活动名称" })).toHaveValue("保留的活动");
  });

  it("空态直达加入仍保留创建/选择历史，并保留邀请口令草稿", () => {
    renderActivitiesPage("/activities", true);
    fireEvent.click(screen.getByRole("button", { name: "加入已有活动" }));
    fireEvent.change(screen.getByRole("textbox", { name: /邀请口令/ }), { target: { value: "draft-token" } });

    expect(screen.getByTestId("location")).toHaveTextContent("/activities?panel=join");
    fireEvent.click(within(screen.getByRole("dialog", { name: "加入活动" })).getByRole("button", { name: "新建或加入活动" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/activities?panel=actions");
    fireEvent.click(within(screen.getByRole("dialog", { name: "新建或加入活动" })).getByRole("button", { name: /^加入活动/ }));
    expect(screen.getByRole("textbox", { name: /邀请口令/ })).toHaveValue("draft-token");
  });

  it("直接打开创建查询参数时返回和关闭不会离开活动首页", () => {
    renderActivitiesPage("/activities?panel=create", true);
    expect(screen.getByRole("textbox", { name: "活动名称" })).toHaveFocus();

    fireEvent.click(within(screen.getByRole("dialog", { name: "创建活动" })).getByRole("button", { name: "新建或加入活动" }));
    expect(screen.getByRole("dialog", { name: "新建或加入活动" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/activities?panel=actions");
    fireEvent.click(screen.getByRole("button", { name: "关闭新建或加入活动" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/activities");
  });

  it("无效 panel 按普通首页处理且不启用已删除活动查询", () => {
    renderActivitiesPage("/activities?panel=unknown", true);

    expect(screen.getByRole("heading", { name: /^活动$/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(activityApiState.deletedQueryEnabled).toEqual([false]);
  });

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
  it("根视图使用一张连续列表并移除可见组名", () => {
    renderWorkspace("/activities/activity-1?panel=manage");

    const dialog = screen.getByRole("dialog", { name: "活动管理" });
    expect(within(dialog).getAllByRole("list")).toHaveLength(1);
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(11);
    expect(dialog.querySelectorAll(".activity-more > section > h2")).toHaveLength(0);
    for (const heading of ["活动信息", "协作与数据", "活动状态", "成员与权限", "危险操作"]) {
      expect(within(dialog).queryByText(heading)).not.toBeInTheDocument();
    }
    expect(within(dialog).getByText("当前状态")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "导出 CSV" })).toBeInTheDocument();
    expect([...dialog.querySelectorAll(".management-field__heading strong, .management-action-row strong")].map((node) => node.textContent)).toEqual([
      "活动名称", "地点", "开始日期", "结束日期", "主币种", "加入方式", "导出 CSV", "当前状态", "结束活动", "转让所有权", "删除活动",
    ]);
  });

  it("直接渲染可编辑资料，不展示编辑按钮或字段二级视图", () => {
    renderWorkspace("/activities/activity-1?panel=manage");

    expect(screen.getByRole("textbox", { name: "活动名称" })).toHaveValue("测试活动");
    expect(screen.getByRole("textbox", { name: "地点" })).toHaveValue("杭州");
    expect(screen.getByLabelText("开始日期")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("结束日期")).toHaveValue("");
    expect(screen.getByText(/已有账务记录/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CNY 人民币/ })).not.toBeInTheDocument();
    expect(screen.queryByText("字段权限")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑活动资料" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^编辑/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "直接加入" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /^结束活动/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^删除活动/ })).toBeInTheDocument();
  });

  it("非 Owner 且服务端未授权时不显示任何管理命令", () => {
    activityApiState.activity.currentMemberRole = "MEMBER";
    activityApiState.activity.allowedLifecycleActions = [];
    activityApiState.activity.canDelete = false;
    activityApiState.activity.fieldPermissions = { baseCurrency: false, endDate: false, inviteMode: false, location: false, name: false, startDate: false };
    renderWorkspace("/activities/activity-1?panel=manage");

    expect(screen.queryByRole("textbox", { name: "活动名称" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "地点" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "结束活动" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除活动" })).not.toBeInTheDocument();
  });

  it("资料保存期间锁定其他管理控件", () => {
    activityApiState.update.isPending = true;
    renderWorkspace("/activities/activity-1?panel=manage");

    expect(screen.getByRole("textbox", { name: "活动名称" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "地点" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "直接加入" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^结束活动/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^删除活动/ })).toBeDisabled();
  });

  it("已有账务时即使权限矩阵异常也保持币种只读", () => {
    activityApiState.activity.fieldPermissions.baseCurrency = true;
    renderWorkspace("/activities/activity-1?panel=manage");

    expect(screen.queryByRole("button", { name: /CNY 人民币/ })).not.toBeInTheDocument();
    expect(screen.getByText("已有账务记录，不可修改")).toBeInTheDocument();
  });

  it("文本字段失焦后只提交对应字段，失败时携带版本并保留草稿和错误", async () => {
    activityApiState.update.mutateAsync.mockRejectedValue(new Error("资料保存失败"));
    renderWorkspace("/activities/activity-1?panel=manage");
    const location = screen.getByRole("textbox", { name: "地点" });
    fireEvent.change(location, { target: { value: "苏州" } });
    fireEvent.blur(location);

    await waitFor(() => expect(activityApiState.update.mutateAsync).toHaveBeenCalledWith({
      location: "苏州",
      version: "7",
    }));
    expect(await screen.findByRole("alert")).toHaveTextContent("资料保存失败");
    expect(screen.getByRole("textbox", { name: "地点" })).toHaveValue("苏州");
  });

  it("加入方式在主 Sheet 原地展开并选择后立即提交", async () => {
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: "直接加入" }));
    const options = screen.getByRole("radiogroup", { name: "加入方式选项" });
    expect(within(options).getByRole("radio", { name: /直接加入.*访问有效邀请后直接成为成员/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(options).getByRole("radio", { name: /需要审批/ }));

    await waitFor(() => expect(activityApiState.update.mutateAsync).toHaveBeenCalledWith({
      inviteMode: "REQUIRE_APPROVAL",
      version: "7",
    }));
  });

  it("主币种与加入方式互斥展开，重复选择当前加入方式不提交", () => {
    activityApiState.activity.hasAccountingRecords = false;
    activityApiState.activity.fieldPermissions.baseCurrency = true;
    renderWorkspace("/activities/activity-1?panel=manage");

    fireEvent.click(screen.getByRole("button", { name: "CNY 人民币" }));
    expect(screen.getByRole("radiogroup", { name: "主币种选项" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "直接加入" }));
    expect(screen.queryByRole("radiogroup", { name: "主币种选项" })).not.toBeInTheDocument();
    const joinOptions = screen.getByRole("radiogroup", { name: "加入方式选项" });
    fireEvent.click(within(joinOptions).getByRole("radio", { name: /直接加入/ }));

    expect(screen.queryByRole("radiogroup", { name: "加入方式选项" })).not.toBeInTheDocument();
    expect(activityApiState.update.mutateAsync).not.toHaveBeenCalled();
  });

  it("加入方式保存失败时保留草稿、展开选项和中文错误", async () => {
    activityApiState.update.mutateAsync.mockRejectedValue(new Error("加入方式保存失败"));
    renderWorkspace("/activities/activity-1?panel=manage");

    fireEvent.click(screen.getByRole("button", { name: "直接加入" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "加入方式选项" })).getByRole("radio", { name: /需要审批/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("加入方式保存失败");
    expect(screen.getByRole("button", { name: "需要审批" })).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("radiogroup", { name: "加入方式选项" })).getByRole("radio", { name: /需要审批/ })).toHaveAttribute("aria-checked", "true");
  });

  it("主币种在当前 Sheet 原地展开并按选项立即保存", async () => {
    activityApiState.activity.hasAccountingRecords = false;
    activityApiState.activity.fieldPermissions.baseCurrency = true;
    renderWorkspace("/activities/activity-1?panel=manage");

    const trigger = screen.getByRole("button", { name: "CNY 人民币" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const options = screen.getByRole("radiogroup", { name: "主币种选项" });
    expect(within(options).getByRole("radio", { name: /CNY.*人民币/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(options).getByRole("radio", { name: /USD.*美元/ }));

    await waitFor(() => expect(activityApiState.update.mutateAsync).toHaveBeenCalledWith({
      baseCurrency: "USD",
      version: "7",
    }));
    expect(screen.queryByRole("radiogroup", { name: "主币种选项" })).not.toBeInTheDocument();
  });

  it("重复选择当前币种只收起选项，不发起请求", () => {
    activityApiState.activity.hasAccountingRecords = false;
    activityApiState.activity.fieldPermissions.baseCurrency = true;
    renderWorkspace("/activities/activity-1?panel=manage");

    fireEvent.click(screen.getByRole("button", { name: "CNY 人民币" }));
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "主币种选项" })).getByRole("radio", { name: /CNY.*人民币/ }));

    expect(screen.queryByRole("radiogroup", { name: "主币种选项" })).not.toBeInTheDocument();
    expect(activityApiState.update.mutateAsync).not.toHaveBeenCalled();
  });

  it("日期选择后直接保存并展示 generated warning，管理页保持原地", async () => {
    activityApiState.update.mutateAsync.mockResolvedValue({
      data: activityApiState.activity,
      warnings: ["EXPENSE_BEFORE_ACTIVITY_START"],
    });
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-09-02" } });

    expect(await screen.findByText("活动开始日期晚于已有账单的发生时间，请检查日期或历史账单。"))
      .toBeInTheDocument();
    expect(screen.getByLabelText("开始日期")).toHaveValue("2026-09-02");
    expect(screen.getByRole("dialog", { name: "活动管理" })).toBeInTheDocument();
  });

  it("关闭单层管理 Sheet 后仍将焦点还给页头触发器", async () => {
    renderWorkspace("/activities/activity-1");
    const trigger = screen.getByRole("link", { name: "活动管理" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "关闭活动管理" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "活动管理" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("资料保存期间请求关闭会等待保存完成", async () => {
    let resolveUpdate!: (value: unknown) => void;
    activityApiState.update.mutateAsync.mockImplementation(() => new Promise<unknown>((resolve) => { resolveUpdate = resolve; }));
    renderWorkspace("/activities/activity-1?panel=manage");
    const location = screen.getByRole("textbox", { name: "地点" });
    fireEvent.change(location, { target: { value: "苏州" } });
    fireEvent.blur(location);

    await waitFor(() => expect(activityApiState.update.mutateAsync).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "关闭活动管理" }));
    expect(screen.getByRole("dialog", { name: "活动管理" })).toBeInTheDocument();
    expect(screen.getByText("正在保存，保存完成后关闭活动管理。")).toBeInTheDocument();

    resolveUpdate({ data: { ...activityApiState.activity, version: "8" }, warnings: [] });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "活动管理" })).not.toBeInTheDocument());
  });

  it("结束活动确认后始终携带当前版本", async () => {
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: /^结束活动/ }));
    expect(activityApiState.lifecycle.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "确认结束活动" })).toHaveTextContent("仍可查看活动并处理实际结算");
    fireEvent.click(screen.getByRole("button", { name: "确认结束活动" }));
    await waitFor(() => expect(activityApiState.lifecycle.mutateAsync).toHaveBeenCalledWith({ action: "END", version: "7" }));
  });

  it("归档需要确认，重新开启和取消归档直接执行", async () => {
    activityApiState.activity.allowedLifecycleActions = ["ARCHIVE", "REOPEN", "UNARCHIVE"];
    renderWorkspace("/activities/activity-1?panel=manage");

    fireEvent.click(screen.getByRole("button", { name: /^归档活动/ }));
    expect(screen.getByRole("alertdialog", { name: "确认归档活动" })).toHaveTextContent("需要取消归档后才能继续处理");
    expect(activityApiState.lifecycle.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("button", { name: /^重新开启活动/ }));
    await waitFor(() => expect(activityApiState.lifecycle.mutateAsync).toHaveBeenCalledWith({ action: "REOPEN", version: "7" }));
    activityApiState.lifecycle.mutateAsync.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^取消归档/ }));
    await waitFor(() => expect(activityApiState.lifecycle.mutateAsync).toHaveBeenCalledWith({ action: "UNARCHIVE", version: "7" }));
  });

  it("所有权转让进入子视图，只列出 ACTIVE 账号成员并保留失败选择", async () => {
    activityApiState.members[1] = { ...activityApiState.members[1], displayName: "Bob", userId: "user-2" };
    activityApiState.transfer.mutateAsync.mockRejectedValue(new Error("活动版本已变化"));
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: /^转让所有权/ }));

    expect(screen.getByRole("dialog", { name: "转让所有权" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回活动管理" })).toBeInTheDocument();
    expect(screen.getByText("转让后，新成员将成为活动所有者，你会变为普通成员。")).toBeInTheDocument();
    const candidates = screen.getByRole("radiogroup", { name: "新所有者" });
    expect(within(candidates).getByRole("radio", { name: /Bob/ })).toBeInTheDocument();
    expect(within(candidates).queryByRole("radio", { name: /临时成员/ })).not.toBeInTheDocument();
    fireEvent.click(within(candidates).getByRole("radio", { name: /Bob/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认转让" }));

    await waitFor(() => expect(activityApiState.transfer.mutateAsync).toHaveBeenCalledWith({ newOwnerMemberId: "guest-1", version: "7" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("活动版本已变化");
    expect(within(screen.getByRole("radiogroup", { name: "新所有者" })).getByRole("radio", { name: /Bob/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("dialog", { name: "转让所有权" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回活动管理" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "活动管理" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^转让所有权/ })).toHaveFocus();
  });

  it("删除使用 AlertDialog 二次确认，取消后保留管理列表并成功返回活动列表", async () => {
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: /^删除活动/ }));
    expect(activityApiState.remove.mutateAsync).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("alertdialog", { name: "确认删除活动" });
    expect(confirmation).toHaveTextContent("删除后活动会离开当前列表，并在服务端给出的恢复期限内允许恢复。");
    expect(within(confirmation).getByRole("button", { name: "取消" })).toHaveFocus();

    fireEvent.click(within(confirmation).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog", { name: "确认删除活动" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^删除活动/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除活动" }));

    await waitFor(() => expect(activityApiState.remove.mutateAsync).toHaveBeenCalledWith("7"));
    expect(await screen.findByText("活动列表页")).toBeInTheDocument();
  });

  it("删除确认支持 Escape 并将焦点还给删除入口", async () => {
    renderWorkspace("/activities/activity-1?panel=manage");
    const trigger = screen.getByRole("button", { name: /^删除活动/ });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("alertdialog", { name: "确认删除活动" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "确认删除活动" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(activityApiState.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it("删除执行期间禁止取消、Escape 和重复提交", async () => {
    let resolveDelete!: () => void;
    activityApiState.remove.mutateAsync.mockImplementation(() => new Promise<void>((resolve) => { resolveDelete = resolve; }));
    renderWorkspace("/activities/activity-1?panel=manage");
    fireEvent.click(screen.getByRole("button", { name: /^删除活动/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除活动" }));

    const confirmation = screen.getByRole("alertdialog", { name: "确认删除活动" });
    expect(within(confirmation).getByRole("button", { name: "取消" })).toBeDisabled();
    expect(within(confirmation).getByRole("button", { name: "确认删除活动" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alertdialog", { name: "确认删除活动" })).toBeInTheDocument();
    expect(activityApiState.remove.mutateAsync).toHaveBeenCalledOnce();
    resolveDelete();
    await waitFor(() => expect(screen.getByText("活动列表页")).toBeInTheDocument());
  });

  it("删除使用资料保存后得到的最新版本", async () => {
    activityApiState.update.mutateAsync.mockResolvedValue({ data: { ...activityApiState.activity, version: "8" }, warnings: [] });
    renderWorkspace("/activities/activity-1?panel=manage");
    const location = screen.getByRole("textbox", { name: "地点" });
    fireEvent.change(location, { target: { value: "苏州" } });
    fireEvent.blur(location);
    await waitFor(() => expect(activityApiState.update.mutateAsync).toHaveBeenCalledWith({ location: "苏州", version: "7" }));

    fireEvent.click(screen.getByRole("button", { name: /^删除活动/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除活动" }));
    await waitFor(() => expect(activityApiState.remove.mutateAsync).toHaveBeenCalledWith("8"));
  });

  it("主导航始终严格保持流水和结算两项", () => {
    renderWorkspace("/activities/activity-1?panel=manage");
    expect(screen.getByRole("navigation", { name: "活动导航" }).querySelectorAll("a")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /^(流水|结算)$/ }).map((link) => link.textContent)).toEqual(["流水", "结算"]);
  });
});

describe("活动工作台访问边界", () => {
  it("嵌套路由通过真实 Context 读取当前用户、活动、成员和快照", () => {
    const snapshot = { fromCache: true, snapshot: { activity: activityApiState.activity, members: activityApiState.members } };
    activityApiState.snapshotData = snapshot;
    function WorkspaceConsumer() {
      const workspace = useWorkspace();
      expect(workspace.session.userId).toBe("user-1");
      expect(workspace.activity).toBe(activityApiState.activity);
      expect(workspace.members).toBe(activityApiState.members);
      expect(workspace.offline).toBe(false);
      expect(workspace.snapshot).toBe(snapshot);
      return <p>工作区上下文已连接</p>;
    }
    render(<MemoryRouter initialEntries={["/activities/activity-1"]}><Routes>
      <Route path="/activities/:activityId" element={<ActivityWorkspace />}>
        <Route index element={<WorkspaceConsumer />} />
      </Route>
    </Routes></MemoryRouter>);
    expect(screen.getByText("工作区上下文已连接")).toBeVisible();
  });

  it("在线收到服务端 404 时不使用已有 Snapshot 渲染旧活动", () => {
    activityApiState.activityError = new ApiRequestError(404);
    activityApiState.snapshotData = {
      fromCache: true,
      snapshot: { activity: activityApiState.activity, members: activityApiState.members },
    };

    renderWorkspace("/activities/activity-1");

    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "测试活动" })).not.toBeInTheDocument();
  });
});

describe("已删除活动", () => {
  it("通过查询参数打开时只显示一个标题，并保留紧凑的右侧恢复操作", () => {
    activityApiState.deletedActivities = [
      { ...activityApiState.activity, activityId: "deleted-mobile", canDelete: false, canRestore: true, deletedAt: "2026-08-20T08:00:00Z", name: "移动端已删除活动", purgeAfter: "2999-09-20T08:00:00Z", status: "ENDED", version: "9" },
    ];
    renderActivitiesPage("/activities?panel=deleted", true);

    expect(activityApiState.deletedQueryEnabled.at(-1)).toBe(true);
    expect(screen.getAllByRole("heading", { name: "已删除活动" })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "可恢复的活动" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复移动端已删除活动" })).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/activities?panel=deleted");
  });

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
