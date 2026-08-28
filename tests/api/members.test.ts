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

it("成员 GET 保留 data 数组并返回活动邀请模式元数据", async () => {
  mocks.sql
    .mockResolvedValueOnce([
      {
        id: "member-1",
        display_name: "小王",
        role: "OWNER",
        status: "ACTIVE",
        member_type: "USER",
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
        id: "member-1",
        displayName: "小王",
        role: "OWNER",
        status: "ACTIVE",
        memberType: "USER",
        permissions: { canManage: true },
      },
    ],
    meta: { inviteMode: "REQUIRE_APPROVAL" },
  });
});
