import postgres, { type Sql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

const REAL_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUserEmailUniqueViolation(error: unknown): boolean {
  return (
    error instanceof postgres.PostgresError &&
    error.code === "23505" &&
    error.constraint_name === "user_email_unique"
  );
}

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

    try {
      await this.sql.begin(async (transaction) => {
        const userUpdate = await transaction`
          update "user"
          set email = ${email}, email_verified = false, updated_at = now()
          where id = ${userId}
        `;
        if (userUpdate.count !== 1) {
          throw new Error("未找到需要绑定邮箱的用户。");
        }

        const profileUpdate = await transaction`
          update user_profiles
          set email_kind = 'REAL', updated_at = now()
          where user_id = ${userId}
        `;
        if (profileUpdate.count !== 1) {
          throw new Error("用户资料缺失，无法绑定真实邮箱。");
        }
      });
    } catch (error) {
      if (isUserEmailUniqueViolation(error)) {
        throw new ApplicationError(
          "EMAIL_ALREADY_REGISTERED",
          "该邮箱已注册，请使用其他邮箱。",
          409,
        );
      }
      throw error;
    }
  }
}
