// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useParams: () => ({ activityId: "activity-1" }),
  useSearchParams: () => new URLSearchParams(),
}));

import { MemberPageLoader } from "@/features/members/components/member-page-loader";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("嵌入成员数据加载期间仍显示统一成员 Sheet Header", async () => {
  const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetchMock);

  render(<MemberPageLoader embedded />);

  const dialog = await screen.findByRole("dialog", { name: "成员" });
  expect(dialog).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "关闭" })).toBeVisible();
  expect(screen.getByText("正在加载成员…")).toBeVisible();
  expect(screen.queryAllByRole("dialog")).toHaveLength(1);
});

test("嵌入成员数据加载失败时仍显示统一成员 Sheet Header", async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response("", { status: 500 })),
  );
  vi.stubGlobal("fetch", fetchMock);

  render(<MemberPageLoader embedded />);

  const dialog = await screen.findByRole("dialog", { name: "成员" });
  expect(dialog).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "关闭" })).toBeVisible();
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "成员列表加载失败",
  );
  expect(screen.queryAllByRole("dialog")).toHaveLength(1);
});

test("普通成员加载成员面板时不请求受保护的邀请状态，也不渲染邀请动作", async () => {
  const members = [
    {
      id: "member-1",
      displayName: "小王",
      role: "MEMBER",
      status: "ACTIVE",
      memberType: "USER",
      avatarPreset: null,
      permissions: { canManage: false },
    },
  ];
  const context = {
    activity: {
      id: "activity-1",
      name: "活动",
      currency: "CNY",
      status: "ACTIVE",
      currentMemberId: "member-1",
      currentMemberStatus: "ACTIVE",
      currentMemberRole: "MEMBER",
    },
    members: [],
    balances: [],
    recommendations: [],
  };
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/members"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: members,
            meta: { inviteMode: "DIRECT_JOIN" },
          }),
        ),
      );
    if (url.endsWith("/settlements/context"))
      return Promise.resolve(new Response(JSON.stringify({ data: context })));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            activityName: "活动",
            startDate: null,
            endDate: null,
            memberCount: 1,
          },
        }),
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemberPageLoader embedded />);
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: /活动成员/ })).toBeVisible(),
  );
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock).not.toHaveBeenCalledWith(
    expect.stringContaining("/invitations/link"),
    expect.anything(),
  );
  expect(
    screen.queryByRole("button", { name: "邀请成员" }),
  ).not.toBeInTheDocument();
});

test("管理员邀请状态读取失败时不显示生成按钮，可重试读取状态", async () => {
  const members = [
    {
      id: "member-1",
      displayName: "管理员",
      role: "ADMIN",
      status: "ACTIVE",
      memberType: "USER",
      avatarPreset: null,
      permissions: { canManage: true },
    },
  ];
  const context = {
    activity: {
      id: "activity-1",
      name: "活动",
      currency: "CNY",
      status: "ACTIVE",
      currentMemberId: "member-1",
      currentMemberStatus: "ACTIVE",
      currentMemberRole: "ADMIN",
    },
    members: [],
    balances: [],
    recommendations: [],
  };
  let inviteReads = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/members"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: members,
            meta: { inviteMode: "DIRECT_JOIN" },
          }),
        ),
      );
    if (url.endsWith("/settlements/context"))
      return Promise.resolve(new Response(JSON.stringify({ data: context })));
    if (url.endsWith("/summary"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              activityName: "活动",
              startDate: null,
              endDate: null,
              memberCount: 1,
            },
          }),
        ),
      );
    inviteReads += 1;
    return Promise.resolve(
      inviteReads === 1
        ? new Response("", { status: 503 })
        : new Response(JSON.stringify({ data: { enabled: true } })),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemberPageLoader embedded />);

  await waitFor(() =>
    expect(screen.getByRole("heading", { name: /活动成员/ })).toBeVisible(),
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "邀请成员" }));
  expect(screen.getByRole("alert")).toHaveTextContent("邀请状态加载失败");
  expect(
    screen.queryByRole("button", { name: "生成邀请链接" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重新加载邀请状态" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "关闭邀请" })).toBeVisible(),
  );
  expect(inviteReads).toBe(2);
});

test("管理员邀请状态读取失败后，重试未完成时仍不显示生成操作", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  const members = [
    {
      id: "owner-1",
      displayName: "Owner",
      role: "OWNER",
      status: "ACTIVE",
      memberType: "USER",
      avatarPreset: null,
      permissions: { canManage: true },
    },
  ];
  const context = {
    activity: {
      id: "activity-1",
      name: "活动",
      currency: "CNY",
      status: "ACTIVE",
      currentMemberId: "owner-1",
      currentMemberStatus: "ACTIVE",
      currentMemberRole: "OWNER",
    },
    members: [],
    balances: [],
    recommendations: [],
  };
  let invitationReads = 0;
  let releaseRetry!: (response: Response) => void;
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/members"))
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: members,
            meta: { inviteMode: "DIRECT_JOIN" },
          }),
        ),
      );
    if (url.endsWith("/settlements/context"))
      return Promise.resolve(new Response(JSON.stringify({ data: context })));
    if (url.endsWith("/invitations/link")) {
      invitationReads += 1;
      if (invitationReads === 1)
        return Promise.resolve(new Response("", { status: 500 }));
      return new Promise<Response>((resolve) => {
        releaseRetry = resolve;
      });
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            activityName: "活动",
            startDate: null,
            endDate: null,
            memberCount: 1,
          },
        }),
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemberPageLoader embedded />);

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "邀请成员" })).toBeVisible(),
  );
  await user.click(screen.getByRole("button", { name: "邀请成员" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "邀请状态加载失败，请重试。",
    ),
  );
  expect(
    screen.queryByRole("button", { name: "生成邀请链接" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重新加载邀请状态" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "重新加载中…" })).toBeDisabled(),
  );
  expect(
    screen.queryByRole("button", { name: "生成邀请链接" }),
  ).not.toBeInTheDocument();

  releaseRetry(
    new Response(JSON.stringify({ data: { enabled: false } }), { status: 200 }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "生成邀请链接" })).toBeVisible(),
  );
});
