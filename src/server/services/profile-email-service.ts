import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

/** 真实邮箱只由兼容层迁移，Synthetic 地址从不作为用户可见资料返回。 */
export class ProfileEmailService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  async bindRealEmail(userId: string, input: string): Promise<void> {
    const email = input.trim().toLowerCase();

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.endsWith("@local.invalid")
    ) {
      throw new ApplicationError(
        "INVALID_REAL_EMAIL",
        "请输入可接收邮件的真实邮箱地址。",
        422,
      );
    }

    await this.sql.begin(async (transaction) => {
      await transaction`update "user" set email = ${email}, email_verified = false, updated_at = now()
        where id = ${userId}`;
      await transaction`update user_profiles set email_kind = 'REAL', updated_at = now()
        where user_id = ${userId}`;
    });
  }
}
