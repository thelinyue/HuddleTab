import { type Sql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

type ThemePreference = "SYSTEM" | "LIGHT" | "DARK";

/**
 * 已登录账户资料的产品侧读写边界只接触 user_profiles；认证密码、Cookie 与会话令牌始终
 * 留在 Better Auth。读取邮箱时也以 email_kind 为唯一公开开关，避免内部 Synthetic Email
 * 因认证兼容字段意外进入任何账户 API 响应。
 */
export class MeService {
  constructor(private readonly sql: Sql) {}

  async getProfile(userId: string) {
    const [row] = await this.sql<
      {
        usernameNormalized: string;
        nickname: string;
        emailKind: "SYNTHETIC" | "REAL";
        themePreference: ThemePreference;
      }[]
    >`
      select
        username_normalized as "usernameNormalized",
        nickname,
        email_kind as "emailKind",
        theme_preference as "themePreference"
      from user_profiles
      where user_id = ${userId}
    `;
    if (!row) {
      throw new ApplicationError("PROFILE_NOT_FOUND", "用户资料不存在。", 404);
    }

    return {
      username: row.usernameNormalized,
      nickname: row.nickname,
      emailBound: row.emailKind === "REAL",
      themePreference: row.themePreference,
    };
  }

  /**
   * email_kind 只是产品资料标记，异常数据仍可能把内部域名误标为 REAL；因此必须同时确认
   * 邮箱不属于 local.invalid（大小写不敏感）后才公开，任何不一致状态一律安全地视为未绑定。
   */
  async getEmail(userId: string) {
    const [row] = await this.sql<
      { email: string; emailKind: "SYNTHETIC" | "REAL" }[]
    >`
      select u.email, p.email_kind as "emailKind"
      from user_profiles p
      join "user" u on u.id = p.user_id
      where p.user_id = ${userId}
    `;
    if (!row) {
      throw new ApplicationError("PROFILE_NOT_FOUND", "用户资料不存在。", 404);
    }

    return row.emailKind === "REAL" &&
      !row.email.toLowerCase().endsWith("@local.invalid")
      ? { emailBound: true, email: row.email }
      : { emailBound: false };
  }

  async updateTheme(userId: string, theme: ThemePreference): Promise<void> {
    await this.sql`
      update user_profiles
      set theme_preference = ${theme}, updated_at = now()
      where user_id = ${userId}
    `;
  }

  async updateNickname(userId: string, nickname: string): Promise<void> {
    await this.sql`
      update user_profiles
      set nickname = ${nickname}, updated_at = now()
      where user_id = ${userId}
    `;
  }
}
