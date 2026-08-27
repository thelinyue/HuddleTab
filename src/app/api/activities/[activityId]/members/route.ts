import { NextResponse } from "next/server";
import { z } from "zod";

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

const addGuestInput = z.object({ displayName: z.string().trim().min(1).max(40) });

/** 临时成员由服务事务创建，Route 不复制成员、账务或审计不变量。 */
export async function POST(request: Request, context: { params: Promise<{ activityId: string }> }) {
  const [{ requireSession, sessionUserId }, { sql }, { MemberService }, { MaintenanceMode }, { applicationErrorResponse }] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/member-service"),
    import("@/server/maintenance/maintenance-mode"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([context.params, requireSession(request.headers)]);
    await new MaintenanceMode(sql).assertWritesAllowed();
    const usage = { hasFacts: async (memberId: string) => (await sql`select 1 from expense_payments where activity_member_id = ${memberId} union all select 1 from expense_shares where activity_member_id = ${memberId} union all select 1 from settlements where payer_member_id = ${memberId} or receiver_member_id = ${memberId} limit 1`).length > 0 };
    const member = await new MemberService(sql, usage).addGuest({ session: { user: { id: sessionUserId(session) } }, activityId: params.activityId, displayName: addGuestInput.parse(await request.json()).displayName });
    return NextResponse.json({ data: member }, { status: 201 });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
