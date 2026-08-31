// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLandingPreview: vi.fn(),
  getSession: vi.fn(),
  headers: vi.fn(),
  invitationJoin: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/server/auth/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/server/db/client", () => ({ sql: Symbol("sql") }));
vi.mock("@/server/services/invitation-service", () => ({
  InvitationService: class {
    getLandingPreview = mocks.getLandingPreview;
  },
}));
vi.mock("@/features/invitations/components/invitation-join", () => ({
  InvitationJoin: (props: unknown) => {
    mocks.invitationJoin(props);
    return <p>邀请落地页</p>;
  },
}));

import JoinPage from "@/app/join/[inviteToken]/page";

const inviteToken = "secure_invite_token_123";
const preview = {
  activityId: "activity-private",
  activityName: "日本大阪之旅",
  activeMemberCount: 5,
  inviteMode: "DIRECT_JOIN",
  inviterName: "林樾",
  viewerState: "ANONYMOUS",
} as const;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.headers.mockResolvedValue(new Headers({ cookie: "session=value" }));
  mocks.getSession.mockResolvedValue(null);
  mocks.getLandingPreview.mockResolvedValue(preview);
});

test("匿名请求读取当前 Session 和邀请预览，但不向客户端暴露活动 ID", async () => {
  render(
    await JoinPage({
      params: Promise.resolve({ inviteToken }),
    }),
  );

  expect(screen.getByText("邀请落地页")).toBeVisible();
  expect(mocks.getSession).toHaveBeenCalledWith({
    headers: expect.any(Headers),
  });
  expect(mocks.getLandingPreview).toHaveBeenCalledWith({
    inviteProof: inviteToken,
  });
  expect(mocks.invitationJoin).toHaveBeenCalledWith({
    inviteToken,
    landing: {
      activityName: "日本大阪之旅",
      activeMemberCount: 5,
      inviteMode: "DIRECT_JOIN",
      inviterName: "林樾",
      viewerState: "ANONYMOUS",
    },
  });
});

test("认证回跳会重新读取 Session 和成员预览并提供活动入口", async () => {
  mocks.getSession
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ user: { id: "user-1" } });
  mocks.getLandingPreview.mockResolvedValueOnce(preview).mockResolvedValueOnce({
    ...preview,
    viewerState: "MEMBER",
  });

  const first = render(
    await JoinPage({ params: Promise.resolve({ inviteToken }) }),
  );
  first.unmount();
  render(await JoinPage({ params: Promise.resolve({ inviteToken }) }));

  expect(mocks.headers).toHaveBeenCalledTimes(2);
  expect(mocks.getSession).toHaveBeenCalledTimes(2);
  expect(mocks.getLandingPreview).toHaveBeenNthCalledWith(2, {
    inviteProof: inviteToken,
    userId: "user-1",
  });
  expect(mocks.invitationJoin).toHaveBeenLastCalledWith({
    inviteToken,
    landing: {
      activityId: "activity-private",
      activityName: "日本大阪之旅",
      activeMemberCount: 5,
      inviteMode: "DIRECT_JOIN",
      inviterName: "林樾",
      viewerState: "MEMBER",
    },
  });
});

test("畸形邀请参数不读取 Session 或数据库预览", async () => {
  render(
    await JoinPage({
      params: Promise.resolve({ inviteToken: "short" }),
    }),
  );

  expect(mocks.headers).not.toHaveBeenCalled();
  expect(mocks.getSession).not.toHaveBeenCalled();
  expect(mocks.getLandingPreview).not.toHaveBeenCalled();
  expect(mocks.invitationJoin).toHaveBeenCalledWith({
    inviteToken: "short",
    landing: null,
  });
});
