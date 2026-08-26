import type postgres from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

/**
 * 所有会影响系统管理员登录能力的写入都必须通过此服务。
 * 锁与计数在同一事务中执行，不能仅依赖管理界面的禁用按钮。
 */
export class SystemAdminService {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  private async assertAdminRemains(
    transaction: postgres.TransactionSql,
    targetUserId: string,
  ): Promise<void> {
    await transaction`select pg_advisory_xact_lock(hashtext('huddletab-system-admin-invariant'))`;
    const [target] = await transaction`
      select 1 from system_roles where user_id = ${targetUserId} and role = 'system_admin'`;
    if (!target) return;

    const [remaining] = await transaction`
      select count(distinct sr.user_id)::int as count
      from system_roles sr
      join user_profiles up on up.user_id = sr.user_id and up.disabled_at is null
      join account a on a.user_id = sr.user_id and a.provider_id = 'credential' and a.password is not null
      where sr.role = 'system_admin' and sr.user_id <> ${targetUserId}`;
    if ((remaining?.count ?? 0) < 1) {
      throw new ApplicationError(
        "LAST_ACTIVE_ADMIN",
        "系统必须至少保留一个能够正常登录的系统管理员。",
        409,
      );
    }
  }

  async disableUser(userId: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await this.assertAdminRemains(transaction, userId);
      await transaction`update user_profiles set disabled_at = now(), updated_at = now() where user_id = ${userId}`;
      await transaction`delete from session where user_id = ${userId}`;
    });
  }

  async revokeSystemAdmin(userId: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await this.assertAdminRemains(transaction, userId);
      await transaction`delete from system_roles where user_id = ${userId} and role = 'system_admin'`;
      await transaction`delete from session where user_id = ${userId}`;
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await this.assertAdminRemains(transaction, userId);
      await transaction`delete from "user" where id = ${userId}`;
    });
  }
}
