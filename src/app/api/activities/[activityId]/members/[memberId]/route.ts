import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 移除成员时由服务根据账务事实选择删除或转为 LEFT。 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ activityId: string; memberId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { MemberService },
    { MaintenanceMode },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/member-service"),
    import("@/server/maintenance/maintenance-mode"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    await new MaintenanceMode(sql).assertWritesAllowed();
    const usage = {
      hasFacts: async (memberId: string) =>
        (
          await sql`select 1 from expense_payments where activity_member_id = ${memberId} union all select 1 from expense_shares where activity_member_id = ${memberId} union all select 1 from settlements where payer_member_id = ${memberId} or receiver_member_id = ${memberId} limit 1`
        ).length > 0,
    };
    await new MemberService(sql, usage).remove({
      session: { user: { id: sessionUserId(session) } },
      activityId: params.activityId,
      memberId: params.memberId,
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
