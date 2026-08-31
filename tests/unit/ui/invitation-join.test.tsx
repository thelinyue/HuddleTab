// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import {
  InvitationJoin,
  type InvitationLandingData,
} from "@/features/invitations/components/invitation-join";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const token = "secure_invite_token_123";
const commonLanding = {
  activityName: "日本大阪之旅",
  activeMemberCount: 5,
  inviterName: "林樾",
} as const;

function landing(
  viewerState: "ANONYMOUS" | "CAN_JOIN" | "PENDING_APPROVAL",
  inviteMode: "DIRECT_JOIN" | "REQUIRE_APPROVAL" = "DIRECT_JOIN",
): InvitationLandingData {
  return { ...commonLanding, inviteMode, viewerState };
}

test.each([
  ["DIRECT_JOIN", "注册并加入"],
  ["REQUIRE_APPROVAL", "注册并申请加入"],
] as const)(
  "未登录的 %s 邀请先展示上下文和准确注册入口",
  (inviteMode, label) => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <InvitationJoin
        inviteToken={token}
        landing={landing("ANONYMOUS", inviteMode)}
      />,
    );

    expect(screen.getByRole("heading", { name: "日本大阪之旅" })).toBeVisible();
    expect(screen.getByText("5 人 · 进行中")).toBeVisible();
    expect(screen.getByText("邀请人")).toBeVisible();
    expect(screen.getByText("林樾")).toBeVisible();
    expect(document.querySelector('img[src*="auth-hero.webp"]')).toBeVisible();
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      "/register?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
    );
    expect(
      screen.getByRole("link", { name: "已有账号？登录" }),
    ).toHaveAttribute(
      "href",
      "/login?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test.each([
  ["DIRECT_JOIN", "加入活动"],
  ["REQUIRE_APPROVAL", "申请加入"],
] as const)("已登录的 %s 邀请等待用户点击后才提交", (inviteMode, label) => {
  const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <InvitationJoin
      inviteToken={token}
      landing={landing("CAN_JOIN", inviteMode)}
    />,
  );

  expect(screen.getByRole("button", { name: label })).toBeEnabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("点击加入后禁用按钮，成功时进入活动", async () => {
  const user = userEvent.setup();
  let resolveJoin: ((response: Response) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveJoin = resolve;
        }),
    ),
  );
  const replace = vi.fn();
  vi.stubGlobal("location", {
    assign: vi.fn(),
    href: "http://localhost/",
    replace,
    origin: "http://localhost",
  });

  render(<InvitationJoin inviteToken={token} landing={landing("CAN_JOIN")} />);
  await user.click(screen.getByRole("button", { name: "加入活动" }));

  expect(screen.getByRole("button", { name: "正在加入" })).toBeDisabled();
  resolveJoin?.(
    Response.json({
      data: {
        status: "JOINED",
        activityId: "activity-1",
        memberId: "member-1",
      },
    }),
  );
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      "http://localhost/activities/activity-1",
    ),
  );
});

test("并发加入已完成时仍进入服务端返回的活动", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        data: {
          status: "ALREADY_MEMBER",
          activityId: "activity-existing",
          memberId: "member-existing",
        },
      }),
    ),
  );
  const replace = vi.fn();
  vi.stubGlobal("location", {
    assign: vi.fn(),
    href: "http://localhost/",
    replace,
    origin: "http://localhost",
  });

  render(
    <InvitationJoin inviteToken={token} landing={landing("CAN_JOIN")} />,
  );
  await user.click(screen.getByRole("button", { name: "加入活动" }));

  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(
      "http://localhost/activities/activity-existing",
    ),
  );
});

test("提交审批后显示等待状态且不再提供重复提交", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        data: {
          status: "PENDING_APPROVAL",
          activityId: "activity-1",
          requestId: "request-1",
        },
      }),
    ),
  );

  render(
    <InvitationJoin
      inviteToken={token}
      landing={landing("CAN_JOIN", "REQUIRE_APPROVAL")}
    />,
  );
  await user.click(screen.getByRole("button", { name: "申请加入" }));

  expect(
    await screen.findByRole("heading", { name: "申请已提交" }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "申请加入" })).toBeNull();
  expect(screen.getByRole("link", { name: "返回活动列表" })).toHaveAttribute(
    "href",
    "/activities",
  );
});

