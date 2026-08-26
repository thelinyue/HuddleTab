import { expect, it } from "vitest";

import { MeService, redactSessions } from "@/server/services/me-service";

it("返回 Profile DTO 时绝不暴露 Synthetic Email", async () => {
  const sql = (async () => [
    {
      username_normalized: "alice",
      nickname: "Alice",
      email_kind: "SYNTHETIC",
      theme_preference: "SYSTEM",
    },
  ]) as never;

  await expect(new MeService(sql).getProfile("user-1")).resolves.toEqual({
    username: "alice",
    nickname: "Alice",
    emailBound: false,
    themePreference: "SYSTEM",
  });
});

it("会话 DTO 不返回 Better Auth Token", () => {
  expect(
    redactSessions([
      {
        id: "session-1",
        token: "secret-session-token",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: new Date("2026-02-01T00:00:00.000Z"),
        ipAddress: "127.0.0.1",
        userAgent: "test-agent",
      },
    ]),
  ).toEqual([
    {
      id: "session-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-02-01T00:00:00.000Z",
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
    },
  ]);
});
