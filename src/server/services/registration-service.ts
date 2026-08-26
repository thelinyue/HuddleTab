import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import {
  assertRegistrationAllowed,
  type InvitationRegistrationVerifier,
} from "@/server/auth/registration-gate";
import { createSyntheticEmail } from "@/server/auth/synthetic-email";
import { normalizeUsername } from "@/server/auth/username";
import type { db as applicationDatabase } from "@/server/db/client";
import { systemSettings, userProfiles, users } from "@/server/db/schema";
import { ApplicationError } from "@/server/errors/application-error";

interface CredentialRegistrationApi {
  signUpEmail(input: {
    body: {
      email: string;
      password: string;
      name: string;
      username: string;
      displayUsername: string;
    };
  }): Promise<{ user: { id: string } }>;
}

interface RegistrationDependencies {
  readonly database: typeof applicationDatabase;
  readonly credentials: CredentialRegistrationApi;
}

export interface RegistrationInput {
  readonly username: string;
  readonly password: string;
  readonly nickname: string;
  readonly email?: string;
  readonly inviteProof?: string;
}

/**
 * 前端始终提交 username；只有本服务知道 Better Auth 的邮箱兼容入口。
 * Better Auth 创建凭证与 Profile 写入无法伪装成单一事务，故 Profile 失败时删除
 * 新建 User，让外键级联清理其 Account 与 Session，避免留下无法完成注册的孤儿账号。
 */
export class RegistrationService {
  constructor(
    private readonly inviteVerifier: InvitationRegistrationVerifier,
    private readonly dependencies: RegistrationDependencies,
  ) {}

  async register(input: RegistrationInput) {
    const [settings] = await this.dependencies.database
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.id, "singleton"));

    if (!settings) {
      throw new ApplicationError(
        "SYSTEM_SETTINGS_MISSING",
        "系统设置未完成初始化，请管理员执行数据库迁移后重试。",
        503,
      );
    }

    await assertRegistrationAllowed(
      settings.registrationPolicy,
      input.inviteProof,
      this.inviteVerifier,
    );

    const normalizedUsername = normalizeUsername(input.username);
    const suppliedEmail = input.email?.trim().toLowerCase();
    const email = suppliedEmail || createSyntheticEmail(randomUUID());
    const created = await this.dependencies.credentials.signUpEmail({
      body: {
        email,
        password: input.password,
        name: input.nickname,
        username: normalizedUsername,
        displayUsername: input.username.trim(),
      },
    });

    try {
      await this.dependencies.database.insert(userProfiles).values({
        userId: created.user.id,
        usernameNormalized: normalizedUsername,
        nickname: input.nickname,
        emailKind: suppliedEmail ? "REAL" : "SYNTHETIC",
      });
    } catch (error) {
      await this.dependencies.database
        .delete(users)
        .where(eq(users.id, created.user.id))
        .catch(() => undefined);
      throw error;
    }

    return {
      id: created.user.id,
      username: normalizedUsername,
      nickname: input.nickname,
    };
  }
}
