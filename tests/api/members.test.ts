import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const sql = vi.fn();
  Object.assign(sql, {
    begin: vi.fn(async (callback: (transaction: object) => unknown) =>
      callback({}),
    ),
  });
  return {
    sql,
    authorize: vi.fn().mockResolvedValue({
      member: { role: "OWNER", status: "ACTIVE" },
      activity: { status: "ACTIVE" },
    }),
  };
});

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  sessionUserId: vi.fn().mockReturnValue("user-1"),
}));
vi.mock("@/server/db/client", () => ({ sql: mocks.sql }));
vi.mock("@/server/permissions/authorize-activity-operation", () => ({
  authorizeActivityOperation: mocks.authorize,
}));
vi.mock("@/server/http/application-error-response", () => ({
  applicationErrorResponse: vi.fn().mockReturnValue(undefined),
}));

import { GET } from "@/app/api/activities/[activityId]/members/route";

it("成员 GET 为正式成员投影头像预设，并保持临时成员头像为空", async () => {
  mocks.sql
    .mockResolvedValueOnce([
      {
        id: "member-user",
        display_name: "小王",
        role: "OWNER",
        status: "ACTIVE",
        member_type: "USER",
        avatar_preset: 5,
      },
      {
        id: "member-guest",
        display_name: "小李",
        role: "MEMBER",
        status: "ACTIVE",
        member_type: "GUEST",
        avatar_preset: 3,
      },
    ])
    .mockResolvedValueOnce([{ invite_mode: "REQUIRE_APPROVAL" }]);

  const response = await GET(
    new Request("http://localhost/api/activities/activity-1/members"),
    { params: Promise.resolve({ activityId: "activity-1" }) },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: [
      {
        id: "member-user",
        displayName: "小王",
        role: "OWNER",
        status: "ACTIVE",
        memberType: "USER",
        avatarPreset: 5,
        permissions: { canManage: true },
      },
      {
        id: "member-guest",
        displayName: "小李",
        role: "MEMBER",
        status: "ACTIVE",
        memberType: "GUEST",
        avatarPreset: null,
        permissions: { canManage: true },
      },
    ],
    meta: { inviteMode: "REQUIRE_APPROVAL" },
  });
});