test("已有待审批申请直接显示等待状态", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(
    <InvitationJoin
      inviteToken={token}
      landing={landing("PENDING_APPROVAL", "REQUIRE_APPROVAL")}
    />,
  );

  expect(screen.getByRole("heading", { name: "申请已提交" })).toBeVisible();
  expect(screen.getByText("等待活动管理员审批。")).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});

test("已有成员直接进入活动且不调用加入端点", () => {
  vi.stubGlobal("fetch", vi.fn());
  render(
    <InvitationJoin
      inviteToken={token}
      landing={{
        ...commonLanding,
        inviteMode: "DIRECT_JOIN",
        viewerState: "MEMBER",
        activityId: "activity-1",
      }}
    />,
  );

  expect(screen.getByRole("link", { name: "进入活动" })).toHaveAttribute(
    "href",
    "/activities/activity-1",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("提交时会话失效则保留邀请上下文回到登录页", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: "UNAUTHENTICATED", message: "请重新登录" } },
          { status: 401 },
        ),
      ),
  );
  const assign = vi.fn();
  vi.stubGlobal("location", {
    assign,
    href: "http://localhost/",
    replace: vi.fn(),
    origin: "http://localhost",
  });

  render(<InvitationJoin inviteToken={token} landing={landing("CAN_JOIN")} />);
  await user.click(screen.getByRole("button", { name: "加入活动" }));

  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith(
      "http://localhost/login?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
    ),
  );
});

test("重复点击加入只提交一次请求", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetchMock);

  render(<InvitationJoin inviteToken={token} landing={landing("CAN_JOIN")} />);
  await user.dblClick(screen.getByRole("button", { name: "加入活动" }));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "正在加入" })).toBeDisabled();
});

test("服务端判定邀请失效后不沿用旧预览", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "INVALID_INVITATION",
            message: "邀请链接刚刚被关闭，请联系邀请人获取新链接。",
          },
        },
        { status: 403 },
      ),
    ),
  );

  render(<InvitationJoin inviteToken={token} landing={landing("CAN_JOIN")} />);
  await user.click(screen.getByRole("button", { name: "加入活动" }));

  expect(
    await screen.findByRole("heading", { name: "无法加入活动" }),
  ).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "邀请链接刚刚被关闭，请联系邀请人获取新链接。",
  );
  expect(screen.queryByRole("heading", { name: "日本大阪之旅" })).toBeNull();
  expect(screen.queryByRole("button", { name: "加入活动" })).toBeNull();
});

test("可重试错误显示服务端信息并恢复加入按钮", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "请求过于频繁，请稍后重试。",
          },
        },
        { status: 429 },
      ),
    ),
  );

  render(<InvitationJoin inviteToken={token} landing={landing("CAN_JOIN")} />);
  await user.click(screen.getByRole("button", { name: "加入活动" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "请求过于频繁，请稍后重试。",
  );
  expect(screen.getByRole("button", { name: "加入活动" })).toBeEnabled();
});

test("网络异常显示中文提示并恢复加入按钮", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );

  render(
    <InvitationJoin inviteToken={token} landing={landing("CAN_JOIN")} />,
  );
  await user.click(screen.getByRole("button", { name: "加入活动" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "加入活动失败，请检查网络后重试。",
  );
  expect(screen.getByRole("button", { name: "加入活动" })).toBeEnabled();
});

test("失效邀请显示明确错误且不提供认证或加入操作", () => {
  render(<InvitationJoin inviteToken={token} landing={null} />);

  expect(screen.getByRole("heading", { name: "无法加入活动" })).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "邀请链接无效或已失效，请联系邀请人获取新链接。",
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("link", { name: /加入|登录/ })).toBeNull();
});
