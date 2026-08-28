// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { InvitationJoin } from "@/features/invitations/components/invitation-join";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const token = "secure_invite_token_123";

test("未登录时保留 token 并跳转登录", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "UNAUTHENTICATED", message: "请登录" },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
  );
  const assign = vi.fn();
  vi.stubGlobal("location", {
    assign,
    replace: vi.fn(),
    origin: "http://localhost",
  });

  render(<InvitationJoin inviteToken={token} />);

  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith(
      "http://localhost/login?callbackURL=%2Fjoin%2Fsecure_invite_token_123",
    ),
  );
});

test.each(["JOINED", "ALREADY_MEMBER"] as const)(
  "%s 状态直接进入活动且不重复显示表单",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            data: { status, activityId: "activity-1", memberId: "member-1" },
          }),
        ),
    );
    const replace = vi.fn();
    vi.stubGlobal("location", {
      assign: vi.fn(),
      replace,
      origin: "http://localhost",
    });

    render(<InvitationJoin inviteToken={token} />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        "http://localhost/activities/activity-1",
      ),
    );
  },
);

test("待审批状态只显示等待结果，不重复创建申请", async () => {
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
  vi.stubGlobal("location", {
    assign: vi.fn(),
    replace: vi.fn(),
    origin: "http://localhost",
  });

  render(<InvitationJoin inviteToken={token} />);

  expect(
    await screen.findByRole("heading", { name: "等待审批" }),
  ).toBeVisible();
  expect(
    screen.getByText("管理员通过后，你会在通知中收到结果。"),
  ).toBeVisible();
});

test("失效邀请显示明确错误且不跳转", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_INVITATION",
            message: "邀请链接无效或已失效。",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  const replace = vi.fn();
  vi.stubGlobal("location", {
    assign: vi.fn(),
    replace,
    origin: "http://localhost",
  });

  render(<InvitationJoin inviteToken={token} />);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "邀请链接无效或已失效。",
  );
  expect(replace).not.toHaveBeenCalled();
});
