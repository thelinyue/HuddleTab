import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 平台用户列表只返回管理所需的公开资料，不返回邮箱、密码或 Session。 */
export async function GET(request: Request) {
  const [{ requireSession }, { sql }, { requireSystemAdmin }, { applicationErrorResponse }] = await Promise.all([
    import("@/server/auth/session"), import("@/server/db/client"), import("@/server/permissions/require-system-admin"), import("@/server/http/application-error-response"),
  ]);
  try {
    await requireSystemAdmin(sql, await requireSession(request.headers));
    const users = await sql`select profile.user_id as id, profile.nickname, profile.username_normalized as username, profile.disabled_at,
      exists(select 1 from system_roles role where role.user_id = profile.user_id and role.role = 'system_admin') as is_system_admin
      from user_profiles profile order by profile.created_at, profile.user_id`;
    return NextResponse.json({ data: users.map((user) => ({ id: user.id, nickname: user.nickname, username: user.username, disabled: Boolean(user.disabled_at), isSystemAdmin: user.is_system_admin })) });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
