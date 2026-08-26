import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

const tokenDigest = (token: string): Buffer =>
  createHash("sha256").update(token, "utf8").digest();

export interface SetupCredentialCreator {
  create(input: {
    username: string;
    password: string;
    nickname: string;
  }): Promise<{ userId: string }>;
  compensate(userId: string): Promise<void>;
}

export class SetupService {
  constructor(
    private readonly sql: ReturnType<typeof postgres>,
    private readonly credentials: SetupCredentialCreator,
  ) {}

  /**
   * 事务级 advisory lock 保证未初始化实例并发启动时只保留一个当前 Token。
   * 明文仅返回给启动器输出一次；数据库始终只保存不可逆 Hash。
   */
  async rotateForUninitializedStartup(): Promise<string | null> {
    return this.sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtext('huddletab-setup'))`;
      const admins =
        await transaction`select 1 from system_roles where role = 'system_admin' limit 1`;

      if (admins.length > 0) {
        await transaction`update system_bootstrap
          set setup_token_hash = null, completed_at = coalesce(completed_at, now())
          where id = 'singleton'`;
        return null;
      }

      const token = randomBytes(32).toString("base64url");
      await transaction`update system_bootstrap
        set setup_token_hash = ${tokenDigest(token).toString("base64url")}, generated_at = now(), completed_at = null
        where id = 'singleton'`;
      return token;
    });
  }

  async claim(
    token: string,
    input: { username: string; password: string; nickname: string },
  ): Promise<void> {
    let createdUserId: string | undefined;

    try {
      await this.sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtext('huddletab-setup'))`;
        const [bootstrap] =
          await transaction`select setup_token_hash, completed_at
          from system_bootstrap where id = 'singleton' for update`;
        const suppliedDigest = tokenDigest(token);
        const storedDigest = bootstrap?.setup_token_hash
          ? Buffer.from(bootstrap.setup_token_hash, "base64url")
          : Buffer.alloc(0);

        if (
          bootstrap?.completed_at ||
          storedDigest.length !== suppliedDigest.length ||
          !timingSafeEqual(storedDigest, suppliedDigest)
        ) {
          throw new ApplicationError(
            "INVALID_SETUP_TOKEN",
            "初始化口令无效或已失效。",
            403,
          );
        }

        const created = await this.credentials.create(input);
        createdUserId = created.userId;
        await transaction`insert into system_roles (user_id, role, granted_at)
          values (${created.userId}, 'system_admin', now())`;
        await transaction`update system_bootstrap
          set setup_token_hash = null, completed_at = now() where id = 'singleton'`;
      });
    } catch (error) {
      if (createdUserId) {
        await this.credentials
          .compensate(createdUserId)
          .catch((cleanupError) =>
            console.error(
              "首次初始化回滚失败，检测到未完成的凭证账号，请管理员检查后重试。",
              cleanupError,
            ),
          );
      }
      throw error;
    }
  }
}
