import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 成员读取只返回 ActivityMember 账务身份，绝不关联或泄露账户邮箱。 */
export async function GET(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { authorizeActivityOperation },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/permissions/authorize-activity-operation"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const authorization = await sql.begin((transaction) =>
      authorizeActivityOperation(transaction, {
        session: { user: { id: sessionUserId(session) } },
        activityId: params.activityId,
        operation: "READ",
      }),
    );
    const members =
      await sql`select id, display_name, role, status, member_type from activity_members where activity_id = ${params.activityId} order by joined_at, id`;
    return NextResponse.json({
      data: members.map((member) => ({
        id: member.id,
        displayName: member.display_name,
        role: member.role,
        status: member.status,
        memberType: member.member_type,
        permissions: {
          canManage:
            authorization.member.role !== "MEMBER" &&
            authorization.member.status === "ACTIVE" &&
            authorization.activity.status === "ACTIVE",
        },
      })),
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
