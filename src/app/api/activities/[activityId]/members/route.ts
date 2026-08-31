import { NextResponse } from "next/server";
import { z } from "zod";

import type { AvatarPreset } from "@/features/me/avatar-presets";

export const dynamic = "force-dynamic";

/** 成员读取只投影显示头像预设，绝不返回账户邮箱或改变 ActivityMember 身份。 */
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
    const [members, inviteModes] = await Promise.all([
      sql`select member.id, member.display_name, member.role, member.status, member.member_type, profile.avatar_preset
        from activity_members member
        left join user_profiles profile on profile.user_id = member.user_id
        where member.activity_id = ${params.activityId}
        order by member.joined_at, member.id`,
      sql`select invite_mode from activities where id = ${params.activityId}`,
    ]);
    return NextResponse.json({
      data: members.map((member) => ({
        id: member.id,
        displayName: member.display_name,
        role: member.role,
        status: member.status,
        memberType: member.member_type,
        avatarPreset:
          member.member_type === "USER"
            ? ((member.avatar_preset as AvatarPreset | null) ?? null)
            : null,
        permissions: {
          canManage:
            authorization.member.role !== "MEMBER" &&
            authorization.member.status === "ACTIVE" &&
            authorization.activity.status === "ACTIVE",
        },
      })),
      meta: {
        inviteMode: inviteModes[0].invite_mode,
      },
    });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

const addGuestInput = z.object({
  displayName: z.string().trim().min(1).max(40),
});

/** 临时成员由服务事务创建，Route 不复制成员、账务或审计不变量。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ activityId: string }> },
) {
  const [
    { requireSession, sessionUserId },
    { sql },
    { MemberService },
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/services/member-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    const [params, session] = await Promise.all([
      context.params,
      requireSession(request.headers),
    ]);
    const { displayName } = addGuestInput.parse(await request.json());
    const usage = {
      hasFacts: async (memberId: string) =>
        (
          await sql`select 1 from expense_payments where activity_member_id = ${memberId} union all select 1 from expense_shares where activity_member_id = ${memberId} union all select 1 from settlements where payer_member_id = ${memberId} or receiver_member_id = ${memberId} limit 1`
        ).length > 0,
    };
    const member = await new MemberService(sql, usage).addGuest({
      session: { user: { id: sessionUserId(session) } },
      activityId: params.activityId,
      displayName,
    });
    return NextResponse.json(
      {
        data: {
          id: member.id,
          displayName,
          status: "ACTIVE",
          avatarPreset: null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
