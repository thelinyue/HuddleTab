import type { Sql, TransactionSql } from "postgres";

import { ApplicationError } from "@/server/errors/application-error";

const SYSTEM_ADMIN_ADVISORY_LOCK = "huddletab-system-admin-invariant";

/**
 * 系统管理员的破坏性操作必须在数据库事务内维护“至少保留一个可正常登录的管理员”不变量。
 * 使用事务级 advisory lock 将所有禁用、撤权和删除串行化；因此计数与随后的写入之间不会被
 * 另一个破坏性管理员操作穿插，避免并发请求共同删除最后一个可登录管理员。
 */
export class SystemAdminService {
  constructor(private readonly sql: Sql) {}

  /**
   * 以操作后的状态计算仍可登录的管理员数量。目标用户只有同时拥有管理员角色、启用 profile
   * 和与 Better Auth 本地 credential 身份一致的 issuer/account_id 与密码时才会被排除；非管理员、已禁用或无有效 credential 身份的目标不会误伤计数。
   */
  private async assertLoginCapableAdminRemains(
    transaction: TransactionSql,
    targetUserId: string,
  ): Promise<void> {
    await transaction`
      select pg_advisory_xact_lock(hashtext(${SYSTEM_ADMIN_ADVISORY_LOCK}))
    `;
    const [row] = await transaction<{ count: number }[]>`
      select count(distinct sr.user_id)::int as count
      from system_roles sr
      join user_profiles up on up.user_id = sr.user_id and up.disabled_at is null
      join account a on a.user_id = sr.user_id
        and a.provider_id = 'credential'
        and a.issuer = 'local:credential'
        and a.account_id = sr.user_id
        and a.password is not null
      where sr.role = 'system_admin' and sr.user_id <> ${targetUserId}
    `;

    if ((row?.count ?? 0) < 1) {
      throw new ApplicationError(
        "LAST_ACTIVE_ADMIN",
        "系统必须至少保留一个能够正常登录的系统管理员。",
        409,
      );
    }
  }

  async disableUser(userId: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await this.assertLoginCapableAdminRemains(transaction, userId);
      await transaction`
        update user_profiles
        set disabled_at = now(), updated_at = now()
        where user_id = ${userId}
      `;
      await transaction`delete from session where user_id = ${userId}`;
    });
  }

  async revokeSystemAdmin(userId: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await this.assertLoginCapableAdminRemains(transaction, userId);
      await transaction`
        delete from system_roles
        where user_id = ${userId} and role = 'system_admin'
      `;
      await transaction`delete from session where user_id = ${userId}`;
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await this.assertLoginCapableAdminRemains(transaction, userId);
      await transaction`delete from "user" where id = ${userId}`;
    });
  }
}
