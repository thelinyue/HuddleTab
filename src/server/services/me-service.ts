import type postgres from "postgres";

import type { AvatarPreset } from "@/features/me/avatar-presets";
import { ApplicationError } from "@/server/errors/application-error";

export type ThemePreference = "SYSTEM" | "LIGHT" | "DARK";

export interface UpdateProfileInput {
  readonly nickname: string;
  readonly avatarPreset?: AvatarPreset;
}

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
      select profile.username_normalized, profile.nickname, profile.email_kind, profile.avatar_preset, profile.theme_preference,
        account.email, account.email_verified,
        exists(select 1 from system_roles role where role.user_id = profile.user_id and role.role = 'system_admin') as is_system_admin
      from user_profiles profile
      left join "user" account on account.id = profile.user_id and profile.email_kind = 'REAL'
      where profile.user_id = ${userId}`;

    if (!profile) {
      throw new ApplicationError("PROFILE_NOT_FOUND", "用户资料不存在。", 404);
    }

    return {
      username: profile.username_normalized,
      nickname: profile.nickname,
      emailBound: profile.email_kind === "REAL",
      // 兼容层禁止 Synthetic Email 离开数据库查询边界，认证状态只认 Better Auth 实际字段。
      maskedEmail:
        profile.email_kind === "REAL" && profile.email
          ? maskEmail(profile.email)
          : null,
      emailVerified:
        profile.email_kind === "REAL" && profile.email_verified === true,
      avatarPreset: profile.avatar_preset as AvatarPreset | null,
      themePreference: profile.theme_preference as ThemePreference,
      isSystemAdmin: profile.is_system_admin,
    };
  }

  async updateTheme(userId: string, theme: ThemePreference): Promise<void> {
    await this
      .sql`update user_profiles set theme_preference = ${theme}, updated_at = now()
      where user_id = ${userId}`;
  }

  /** 未传头像时只写昵称，保证旧客户端 PATCH 不会把历史头像置空。 */
  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<void> {
    if (input.avatarPreset === undefined) {
      await this
        .sql`update user_profiles set nickname = ${input.nickname}, updated_at = now()
        where user_id = ${userId}`;
      return;
    }

    await this
      .sql`update user_profiles set nickname = ${input.nickname}, avatar_preset = ${input.avatarPreset}, updated_at = now()
      where user_id = ${userId}`;
  }
}

/** 真实邮箱只保留本地部分首字符和完整域名，调用方没有获取明文的机会。 */
function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  return `${localPart[0]}***@${domain}`;
}
