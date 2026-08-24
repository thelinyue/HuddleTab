import { randomUUID } from "node:crypto";
import { isAPIError } from "@better-auth/core/utils/is-api-error";
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
import { ApplicationError } from "@/server/errors/application-error";

export type RegistrationInput = {
  username: string;
  password: string;
  nickname: string;
  email?: string;
  inviteProof?: string;
};

export type SetupCredentialInput = Pick<
  RegistrationInput,
  "username" | "password" | "nickname"
>;

export type RegisteredUser = {
  id: string;
  username: string;
  nickname: string;
};

export type RegistrationResult = {
  user: RegisteredUser;
  headers: Headers;
};

export type SetupCredentialResult = {
  userId: string;
  headers: Headers;
};

type CredentialInput = SetupCredentialInput & {
  email: string;
  emailKind: EmailKind;
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
    throw new Error("认证资料写入失败，且无法清理刚创建的认证账户。", {
      cause: error,
    });
  }
}

/** 仅映射 Better Auth 1.7.1 已知的注册唯一约束；其他底层错误必须保持原样抛出。 */
function mapKnownSignUpConflict(error: unknown): ApplicationError | undefined {
  if (!isAPIError(error) || typeof error.body?.code !== "string") {
    return undefined;
  }

  if (error.body.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
    return new ApplicationError(
      "EMAIL_ALREADY_REGISTERED",
      "该邮箱已注册，请使用其他邮箱。",
      409,
    );
  }

  if (error.body.code === "USERNAME_IS_ALREADY_TAKEN") {
    return new ApplicationError(
      "USERNAME_ALREADY_TAKEN",
      "该用户名已被占用，请使用其他用户名。",
      409,
    );
  }

  return undefined;
}

/**
 * 统一执行 Better Auth 凭据与 profile 写入。成功后才将 headers 交给调用方，确保后续
 * route 只会在完整业务写入成功时转发自动登录 Cookie。
 */
async function createCredentialWithProfile(
  input: CredentialInput,
): Promise<SetupCredentialResult & RegisteredUser> {
  const database = getDatabaseClient().db;
  const username = normalizeUsername(input.username);
  const nickname = input.nickname.trim();
  const signUp = () =>
    auth.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: nickname,
        username,
        displayUsername: input.username.trim(),
      },
      returnHeaders: true,
    });
  let signedUp: Awaited<ReturnType<typeof signUp>>;
  try {
    signedUp = await signUp();
  } catch (error) {
    const conflict = mapKnownSignUpConflict(error);
    if (conflict) throw conflict;
    throw error;
  }

  const created = signedUp.response;
  try {
    await database.insert(userProfiles).values({
      userId: created.user.id,
      usernameNormalized: username,
      nickname,
      emailKind: input.emailKind,
    });
  } catch (profileError) {
    await compensateCreatedAuthUser(database, created.user.id);
    throw profileError;
  }

  return {
    userId: created.user.id,
    id: created.user.id,
    username,
    nickname,
    headers: signedUp.headers,
  };
}

/** Setup 仅绕过邀请注册门禁，仍使用同一用户名、密码、昵称与 Synthetic Email 兼容层。 */
export async function createSetupCredentialUser(
  input: SetupCredentialInput,
): Promise<SetupCredentialResult> {
  const result = await createCredentialWithProfile({
    ...input,
    email: createSyntheticEmail(randomUUID()),
    emailKind: "SYNTHETIC",
  });
  return { userId: result.userId, headers: result.headers };
}

/** 仅供 SetupService 在角色/bootstrap 事务失败后清理本次刚创建的账号。 */
export async function compensateSetupCredentialUser(
  userId: string,
): Promise<void> {
  await compensateCreatedAuthUser(getDatabaseClient().db, userId);
}

/**
 * 把 username-first 产品注册适配到 Better Auth 的 email/password 认证模型。
 * 只有 profile 成功创建后才返回 Better Auth 的 Set-Cookie，避免补偿失败的账号产生可用会话。
 */
export class RegistrationService {
  constructor(
    private readonly inviteVerifier: InvitationRegistrationVerifier,
  ) {}

  async register(input: RegistrationInput): Promise<RegistrationResult> {
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

    const realEmail = input.email?.trim().toLowerCase();
    const result = await createCredentialWithProfile({
      username: input.username,
      password: input.password,
      nickname: input.nickname,
      email: realEmail ?? createSyntheticEmail(randomUUID()),
      emailKind: realEmail ? "REAL" : "SYNTHETIC",
    });

    return {
      user: {
        id: result.id,
        username: result.username,
        nickname: result.nickname,
      },
      headers: result.headers,
    };
  }
}
