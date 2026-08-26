import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

export type ThemePreference = "SYSTEM" | "LIGHT" | "DARK";

interface AuthSessionRecord {
  readonly id: string;
  readonly token: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

/** 将 Better Auth 内部 Token 投影为可安全返回给客户端的会话元数据。 */
export function redactSessions(sessions: readonly AuthSessionRecord[]) {
  return sessions.map((session) => ({
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
  }));
}

/** 账户资料边界只返回产品 Profile，认证内部邮箱由 Compatibility Layer 隔离。 */
export class MeService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async getProfile(userId: string) {
    const [profile] = await this.sql`
      select username_normalized, nickname, email_kind, theme_preference
      from user_profiles where user_id = ${userId}`;

    if (!profile) {
      throw new ApplicationError("PROFILE_NOT_FOUND", "用户资料不存在。", 404);
    }

    return {
      username: profile.username_normalized,
      nickname: profile.nickname,
      emailBound: profile.email_kind === "REAL",
      themePreference: profile.theme_preference as ThemePreference,
    };
  }

  async updateTheme(userId: string, theme: ThemePreference): Promise<void> {
    await this
      .sql`update user_profiles set theme_preference = ${theme}, updated_at = now()
      where user_id = ${userId}`;
  }

  async updateNickname(userId: string, nickname: string): Promise<void> {
    await this
      .sql`update user_profiles set nickname = ${nickname}, updated_at = now()
      where user_id = ${userId}`;
  }
}
