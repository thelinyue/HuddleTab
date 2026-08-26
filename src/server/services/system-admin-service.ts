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
      select 1
      from system_roles sr
      join user_profiles up on up.user_id = sr.user_id and up.disabled_at is null
      join account a on a.user_id = sr.user_id and a.provider_id = 'credential' and a.password is not null
      where sr.user_id = ${targetUserId} and sr.role = 'system_admin'`;
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

  /** 启用只恢复平台账号状态；不会隐式恢复 Session 或授予任何平台角色。 */
  async enableUser(userId: string): Promise<void> {
    await this.sql`update user_profiles
      set disabled_at = null, updated_at = now()
      where user_id = ${userId}`;
  }

  /**
   * 平台授权必须显式记录授予人。联合主键保证重放或并发授权不会产生重复角色行，
   * 并且本方法绝不创建或伪造 ActivityMember。
   */
  async grantSystemAdmin(
    userId: string,
    grantedByUserId: string,
  ): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`insert into system_roles (user_id, role, granted_by_user_id, granted_at)
        values (${userId}, 'system_admin', ${grantedByUserId}, now())
        on conflict (user_id, role) do nothing`;
    });
  }
}
