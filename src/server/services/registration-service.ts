import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { auth } from "@/server/auth/auth";
import {
  assertRegistrationAllowed,
  type InvitationRegistrationVerifier,
} from "@/server/auth/registration-gate";
import {
  createSyntheticEmail,
  type EmailKind,
} from "@/server/auth/synthetic-email";
import { normalizeUsername } from "@/server/auth/username";
import { getDatabaseClient } from "@/server/db";
import { systemSettings, userProfiles, users } from "@/server/db/schema";

export type RegistrationInput = {
  username: string;
  password: string;
  nickname: string;
  email?: string;
  inviteProof?: string;
};

export type RegisteredUser = {
  id: string;
  username: string;
  nickname: string;
};

/**
 * 账号资料的创建跨越 Better Auth 与产品 profile 两个写入边界。Better Auth 1.7.1 的
 * deleteUser API 只允许当前已登录用户删除自己，不能安全地用于补偿刚注册的指定用户；
 * 因此这里直接删除刚创建的 user 行，并由正式外键级联清理 account、session 及 profile。
 */
async function compensateCreatedAuthUser(
  database: ReturnType<typeof getDatabaseClient>["db"],
  userId: string,
): Promise<void> {
  try {
    const deleted = await database
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (deleted.length !== 1) {
      throw new Error("未找到需要补偿删除的认证账户。");
    }
  } catch (error) {
    throw new Error("注册资料写入失败，且无法清理刚创建的认证账户。", {
      cause: error,
    });
  }
}

/**
 * 把 username-first 产品注册适配到 Better Auth 的 email/password 认证模型。
 * 返回 DTO 只包含可展示的身份资料，绝不返回密码、邀请码证明或内部 synthetic 邮箱。
 */
export class RegistrationService {
  constructor(
    private readonly inviteVerifier: InvitationRegistrationVerifier,
  ) {}

  async register(input: RegistrationInput): Promise<RegisteredUser> {
    const database = getDatabaseClient().db;
    const [settings] = await database
      .select({ registrationPolicy: systemSettings.registrationPolicy })
      .from(systemSettings)
      .where(eq(systemSettings.id, "singleton"));

    if (!settings) {
      throw new Error("系统设置尚未初始化，请先完成数据库迁移。");
    }

    await assertRegistrationAllowed(
      settings.registrationPolicy,
      input.inviteProof,
      this.inviteVerifier,
    );

    const username = normalizeUsername(input.username);
    const realEmail = input.email?.trim().toLowerCase();
    const email = realEmail ?? createSyntheticEmail(randomUUID());
    const emailKind: EmailKind = realEmail ? "REAL" : "SYNTHETIC";
    const nickname = input.nickname.trim();
    const created = await auth.api.signUpEmail({
      body: {
        email,
        password: input.password,
        name: nickname,
        username,
        displayUsername: input.username.trim(),
      },
    });

    try {
      await database.insert(userProfiles).values({
        userId: created.user.id,
        usernameNormalized: username,
        nickname,
        emailKind,
      });
    } catch (profileError) {
      await compensateCreatedAuthUser(database, created.user.id);
      throw profileError;
    }

    return {
      id: created.user.id,
      username,
      nickname,
    };
  }
}
