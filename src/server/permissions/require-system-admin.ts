import type postgres from "postgres";

import { sessionUserId } from "@/server/auth/session";
import { ApplicationError } from "@/server/errors/application-error";

/**
 * 平台管理员守卫只读取认证账号、账号状态和 system_roles；它刻意不触及任何
 * Activity 或 ActivityMember，因此系统管理员不会因平台管理操作获得私人活动权限。
 */
export async function requireSystemAdmin(
  sql: ReturnType<typeof postgres>,
  session: unknown,
): Promise<string> {
  const userId = sessionUserId(session);
  const [account] = await sql<
    { readonly disabled_at: Date | null; readonly is_system_admin: boolean }[]
  >`select profile.disabled_at,
      exists(
        select 1 from system_roles role
        where role.user_id = profile.user_id and role.role = 'system_admin'
      ) as is_system_admin
    from user_profiles profile
    where profile.user_id = ${userId}`;

  if (account?.disabled_at) {
    throw new ApplicationError(
      "ACCOUNT_DISABLED",
      "账号已被禁用，无法执行系统管理操作。",
      403,
    );
  }
  if (!account?.is_system_admin) {
    throw new ApplicationError(
      "SYSTEM_ADMIN_REQUIRED",
      "需要系统管理员权限。",
      403,
    );
  }
  return userId;
}
