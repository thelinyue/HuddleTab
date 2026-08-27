import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

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
   * 私人部署的首次管理员创建入口。事务锁和 completed_at 共同保证并发提交只能成功一次；
   * 即便没有 Setup Token，创建后的实例也不会再次开放该入口。
   */
  async claim(input: {
    username: string;
    password: string;
    nickname: string;
  }): Promise<void> {
    let createdUserId: string | undefined;

    try {
      await this.sql.begin(async (transaction) => {
        await transaction`select pg_advisory_xact_lock(hashtext('huddletab-setup'))`;
        const [bootstrap] = await transaction`select completed_at
          from system_bootstrap where id = 'singleton' for update`;

        if (bootstrap?.completed_at) {
          throw new ApplicationError(
            "SETUP_COMPLETED",
            "系统管理员已完成初始化。",
            409,
          );
        }

        const created = await this.credentials.create(input);
        createdUserId = created.userId;
        await transaction`insert into system_roles (user_id, role, granted_at)
          values (${created.userId}, 'system_admin', now())`;
        await transaction`update system_bootstrap
          set completed_at = now() where id = 'singleton'`;
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
