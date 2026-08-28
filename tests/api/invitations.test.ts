import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resetLink: vi.fn(),
  disableLink: vi.fn(),
  join: vi.fn(),
  consume: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ user: { id: "alice" } }),
  sessionUserId: vi.fn().mockReturnValue("alice"),
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/maintenance/maintenance-mode", () => ({
  MaintenanceMode: class {
    assertWritesAllowed = vi.fn();
  },
}));
vi.mock("@/server/services/invitation-service", () => ({
  InvitationService: class {
    resetLink = mocks.resetLink;
    disableLink = mocks.disableLink;
    join = mocks.join;
  },
}));
vi.mock("@/server/security/rate-limiter", () => ({
  RateLimiter: class {
    consume = mocks.consume;
  },
}));
vi.mock("@/server/auth/runtime-config", () => ({
  authRuntimeConfig: { secret: "test-secret" },
}));
vi.mock("@/server/security/client-ip", () => ({
  resolveClientIp: vi.fn().mockReturnValue("198.51.100.8"),
}));

import {
  DELETE as disableLink,
  POST as createLink,
} from "@/app/api/activities/[activityId]/invitations/link/route";
import { POST as join } from "@/app/api/invitations/join/route";

it("活动管理者生成高熵邀请链接路径", async () => {
  mocks.resetLink.mockResolvedValueOnce("secure_invite_token_123");
  const response = await createLink(
    new Request("http://localhost/api/activities/activity-1/invitations/link", {
      method: "POST",
    }),
    { params: Promise.resolve({ activityId: "activity-1" }) },
  );

  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    data: { invitePath: "/join/secure_invite_token_123" },
  });
  expect(mocks.resetLink).toHaveBeenCalledWith({
    session: { user: { id: "alice" } },
    activityId: "activity-1",
  });
});

it("活动管理者可以立即关闭当前邀请", async () => {
  const response = await disableLink(
    new Request("http://localhost/api/activities/activity-1/invitations/link", {
      method: "DELETE",
    }),
    { params: Promise.resolve({ activityId: "activity-1" }) },
  );

  expect(response.status).toBe(200);
  expect(mocks.disableLink).toHaveBeenCalledWith({
    session: { user: { id: "alice" } },
    activityId: "activity-1",
  });
});

it("token-only 加入端点只把原始 token 交给邀请服务", async () => {
  mocks.join.mockResolvedValueOnce({
    status: "JOINED",
    activityId: "activity-1",
    memberId: "member-1",
  });
  const response = await join(
    new Request("http://localhost/api/invitations/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteProof: "secure_invite_token_123" }),
    }),
  );

  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({
    data: { status: "JOINED", activityId: "activity-1" },
  });
  expect(mocks.join).toHaveBeenCalledWith({
    session: { user: { id: "alice" } },
    inviteProof: "secure_invite_token_123",
  });
});
