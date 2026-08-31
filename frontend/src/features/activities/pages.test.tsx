import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const activityApiState = vi.hoisted(() => ({
  activity: {
    activityId: "activity-1",
    baseCurrency: "CNY",
    currentMemberId: "member-owner",
    currentMemberRole: "OWNER",
    name: "测试活动",
    ownerMemberId: "member-owner",
    revision: "1",
    status: "ACTIVE",
    version: "1",
  },
  invitationQueryEnabled: [] as boolean[],
  invitations: [] as Array<{
    activityId: string;
    expiresAt: string;
    invitationId: string;
    kind: string;
    maxUses: number | null;
    revision: string;
    revokedAt: string | null;
    targetUsername: string | null;
    useCount: number;
    version: string;
  }>,
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
    useActivityQuery: () => ({ data: activityApiState.activity, isPending: false }),
    useMembersQuery: () => ({
      data: [
        {
          activityId: "activity-1",
          displayName: "测试用户",
          memberId: "member-owner",
          role: "OWNER",
          status: "ACTIVE",
          userId: "user-1",
          version: "1",
        },
      ],
      isPending: false,
    }),
    useInvitationsQuery: (_userId: string, _activityId: string, enabled: boolean) => {
      activityApiState.invitationQueryEnabled.push(enabled);
      return { data: activityApiState.invitations, isPending: false };
    },
    useCreateGuestMutation: () => ({ error: null, isPending: false, mutateAsync: vi.fn() }),
    useCreateInvitationMutation: () => ({ error: null, isPending: false, mutateAsync: vi.fn() }),
    useRevokeInvitationMutation: () => ({ isPending: false, mutate: vi.fn() }),
  };
});

import { ActivityWorkspace, MemberInvitationPanel, MePage } from "./pages";

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={["/activities/activity-1?panel=members"]}>
      <Routes>
        <Route path="/activities/:activityId" element={<ActivityWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  activityApiState.activity.currentMemberRole = "OWNER";
  activityApiState.activity.status = "ACTIVE";
  activityApiState.invitationQueryEnabled.length = 0;
  activityApiState.invitations = [];
});

describe("MePage", () => {
  it("从账户与安全区域进入修改密码页", () => {
    render(<MemoryRouter initialEntries={["/me"]}><MePage /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "账户与安全" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "修改密码" })).toHaveAttribute("href", "/me/password");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
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
