import { beforeEach, expect, it, vi } from "vitest";

import { ApplicationError } from "@/server/errors/application-error";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  requireSession: vi.fn(),
  sessionUserId: vi.fn(),
  sessionId: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: mocks.requireSession,
  sessionUserId: mocks.sessionUserId,
  sessionId: mocks.sessionId,
}));
vi.mock("@/server/auth/auth", () => ({
  auth: { api: mocks },
}));
vi.mock("@/server/db/client", () => ({ sql: {} }));
vi.mock("@/server/services/me-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/me-service")>()),
  MeService: class {
    getProfile = mocks.getProfile;
    updateProfile = mocks.updateProfile;
  },
}));

import { GET as GET_PROFILE, PATCH } from "@/app/api/me/profile/route";
import { DELETE, GET as GET_SESSIONS } from "@/app/api/me/sessions/route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({
    user: { id: "user-1" },
    session: { id: "current-session" },
  });
  mocks.sessionUserId.mockReturnValue("user-1");
  mocks.sessionId.mockReturnValue("current-session");
});

it("列出会话时不暴露 Better Auth Token", async () => {
  mocks.listSessions.mockResolvedValue([
    {
      id: "other-session",
      token: "internal-token",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  ]);

  const response = await GET_SESSIONS(
    new Request("http://localhost/api/me/sessions"),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: [
      {
        id: "other-session",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-02-01T00:00:00.000Z",
        ipAddress: null,
        userAgent: null,
      },
    ],
  });
});

it("仅撤销当前用户已列出的目标会话", async () => {
  mocks.listSessions.mockResolvedValue([
    { id: "current-session", token: "current-token" },
    { id: "other-session", token: "target-token" },
  ]);
  mocks.revokeSession.mockResolvedValue({ status: true });

  const response = await DELETE(
    new Request("http://localhost/api/me/sessions?sessionId=other-session"),
  );

  expect(response.status).toBe(204);
  expect(mocks.revokeSession).toHaveBeenCalledWith({
    headers: expect.any(Headers),
    body: { token: "target-token" },
  });
});

it("资料 PATCH 保持仅昵称请求的兼容性", async () => {
  mocks.updateProfile.mockResolvedValue(undefined);

  const response = await PATCH(
    new Request("http://localhost/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ nickname: "新昵称" }),
    }),
  );

  expect(response.status).toBe(204);
  expect(mocks.updateProfile).toHaveBeenCalledWith("user-1", {
    nickname: "新昵称",
  });
});

it("资料 PATCH 拒绝范围外的头像预设", async () => {
  const response = await PATCH(
    new Request("http://localhost/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ nickname: "新昵称", avatarPreset: 7 }),
    }),
  );

  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({
    error: {
      code: "VALIDATION_ERROR",
      message: "个人资料请求不合法，请检查后重试。",
      fieldErrors: { avatarPreset: ["头像预设仅支持 1 至 6。"] },
      details: {},
    },
  });
  expect(mocks.updateProfile).not.toHaveBeenCalled();
});

it("资料 PATCH 将合法头像预设原样交给资料服务", async () => {
  mocks.updateProfile.mockResolvedValue(undefined);

  const response = await PATCH(
    new Request("http://localhost/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ nickname: "新昵称", avatarPreset: 5 }),
    }),
  );

  expect(response.status).toBe(204);
  expect(mocks.updateProfile).toHaveBeenCalledWith("user-1", {
    nickname: "新昵称",
    avatarPreset: 5,
  });
});

it.each([
  ["GET", () => GET_PROFILE(new Request("http://localhost/api/me/profile"))],
  [
    "PATCH",
    () =>
      PATCH(
        new Request("http://localhost/api/me/profile", {
          method: "PATCH",
          body: JSON.stringify({ nickname: "新昵称" }),
        }),
      ),
  ],
])("资料 %s 将未认证错误转换为中文 401 JSON", async (_method, request) => {
  mocks.requireSession.mockRejectedValue(
    new ApplicationError(
      "UNAUTHENTICATED",
      "登录状态已失效，请重新登录。",
      401,
    ),
  );

  const response = await request();

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({
    error: {
      code: "UNAUTHENTICATED",
      message: "登录状态已失效，请重新登录。",
      fieldErrors: {},
      details: {},
    },
  });
});

it("资料 GET 将资料缺失转换为中文 404 JSON", async () => {
  mocks.getProfile.mockRejectedValue(
    new ApplicationError("PROFILE_NOT_FOUND", "用户资料不存在。", 404),
  );

  const response = await GET_PROFILE(
    new Request("http://localhost/api/me/profile"),
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: {
      code: "PROFILE_NOT_FOUND",
      message: "用户资料不存在。",
      fieldErrors: {},
      details: {},
    },
  });
});

it("资料 GET 不吞掉未知异常", async () => {
  const databaseError = new Error("database unavailable");
  mocks.getProfile.mockRejectedValue(databaseError);

  await expect(
    GET_PROFILE(new Request("http://localhost/api/me/profile")),
  ).rejects.toBe(databaseError);
});
