import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  requireSession: vi.fn().mockResolvedValue({
    user: { id: "user-1" },
    session: { id: "current-session" },
  }),
  sessionId: vi.fn().mockReturnValue("current-session"),
}));
vi.mock("@/server/auth/auth", () => ({
  auth: { api: mocks },
}));

import { DELETE, GET } from "@/app/api/me/sessions/route";

it("列出会话时不暴露 Better Auth Token", async () => {
  mocks.listSessions.mockResolvedValue([
    {
      id: "other-session",
      token: "internal-token",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  ]);

  const response = await GET(new Request("http://localhost/api/me/sessions"));

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
