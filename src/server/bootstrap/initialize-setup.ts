import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { auth } from "@/server/auth/auth";
import { createSyntheticEmail } from "@/server/auth/synthetic-email";
import { normalizeUsername } from "@/server/auth/username";
import { db, sql } from "@/server/db/client";
import { userProfiles, users } from "@/server/db/schema";
import {
  SetupService,
  type SetupCredentialCreator,
} from "@/server/services/setup-service";

const setupCredentials: SetupCredentialCreator = {
  async create(input) {
    const normalizedUsername = normalizeUsername(input.username);
    const created = await auth.api.signUpEmail({
      body: {
        email: createSyntheticEmail(randomUUID()),
        password: input.password,
        name: input.nickname,
        username: normalizedUsername,
        displayUsername: input.username.trim(),
      },
    });

    try {
      await db.insert(userProfiles).values({
        userId: created.user.id,
        usernameNormalized: normalizedUsername,
        nickname: input.nickname,
        emailKind: "SYNTHETIC",
      });
    } catch (error) {
      await db
        .delete(users)
        .where(eq(users.id, created.user.id))
        .catch(() => undefined);
      throw error;
    }

    return { userId: created.user.id };
  },
  async compensate(userId) {
    await db.delete(users).where(eq(users.id, userId));
  },
};

export function createSetupService(): SetupService {
  return new SetupService(sql, setupCredentials);
}

/** 仅在容器启动阶段调用；明文 Setup Token 只会输出到当前容器日志一次。 */
export async function initializeSetup(): Promise<void> {
  const token = await createSetupService().rotateForUninitializedStartup();

  if (token) {
    console.warn(
      "伙记尚未初始化。Setup Token 仅在本次容器启动输出一次，请仅由部署管理员查看：%s",
      token,
    );
  }
}
