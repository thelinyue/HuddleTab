import type { Sql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

const REAL_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 真实邮箱绑定只更新认证 user 与产品 profile 的邮箱身份字段。两项写入置于同一事务，
 * 确保不会出现 user 已改为真实邮箱、profile 仍为 SYNTHETIC 的不一致状态。
 */
export class ProfileEmailService {
  constructor(private readonly sql: Sql) {}

  async bindRealEmail(userId: string, input: string): Promise<void> {
    const email = input.trim().toLowerCase();

    if (!REAL_EMAIL_PATTERN.test(email) || email.endsWith("@local.invalid")) {
      throw new ApplicationError(
        "INVALID_REAL_EMAIL",
        "请输入可接收邮件的真实邮箱地址。",
        422,
      );
    }

    await this.sql.begin(async (transaction) => {
      await transaction`
        update "user"
        set email = ${email}, email_verified = false, updated_at = now()
        where id = ${userId}
      `;
      await transaction`
        update user_profiles
        set email_kind = 'REAL', updated_at = now()
        where user_id = ${userId}
      `;
    });
  }
}
