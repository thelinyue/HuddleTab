import { expect, it } from "vitest";

import { MeService, redactSessions } from "@/server/services/me-service";

it("返回 Profile DTO 时绝不暴露 Synthetic Email", async () => {
  const sql = (async () => [
    {
      username_normalized: "alice",
      nickname: "Alice",
      email_kind: "SYNTHETIC",
      avatar_preset: 2,
      theme_preference: "SYSTEM",
      is_system_admin: false,
    },
  ]) as never;

  await expect(new MeService(sql).getProfile("user-1")).resolves.toEqual({
    username: "alice",
    nickname: "Alice",
    emailBound: false,
    maskedEmail: null,
    emailVerified: false,
    avatarPreset: 2,
    themePreference: "SYSTEM",
    isSystemAdmin: false,
  });
});

it("返回真实邮箱的脱敏地址和认证状态", async () => {
  const sql = (async () => [
    {
      username_normalized: "alice",
      nickname: "Alice",
      email_kind: "REAL",
      email: "alice@example.com",
      email_verified: true,
      avatar_preset: 4,
      theme_preference: "SYSTEM",
      is_system_admin: false,
    },
  ]) as never;

  await expect(new MeService(sql).getProfile("user-1")).resolves.toEqual({
    username: "alice",
    nickname: "Alice",
    emailBound: true,
    maskedEmail: "a***@example.com",
    emailVerified: true,
    avatarPreset: 4,
    themePreference: "SYSTEM",
    isSystemAdmin: false,
  });
});

it("真实邮箱未验证时不把邮箱绑定状态当作认证状态", async () => {
  const sql = (async () => [
    {
      username_normalized: "alice",
      nickname: "Alice",
      email_kind: "REAL",
      email: "alice@example.com",
      email_verified: false,
      avatar_preset: 4,
      theme_preference: "SYSTEM",
      is_system_admin: false,
    },
  ]) as never;

  await expect(new MeService(sql).getProfile("user-1")).resolves.toMatchObject({
    emailBound: true,
    maskedEmail: "a***@example.com",
    emailVerified: false,
  });
});

it("昵称更新不改写已有头像", async () => {
  const statements: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    statements.push(strings.join("?"));
    return Promise.resolve([]);
  }) as never;

  await new MeService(sql).updateProfile("user-1", { nickname: "新昵称" });

  expect(statements).toHaveLength(1);
  expect(statements[0]).toContain("update user_profiles set nickname = ?");
  expect(statements[0]).not.toContain("avatar_preset");
});

it("昵称更新可以同时保存头像预设", async () => {
  const statements: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    statements.push(strings.join("?"));
    return Promise.resolve([]);
  }) as never;

  await new MeService(sql).updateProfile("user-1", {
    nickname: "新昵称",
    avatarPreset: 5,
  });

  expect(statements).toHaveLength(1);
  expect(statements[0]).toContain(
    "update user_profiles set nickname = ?, avatar_preset = ?",
  );
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
